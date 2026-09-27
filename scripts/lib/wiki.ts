// Wikimedia data access: Wikidata topic resolution, redirects, pageviews.
import { getJson, DAY } from "./http.ts";
import { type Month, monthEnd, monthStart, currentMonth, cmpMonth, lastCompleteMonth, FIRST_AVAILABLE } from "./months.ts";

const PV = "https://wikimedia.org/api/rest_v1/metrics/pageviews";
const WD = "https://www.wikidata.org/w/api.php";

export const AGENT = "user"; // excludes self-identified bots & detected automated traffic
export type Access = "all-access" | "desktop" | "mobile-web" | "mobile-app";

/** Wikidata sitelink key for a Wikipedia language code. */
export function siteKey(lang: string): string {
  if (lang === "be-tarask") return "be_x_oldwiki";
  return lang.replace(/-/g, "_") + "wiki";
}
export function langFromSiteKey(key: string): string | null {
  if (!key.endsWith("wiki") || key === "commonswiki" || key === "specieswiki" || key.includes("wikiquote")) return null;
  if (/wik(i(books|news|quote|source|versity|voyage)|tionary)$/.test(key)) return null;
  const base = key.slice(0, -4);
  if (["meta", "mediawiki", "wikidata", "sources", "outreach", "wikimania", "incubator", "species", "commons", "wikifunctions"].includes(base)) return null;
  if (base === "be_x_old") return "be-tarask";
  return base.replace(/_/g, "-");
}

export interface Entity {
  qid: string;
  label: string;
  description: string;
  /** lang -> article title */
  titles: Record<string, string>;
}

interface WdEntity {
  id: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  sitelinks?: Record<string, { title: string }>;
}

function toEntity(e: WdEntity, uiLang: string): Entity {
  const titles: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.sitelinks || {})) {
    const l = langFromSiteKey(k);
    if (l) titles[l] = v.title;
  }
  const pick = (m?: Record<string, { value: string }>) => m?.[uiLang]?.value || m?.en?.value || Object.values(m || {})[0]?.value || "";
  const label = pick(e.labels);
  return { qid: e.id, label: label.charAt(0).toUpperCase() + label.slice(1), description: pick(e.descriptions), titles };
}

export async function getEntities(qids: string[], uiLang = "en"): Promise<Entity[]> {
  const out: Entity[] = [];
  for (let i = 0; i < qids.length; i += 40) {
    const ids = qids.slice(i, i + 40).join("|");
    const url = `${WD}?action=wbgetentities&ids=${encodeURIComponent(ids)}&props=sitelinks|labels|descriptions&languages=${[...new Set([uiLang, "en"])].join("|")}&format=json`;
    const r = await getJson(url, 7 * DAY);
    const ents = (r.body as { entities?: Record<string, WdEntity> }).entities || {};
    for (const e of Object.values(ents)) if (!e.missing) out.push(toEntity(e, uiLang));
  }
  return out;
}

/** Look up the Wikidata item behind a known article title in a given language edition. */
export async function entityByTitle(lang: string, title: string, uiLang = "en"): Promise<Entity | null> {
  const url = `${WD}?action=wbgetentities&sites=${siteKey(lang)}&titles=${encodeURIComponent(title)}&normalize=1&props=sitelinks|labels|descriptions&languages=${[...new Set([uiLang, "en"])].join("|")}&format=json`;
  const r = await getJson(url, 7 * DAY);
  const ents = Object.values((r.body as { entities?: Record<string, WdEntity> }).entities || {});
  const e = ents.find((x) => !x.missing && x.id && x.id.startsWith("Q"));
  return e ? toEntity(e, uiLang) : null;
}

export interface Candidate extends Entity {
  isDisambiguation: boolean;
}

/** Free-text search on Wikidata; returns candidates with their sitelinks. */
export async function searchTopic(query: string, searchLang = "en", limit = 7): Promise<Candidate[]> {
  // Wikidata search is case-insensitive; normalising improves cache hits.
  const q = query.trim().replace(/\s+/g, " ").toLowerCase();
  const url = `${WD}?action=wbsearchentities&search=${encodeURIComponent(q)}&language=${searchLang}&uselang=${searchLang}&type=item&limit=${limit}&format=json`;
  const r = await getJson(url, 7 * DAY);
  const hits = ((r.body as { search?: Array<{ id: string }> }).search || []).map((h) => h.id);
  if (!hits.length) return [];
  const ents = await getEntities(hits, searchLang);
  const byId = new Map(ents.map((e) => [e.qid, e]));
  return hits
    .map((id) => byId.get(id))
    .filter((e): e is Entity => !!e)
    .map((e) => ({
      ...e,
      isDisambiguation: /disambiguation|сторінка значень|багатозначн|ujednoznacz|rozcestník|Begriffsklärung|homonymie/i.test(e.description),
    }));
}

/**
 * Pick the best candidate: skip disambiguation pages, prefer (in search order)
 * items that have articles in the most requested languages.
 */
export function chooseCandidate(cands: Candidate[], langs: string[]): Candidate | null {
  const usable = cands.filter((c) => !c.isDisambiguation && Object.keys(c.titles).length > 0);
  if (!usable.length) return null;
  let best = usable[0];
  const cover = (c: Candidate) => langs.filter((l) => c.titles[l]).length;
  for (const c of usable.slice(0, 4)) if (cover(c) > cover(best)) best = c;
  return best;
}

/** Titles of redirects pointing to an article (namespace 0), resolving the input if it is itself a redirect. */
export async function getRedirects(lang: string, title: string, cap: number): Promise<{ canonical: string; redirects: string[]; total: number }> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=redirects&titles=${encodeURIComponent(title)}&rdlimit=max&rdnamespace=0&rdprop=title&redirects=1&format=json&formatversion=2`;
  const r = await getJson(url, 7 * DAY);
  const q = (r.body as { query?: { pages?: Array<{ title: string; missing?: boolean; redirects?: Array<{ title: string }> }> } }).query;
  const page = q?.pages?.[0];
  if (!page || page.missing) return { canonical: title, redirects: [], total: 0 };
  const all = (page.redirects || []).map((x) => x.title);
  return { canonical: page.title, redirects: all.slice(0, cap), total: all.length };
}

function ttlFor(end: Month): number {
  // Completed months are final; the current month is still accumulating.
  return cmpMonth(end, currentMonth()) < 0 ? 180 * DAY : 0.5 * DAY;
}

const pvDate = (d: string) => d.replace(/-/g, "");

// We always request the FULL history (2015-07 .. last complete month) in one call and slice
// locally: same cost as a short range, and any follow-up with a different period is a cache hit.
function fullRange(): { s: string; e: string; end: Month } {
  const end = lastCompleteMonth();
  return { s: pvDate(monthStart(FIRST_AVAILABLE)), e: pvDate(monthEnd(end)), end };
}
function sliceItems(body: unknown, start: Month, end: Month): Map<Month, number> {
  const out = new Map<Month, number>();
  for (const it of (body as { items?: Array<{ timestamp: string; views: number }> }).items || []) {
    const m = `${it.timestamp.slice(0, 4)}-${it.timestamp.slice(4, 6)}` as Month;
    if (cmpMonth(m, start) < 0 || cmpMonth(m, end) > 0) continue;
    out.set(m, (out.get(m) || 0) + it.views);
  }
  return out;
}

/** Monthly user pageviews for one article title. Months with no data are omitted. */
export async function articleMonthly(lang: string, title: string, start: Month, end: Month, access: Access = "all-access"): Promise<Map<Month, number>> {
  const art = encodeURIComponent(title.replace(/ /g, "_"));
  const f = fullRange();
  const url = `${PV}/per-article/${lang}.wikipedia/${access}/${AGENT}/${art}/monthly/${f.s}/${f.e}`;
  const r = await getJson(url, ttlFor(f.end));
  if (r.status === 404) return new Map();
  return sliceItems(r.body, start, end);
}

/** Monthly total user pageviews for a whole language edition (used for normalisation). */
export async function projectMonthly(lang: string, start: Month, end: Month, access: Access = "all-access"): Promise<Map<Month, number>> {
  const f = fullRange();
  const url = `${PV}/aggregate/${lang}.wikipedia/${access}/${AGENT}/monthly/${f.s}00/${f.e}00`;
  const r = await getJson(url, ttlFor(f.end));
  if (r.status === 404) return new Map();
  return sliceItems(r.body, start, end);
}

export interface TopArticle {
  rank: number;
  article: string;
  views: number;
}
/** Top ~1000 most viewed articles of a language edition in a month. */
export async function topArticles(lang: string, month: Month, access: Access = "all-access"): Promise<TopArticle[]> {
  const [y, m] = month.split("-");
  const url = `${PV}/top/${lang}.wikipedia/${access}/${y}/${m}/all-days`;
  const r = await getJson(url, ttlFor(month));
  if (r.status === 404) return [];
  const items = (r.body as { items?: Array<{ articles: TopArticle[] }> }).items || [];
  return items[0]?.articles || [];
}
