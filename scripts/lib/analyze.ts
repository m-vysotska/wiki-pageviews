// Core analysis: resolve topics -> fetch monthly views -> compute trust-aware metrics.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Entity, type Access, searchTopic, chooseCandidate, getEntities, entityByTitle,
  getRedirects, articleMonthly, projectMonthly,
} from "./wiki.ts";
import { stats as netStats } from "./http.ts";
import { type Month, monthRange, addMonths, lastCompleteMonth, cmpMonth, FIRST_AVAILABLE, monthsBetween } from "./months.ts";
import {
  sum, mean, median, growth, growthCI, pairedUps, signTestP, senTrend, detectSpikes, despike,
} from "./stats.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = join(HERE, "..", "..");

export function expandLangs(spec: string): string[] {
  const presets = JSON.parse(readFileSync(join(SKILL_ROOT, "assets", "lang-presets.json"), "utf8")) as Record<string, string[]>;
  const out: string[] = [];
  for (const part of spec.split(/[,\s]+/).filter(Boolean)) {
    const p = part.toLowerCase();
    if (presets[p] && !p.startsWith("_")) out.push(...presets[p]);
    else if (/^[a-z][a-z0-9-]{1,11}$/.test(p)) out.push(p);
    else throw new Error(`Unknown language code or preset "${part}". Presets: ${Object.keys(presets).filter((k) => !k.startsWith("_")).join(", ")}`);
  }
  // Russian Wikipedia is intentionally not used by this skill.
  if (out.includes("ru")) console.error('Note: "ru" is excluded from this skill and was skipped.');
  const langs = [...new Set(out)].filter((l) => l !== "ru");
  if (!langs.length) throw new Error("No supported languages left (ru is excluded). Choose other language editions.");
  return langs;
}

// ---------- topic resolution ----------

export interface ResolvedTopic {
  input: string;
  label: string;
  qid: string | null;
  description: string;
  titles: Record<string, string>;
  alternatives: Array<{ qid: string; label: string; description: string; langsCovered: number }>;
  note?: string;
}

export async function resolveTopic(input: string, langs: string[], searchLang: string): Promise<ResolvedTopic> {
  const qidM = /^Q\d+$/i.exec(input.trim());
  if (qidM) {
    const [e] = await getEntities([input.trim().toUpperCase()], searchLang);
    if (!e) throw new Error(`Wikidata item ${input} not found`);
    return { input, label: e.label, qid: e.qid, description: e.description, titles: e.titles, alternatives: [] };
  }
  const titleM = /^([a-z][a-z-]{1,11}):(.+)$/.exec(input.trim());
  if (titleM) {
    const [, lang, title] = titleM;
    const e = await entityByTitle(lang, title, searchLang);
    if (e) return { input, label: e.label || title, qid: e.qid, description: e.description, titles: e.titles, alternatives: [] };
    return { input, label: title, qid: null, description: "", titles: { [lang]: title }, alternatives: [], note: `No Wikidata item for ${lang}:${title}; only ${lang} is analysed.` };
  }
  const cands = await searchTopic(input, searchLang);
  const best = chooseCandidate(cands, langs);
  if (!best) throw new Error(`No Wikidata item found for "${input}" (search language "${searchLang}"). Try an English term with --search-lang en, a QID, or lang:Title.`);
  return {
    input, label: best.label, qid: best.qid, description: best.description, titles: best.titles,
    alternatives: cands.filter((c) => c.qid !== best.qid).slice(0, 4).map((c) => ({
      qid: c.qid, label: c.label, description: c.description + (c.isDisambiguation ? " [disambiguation]" : ""),
      langsCovered: langs.filter((l) => c.titles[l]).length,
    })),
  };
}

// ---------- metrics ----------

export type Direction = "growing" | "declining" | "flat" | "unclear";
export type Confidence = "high" | "medium" | "low";

export interface Metrics {
  windowMonths: number; // length of each compared window (12 normally)
  seasonallyMatched: boolean;
  avgMonthlyRecent: number;
  totalRecent: number;
  perMillionRecent: number; // views per 1M pageviews of that language edition
  growth: number; // recent window vs previous window, raw views
  growthCI90: [number, number];
  growthMedianBased: number; // robust to single spikes
  growthDespiked: number;
  growthDespikedCI90: [number, number];
  seasonalPeaks: string[]; // calendar months ("09") with a recurring yearly peak
  growthRelative: number; // growth of share of edition traffic
  growthRelativeCI90: [number, number];
  editionGrowth: number; // growth of the whole language edition (context)
  prevGrowth: number | null; // same measure one year earlier (acceleration)
  monthsUp: number;
  monthsDown: number;
  monthsCompared: number;
  signTestP: number;
  trendAnnualPct: number; // Sen's slope over the full period
  trendP: number;
  spikes: Array<{ month: Month; ratio: number }>;
  firstMonthWithData: Month | null;
}

export interface SeriesResult {
  id: string;
  topic: string;
  /** Topic name for Ukrainian reports: the uk Wikipedia title if it exists, else the Wikidata label */
  topicUk?: string;
  qid: string | null;
  lang: string;
  title: string | null;
  status: "ok" | "no_article" | "no_data" | "insufficient_history";
  redirectsIncluded: number;
  redirectsTotal: number;
  months: Month[];
  views: number[];
  editionViews: number[];
  perMillion: number[];
  metrics: Metrics | null;
  direction: Direction;
  directionRelative: Direction;
  confidence: Confidence;
  confidenceReasons: string[];
  flags: string[];
}

export interface AnalysisParams {
  topics: string[];
  langs: string[];
  start: Month;
  end: Month;
  access: Access;
  redirects: boolean;
  redirectCap: number;
  searchLang: string;
  combine: string | null;
}

export interface Analysis {
  tool: string;
  generatedAt: string;
  params: AnalysisParams;
  topics: ResolvedTopic[];
  series: SeriesResult[];
  comparisons: Array<{ a: string; b: string; diffPP: number; distinguishable: boolean }>;
  notes: string[];
}

function classify(g: number, ci: [number, number]): Direction {
  if (!Number.isFinite(g)) return "unclear";
  if (ci[0] > 0.03) return "growing";
  if (ci[1] < -0.03) return "declining";
  if (Math.abs(g) < 0.07 && ci[0] > -0.2 && ci[1] < 0.2) return "flat";
  return "unclear";
}

export function computeMetrics(months: Month[], views: number[], edition: number[]): { metrics: Metrics | null; status: SeriesResult["status"]; flags: string[] } {
  const flags: string[] = [];
  const n = months.length;
  const firstIdx = views.findIndex((v) => v > 0);
  if (firstIdx < 0) return { metrics: null, status: "no_data", flags: ["no pageviews recorded in the period"] };
  const w = n >= 24 ? 12 : Math.floor(n / 2);
  if (w < 3) return { metrics: null, status: "insufficient_history", flags: ["period too short (need >= 6 months, ideally >= 24)"] };
  const cur = views.slice(n - w);
  const prev = views.slice(n - 2 * w, n - w);
  const edCur = edition.slice(n - w);
  const edPrev = edition.slice(n - 2 * w, n - w);
  const share = views.map((v, i) => (edition[i] > 0 ? (v / edition[i]) * 1e6 : NaN));
  const shCur = share.slice(n - w);
  const shPrev = share.slice(n - 2 * w, n - w);
  let status: SeriesResult["status"] = "ok";
  if (firstIdx > n - 2 * w) {
    status = "insufficient_history";
    flags.push(`article has data only from ${months[firstIdx]} — growth vs. the previous window is not meaningful (likely a new or renamed article)`);
  }
  const allSpikes = detectSpikes(views);
  // A peak in the same calendar month in 2+ years is seasonality (e.g. school year start), not a one-off event.
  const calCount = new Map<string, number>();
  for (const s of allSpikes) { const cm = months[s.index].slice(5); calCount.set(cm, (calCount.get(cm) || 0) + 1); }
  const seasonalPeaks = [...calCount].filter(([, c]) => c >= 2).map(([cm]) => cm).sort();
  const spikesIdx = allSpikes.filter((s) => !seasonalPeaks.includes(months[s.index].slice(5)));
  const desp = despike(views, spikesIdx);
  const g = growth(cur, prev);
  const ups = pairedUps(cur, prev);
  const trend = senTrend(views.slice(firstIdx));
  let prevGrowth: number | null = null;
  if (n >= 3 * w && w === 12 && firstIdx <= n - 3 * w) prevGrowth = growth(prev, views.slice(n - 3 * w, n - 2 * w));
  const shareOk = shCur.every(Number.isFinite) && shPrev.every(Number.isFinite);
  const metrics: Metrics = {
    windowMonths: w,
    seasonallyMatched: w === 12,
    avgMonthlyRecent: mean(cur),
    totalRecent: sum(cur),
    perMillionRecent: sum(edCur) > 0 ? (sum(cur) / sum(edCur)) * 1e6 : NaN,
    growth: g,
    growthCI90: growthCI(cur, prev),
    growthMedianBased: median(prev) > 0 ? median(cur) / median(prev) - 1 : NaN,
    growthDespiked: growth(desp.slice(n - w), desp.slice(n - 2 * w, n - w)),
    growthDespikedCI90: growthCI(desp.slice(n - w), desp.slice(n - 2 * w, n - w)),
    seasonalPeaks,
    growthRelative: shareOk ? growth(shCur, shPrev) : NaN,
    growthRelativeCI90: shareOk ? growthCI(shCur, shPrev) : [NaN, NaN],
    editionGrowth: growth(edCur, edPrev),
    prevGrowth,
    monthsUp: ups.up,
    monthsDown: ups.down,
    monthsCompared: ups.n,
    signTestP: signTestP(ups.up, ups.up + ups.down),
    trendAnnualPct: trend.annualPct,
    trendP: trend.p,
    spikes: spikesIdx.map((s) => ({ month: months[s.index], ratio: Math.round(s.ratio * 10) / 10 })),
    firstMonthWithData: months[firstIdx],
  };
  if (!metrics.seasonallyMatched) flags.push(`period < 24 months: comparing last ${w} vs previous ${w} months, which is NOT seasonally matched`);
  if (!shareOk) flags.push("edition totals missing for some months; relative (normalised) growth not computed");
  return { metrics, status, flags };
}

export function judge(m: Metrics | null, status: SeriesResult["status"]): { direction: Direction; directionRelative: Direction; confidence: Confidence; reasons: string[] } {
  if (!m) return { direction: "unclear", directionRelative: "unclear", confidence: "low", reasons: ["no usable data"] };
  const reasons: string[] = [];
  let score = 0;
  let forceLow = false;
  const spikeFlip = Number.isFinite(m.growthDespiked) && m.spikes.length > 0 && Math.sign(m.growthDespiked) !== Math.sign(m.growth);
  const spikeMagnitude = !spikeFlip && Number.isFinite(m.growthDespiked) && m.spikes.length > 0 && Math.abs(m.growth - m.growthDespiked) > Math.max(0.1, 0.5 * Math.abs(m.growth));
  const rawDir = classify(m.growth, m.growthCI90);
  const despDir = classify(m.growthDespiked, m.growthDespikedCI90);
  // When one-off spikes distort the comparison, judge direction on the despiked series.
  const direction = spikeFlip || (spikeMagnitude && rawDir === "unclear") ? despDir : rawDir;
  const directionRelative = classify(m.growthRelative, m.growthRelativeCI90);
  if (status === "insufficient_history") { forceLow = true; reasons.push("not enough history before the recent window"); }
  if (m.avgMonthlyRecent < 100) { forceLow = true; reasons.push(`very low volume (${Math.round(m.avgMonthlyRecent)} views/month): too few readers to generalise`); }
  else if (m.avgMonthlyRecent < 300) { score -= 2; reasons.push(`very low volume (${Math.round(m.avgMonthlyRecent)} views/month): small absolute changes look like big %`); }
  else if (m.avgMonthlyRecent < 1000) { score -= 1; reasons.push(`low volume (${Math.round(m.avgMonthlyRecent)} views/month)`); }
  else if (m.avgMonthlyRecent >= 3000) { score += 1; reasons.push("solid volume"); }
  const [lo, hi] = direction === rawDir ? m.growthCI90 : m.growthDespikedCI90;
  if (lo > 0 || hi < 0) { score += 1; reasons.push("90% interval excludes zero"); }
  else { score -= 1; reasons.push("90% interval includes zero"); }
  const agree = Math.max(m.monthsUp, m.monthsDown);
  if (m.monthsCompared >= 6 && agree / m.monthsCompared >= 0.8) { score += 1; reasons.push(`consistent: ${agree}/${m.monthsCompared} months moved the same way`); }
  else if (m.monthsCompared >= 6 && agree / m.monthsCompared < 0.65) { score -= 1; reasons.push(`inconsistent month-by-month (${m.monthsUp} up / ${m.monthsDown} down)`); }
  if (spikeFlip) { score -= 2; reasons.push(`one-off spikes flip the sign of the change (without spikes: ${pct(m.growthDespiked)}); direction judged without spikes`); }
  else if (spikeMagnitude) { score -= 1; reasons.push(`one-off spikes distort the size of the change (without spikes: ${pct(m.growthDespiked)})${direction !== rawDir ? "; direction judged without spikes" : ""}`); }
  if (direction !== "unclear" && directionRelative !== "unclear" && direction !== directionRelative) {
    score -= 1; reasons.push(`raw and relative-to-edition trends disagree (edition traffic ${pct(m.editionGrowth)})`);
  }
  if (!m.seasonallyMatched) { score -= 1; reasons.push("windows not seasonally matched"); }
  const confidence: Confidence = forceLow || score <= -1 ? "low" : score >= 3 ? "high" : "medium";
  return { direction, directionRelative, confidence, reasons };
}

export const pct = (x: number, digits = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%` : "n/a");

// ---------- orchestration ----------

async function seriesViews(lang: string, title: string, p: AnalysisParams): Promise<{ canonical: string; views: Map<Month, number>; included: number; total: number }> {
  let canonical = title;
  let titles = [title];
  let total = 0;
  if (p.redirects) {
    const r = await getRedirects(lang, title, p.redirectCap);
    canonical = r.canonical;
    titles = [r.canonical, ...r.redirects];
    total = r.total;
  }
  const maps = await Promise.all(titles.map((t) => articleMonthly(lang, t, p.start, p.end, p.access)));
  const views = new Map<Month, number>();
  for (const m of maps) for (const [k, v] of m) views.set(k, (views.get(k) || 0) + v);
  return { canonical, views, included: titles.length - 1, total };
}

export async function runAnalysis(p: AnalysisParams, log: (s: string) => void = () => {}): Promise<Analysis> {
  if (cmpMonth(p.start, FIRST_AVAILABLE) < 0) p.start = FIRST_AVAILABLE;
  const lcm = lastCompleteMonth();
  if (cmpMonth(p.end, lcm) > 0) p.end = lcm;
  if (monthsBetween(p.start, p.end) < 5) throw new Error(`Period ${p.start}..${p.end} is too short; use at least 6 months (24+ recommended).`);
  const months = monthRange(p.start, p.end);
  const notes: string[] = [];

  const topics: ResolvedTopic[] = [];
  for (const t of p.topics) {
    const r = await resolveTopic(t, p.langs, p.searchLang);
    topics.push(r);
    log(`resolved "${t}" -> ${r.qid ?? "(no item)"} ${r.label}${r.description ? ` — ${r.description}` : ""}`);
    if (r.note) notes.push(r.note);
  }

  const edition = new Map<string, number[]>();
  await Promise.all(p.langs.map(async (l) => {
    const m = await projectMonthly(l, p.start, p.end, p.access);
    edition.set(l, months.map((mo) => m.get(mo) ?? NaN));
  }));

  type Raw = { topic: ResolvedTopic; lang: string; title: string | null; views: number[] | null; inc: number; tot: number };
  const raws: Raw[] = [];
  await Promise.all(topics.flatMap((t) => p.langs.map(async (lang) => {
    const title = t.titles[lang];
    if (!title) { raws.push({ topic: t, lang, title: null, views: null, inc: 0, tot: 0 }); return; }
    const s = await seriesViews(lang, title, p);
    raws.push({ topic: t, lang, title: s.canonical, views: months.map((m) => s.views.get(m) || 0), inc: s.included, tot: s.total });
  })));

  // Optional: sum several topics into one series per language.
  let groups: Array<{ label: string; labelUk: string; qid: string | null; lang: string; title: string | null; views: number[] | null; inc: number; tot: number; missing: string[] }>;
  if (p.combine) {
    groups = p.langs.map((lang) => {
      const rs = raws.filter((r) => r.lang === lang);
      const have = rs.filter((r) => r.views);
      const views = have.length ? months.map((_, i) => sum(have.map((r) => r.views![i]))) : null;
      return {
        label: p.combine!, labelUk: p.combine!, qid: null, lang, title: have.map((r) => r.title).join(" + ") || null, views,
        inc: sum(have.map((r) => r.inc)), tot: sum(have.map((r) => r.tot)),
        missing: rs.filter((r) => !r.views).map((r) => r.topic.label),
      };
    });
  } else {
    groups = [];
    for (const t of topics) for (const lang of p.langs) {
      const r = raws.find((x) => x.topic === t && x.lang === lang)!;
      groups.push({ label: t.label, labelUk: t.titles.uk ?? t.label, qid: t.qid, lang, title: r.title, views: r.views, inc: r.inc, tot: r.tot, missing: [] });
    }
  }

  const series: SeriesResult[] = groups.map((g) => {
    const ed = edition.get(g.lang)!;
    const base = {
      id: `${g.label} [${g.lang}]`, topic: g.label, topicUk: g.labelUk, qid: g.qid, lang: g.lang, title: g.title,
      redirectsIncluded: g.inc, redirectsTotal: g.tot, months, editionViews: ed,
    };
    if (!g.views) {
      return {
        ...base, status: "no_article" as const, views: [], perMillion: [], metrics: null,
        direction: "unclear" as const, directionRelative: "unclear" as const, confidence: "low" as const,
        confidenceReasons: ["no article in this language edition"],
        flags: [`no ${g.lang} Wikipedia article for this topic — a content gap, not zero interest; interest may land on other articles. To measure it anyway, find a related local article and pass --topic "${g.lang}:<Title>"`],
      };
    }
    const { metrics, status, flags } = computeMetrics(months, g.views, ed);
    const j = judge(metrics, status);
    if (g.missing.length) flags.push(`combined series lacks articles for: ${g.missing.join(", ")}`);
    if (g.tot > g.inc) flags.push(`only ${g.inc} of ${g.tot} redirects included (raise --redirect-cap for completeness)`);
    for (const s of metrics?.spikes || []) flags.push(`one-off spike ${s.month}: ${s.ratio}x the surrounding median — check news/events or bot traffic`);
    if (metrics?.seasonalPeaks.length) flags.push(`recurring yearly peak in month(s) ${metrics.seasonalPeaks.join(", ")} (seasonal, e.g. school year) — cancels out in the year-over-year comparison`);
    return {
      ...base, status, views: g.views, perMillion: g.views.map((v, i) => (ed[i] > 0 ? (v / ed[i]) * 1e6 : NaN)),
      metrics, direction: j.direction, directionRelative: j.directionRelative, confidence: j.confidence,
      confidenceReasons: j.reasons, flags,
    };
  });

  // Pairwise: is the growth difference distinguishable (CIs of the difference via non-overlap heuristic)?
  const comparisons: Analysis["comparisons"] = [];
  const ok = series.filter((s) => s.metrics && s.status === "ok");
  if (ok.length <= 8) for (let i = 0; i < ok.length; i++) for (let k = i + 1; k < ok.length; k++) {
    const a = ok[i].metrics!, b = ok[k].metrics!;
    const distinguishable = a.growthCI90[0] > b.growthCI90[1] || b.growthCI90[0] > a.growthCI90[1];
    comparisons.push({ a: ok[i].id, b: ok[k].id, diffPP: (a.growth - b.growth) * 100, distinguishable });
  }

  for (const l of p.langs) {
    const ed = edition.get(l)!;
    const n = ed.length;
    if (n >= 24) {
      const eg = growth(ed.slice(n - 12), ed.slice(n - 24, n - 12));
      if (Math.abs(eg) > 0.05) notes.push(`${l}.wikipedia total traffic changed ${pct(eg)} year-over-year; compare raw growth with the relative (share) figure.`);
    }
  }

  if (netStats.unknownProvenance.length) {
    notes.unshift(`DATA INTEGRITY WARNING: ${netStats.unknownProvenance.length} cached responses have unknown origin (not downloaded or imported by this tool) — results may be fabricated. Run "wv cache --clear" and re-run online.`);
  }
  return {
    tool: "wiki-pageviews-skill/0.1", generatedAt: new Date().toISOString(),
    params: p, topics, series, comparisons, notes,
  };
}

export { addMonths };

/** Display label of a series in the report language. */
export function seriesLabel(s: Pick<SeriesResult, "id" | "topic" | "topicUk" | "lang">, ui: "en" | "uk"): string {
  return ui === "uk" ? `${s.topicUk ?? s.topic} [${s.lang}]` : s.id;
}
