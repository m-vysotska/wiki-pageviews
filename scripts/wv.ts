#!/usr/bin/env node
// wv — Wikipedia pageviews analysis CLI for agents. Run: node scripts/wv.ts <command> [options]
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { runAnalysis, expandLangs, resolveTopic, type Analysis, type AnalysisParams, pct } from "./lib/analyze.ts";
import { parseMonth, addMonths, lastCompleteMonth, type Month } from "./lib/months.ts";
import { stdoutSummary, markdownSummary, int } from "./lib/format.ts";
import { trendChart, growthChart, svgToPng, type TrendMode } from "./lib/chart.ts";
import { topArticles, type Access } from "./lib/wiki.ts";
import { stats as netStats, CACHE_DIR } from "./lib/http.ts";

const HELP = `wv — Wikipedia pageviews analysis (Wikimedia Analytics API)

COMMANDS
  resolve  --topic "Astronomy" --langs uk,pl,cs
           Map a topic to its Wikidata item and article titles per language. Shows alternatives.
  analyze  --topic "Astronomy" [--topic "Physics"] --langs uk,pl [--months 36 | --start 2023-01 --end 2025-12]
           Fetch monthly views (+redirects), compute growth/confidence, write charts + analysis.json.
           Options: --out DIR (default ./wv-output)  --name SLUG  --combine "Label" (sum topics per language)
                    --search-lang en  --access all-access|desktop|mobile-web|mobile-app
                    --no-redirects  --redirect-cap 25  --chart index|views|share  --ui uk|en (default uk)  --no-png  --json
  report   --analysis DIR_OR_JSON [--notes notes.md] [--title "..."] [--ui uk|en] [--chart index|views|share] [--out file.pdf]
           Build a one-page PDF (Ukrainian by default). Checks every % in notes.md against the computed figures.
  check    --analysis DIR_OR_JSON --notes notes.md       Only run the claim check.
  top      --lang uk [--month 2026-08] [--grep "астроном|космос"] [--limit 30]
           Most-viewed articles of a language edition in a month (topic discovery).
  cache    [--clear]                                      Show / clear the HTTP cache.
  doctor                                                  Check node version, dependencies, API access.

TOPIC FORMS  free text ("intermittent fasting", searched on Wikidata in --search-lang, default en),
             a QID (Q333), or lang:Title (en:Intermittent fasting).
LANGS        codes (uk,pl,cs) and/or presets: top10 top20 top40 eu cee nordics slavic asia mena latam
ENV          WV_CACHE_DIR, WV_OFFLINE=1 (cache only), WV_CONTACT (email/URL for the User-Agent)`;

type Opts = Record<string, string[]>;
function parseArgs(argv: string[]): { cmd: string; o: Opts } {
  const [cmd = "help", ...rest] = argv;
  const o: Opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) throw new Error(`Unexpected argument "${a}". Options start with --. Quote values with spaces.`);
    const eq = a.indexOf("=");
    let k: string, v: string;
    if (eq > 0) { k = a.slice(2, eq); v = a.slice(eq + 1); }
    else if (a.startsWith("--no-")) { k = a.slice(2); v = "true"; }
    else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) { k = a.slice(2); v = rest[++i]; }
    else { k = a.slice(2); v = "true"; }
    (o[k] ||= []).push(v);
  }
  return { cmd, o };
}
const one = (o: Opts, k: string, d?: string) => o[k]?.[o[k].length - 1] ?? d;
const need = (o: Opts, k: string, hint: string) => {
  const v = one(o, k);
  if (!v) throw new Error(`Missing --${k}. ${hint}`);
  return v;
};

function slugify(s: string): string {
  return s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[\s_]+/g, "-").slice(0, 60) || "analysis";
}

function loadAnalysis(pathArg: string): { a: Analysis; dir: string } {
  let p = resolve(pathArg);
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "analysis.json");
  if (!existsSync(p)) throw new Error(`analysis.json not found at ${p}. Run "analyze" first.`);
  return { a: JSON.parse(readFileSync(p, "utf8")) as Analysis, dir: dirname(p) };
}

function topicsFrom(o: Opts): string[] {
  const t = (o.topic || []).flatMap((x) => x.split(";")).map((x) => x.trim()).filter(Boolean);
  if (!t.length) throw new Error(`Missing --topic. Example: --topic "Astronomy" (repeat --topic for several).`);
  return t;
}

async function cmdResolve(o: Opts) {
  const langs = expandLangs(one(o, "langs", "en")!);
  for (const t of topicsFrom(o)) {
    const r = await resolveTopic(t, langs, one(o, "search-lang", "en")!);
    console.log(`"${t}" -> ${r.qid ?? "(no Wikidata item)"} ${r.label}${r.description ? ` — ${r.description}` : ""}`);
    for (const l of langs) console.log(`  ${l}: ${r.titles[l] ?? "— no article"}`);
    console.log(`  (article exists in ${Object.keys(r.titles).length} language editions)`);
    for (const alt of r.alternatives) console.log(`  alt: ${alt.qid} ${alt.label} — ${alt.description || "—"} (covers ${alt.langsCovered}/${langs.length} langs)`);
    if (r.note) console.log(`  note: ${r.note}`);
  }
}

async function cmdAnalyze(o: Opts) {
  const topics = topicsFrom(o);
  const langs = expandLangs(need(o, "langs", "Example: --langs uk,pl,cs"));
  const end: Month = one(o, "end") ? parseMonth(one(o, "end")!) : lastCompleteMonth();
  const months = Number(one(o, "months", "36"));
  const start: Month = one(o, "start") ? parseMonth(one(o, "start")!) : addMonths(end, -(months - 1));
  const redirects = one(o, "no-redirects") !== "true";
  const p: AnalysisParams = {
    topics, langs, start, end,
    access: (one(o, "access", "all-access") as Access),
    redirects,
    redirectCap: Number(one(o, "redirect-cap", langs.length * topics.length > 12 ? "10" : "25")),
    searchLang: one(o, "search-lang", "en")!,
    combine: one(o, "combine") ?? null,
  };
  const t0 = Date.now();
  const a = await runAnalysis(p, (s) => console.error(s));
  const name = one(o, "name") || slugify(`${(p.combine ? [p.combine] : a.topics.map((t) => t.label)).join("-")}-${langs.length > 4 ? `${langs.length}langs` : langs.join("-")}-${p.start}-${p.end}`);
  const dir = resolve(one(o, "out", "wv-output")!, name);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {};
  writeFileSync((files.analysis = join(dir, "analysis.json")), JSON.stringify(a, null, 1));
  const ui = one(o, "ui") === "en" ? "en" : "uk"; // reports are Ukrainian unless --ui en
  writeFileSync((files.summary = join(dir, "summary.md")), markdownSummary(a, ui));
  const csv = ["series,lang,topic,month,views,edition_views,per_million"];
  for (const s of a.series) s.views.forEach((v, i) => csv.push([JSON.stringify(s.id), s.lang, JSON.stringify(s.topic), s.months[i], v, s.editionViews[i] ?? "", Number.isFinite(s.perMillion[i]) ? s.perMillion[i].toFixed(3) : ""].join(",")));
  writeFileSync((files.csv = join(dir, "data.csv")), csv.join("\n"));
  const hasData = a.series.some((s) => s.metrics);
  if (hasData) {
    const mode = (one(o, "chart") as TrendMode) || (new Set(a.series.map((s) => s.lang)).size > 1 || a.series.length > 1 ? "index" : "views");
    const tsvg = trendChart(a, mode, 640, 300, ui);
    const gsvg = growthChart(a, 640, ui);
    writeFileSync((files.trend_svg = join(dir, "trend.svg")), tsvg);
    writeFileSync((files.growth_svg = join(dir, "growth.svg")), gsvg);
    if (one(o, "no-png") !== "true") {
      try {
        writeFileSync((files.trend_png = join(dir, "trend.png")), await svgToPng(tsvg));
        writeFileSync((files.growth_png = join(dir, "growth.png")), await svgToPng(gsvg));
      } catch (e) {
        console.error(`PNG export failed (${(e as Error).message}); SVG files are still available.`);
      }
    }
  }
  if (one(o, "json") === "true") { console.log(JSON.stringify(a)); return; }
  console.log(stdoutSummary(a, files));
  console.log(`\nNEXT: write notes.md (## answer, ## recommendations, ## caveats) then:\n  node ${relScript()} report --analysis ${dir} --notes notes.md`);
  console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s, ${netStats.network} network requests, ${netStats.cacheHits} from cache]`);
}

function relScript() {
  return join(dirname(new URL(import.meta.url).pathname), "wv.ts");
}

async function cmdReport(o: Opts) {
  const { buildReport, parseNotes, checkClaims } = await import("./lib/report.ts");
  const { a, dir } = loadAnalysis(need(o, "analysis", "Pass the directory printed by analyze."));
  const notesPath = one(o, "notes");
  let notes = null;
  let issues: string[] = [];
  if (notesPath) {
    const md = readFileSync(resolve(notesPath), "utf8");
    notes = parseNotes(md);
    issues = checkClaims(md, a);
  }
  const ui: "en" | "uk" = one(o, "ui") === "en" ? "en" : "uk"; // reports are Ukrainian unless --ui en
  const topicNames = a.topics.map((t) => (ui === "uk" ? t.titles.uk ?? t.label : t.label)).join(", ");
  const title = one(o, "title") || (ui === "uk" ? `Інтерес у Вікіпедії: ${topicNames} (${a.params.langs.join(", ")})` : `Wikipedia interest: ${topicNames} (${a.params.langs.join(", ")})`);
  const mode = (one(o, "chart") as TrendMode) || (a.series.length > 1 ? "index" : "views");
  const out = resolve(one(o, "out") || join(dir, "report.pdf"));
  const r = await buildReport(a, { title, notes, ui, chart: mode, out });
  if (ui === "uk" && notesPath) {
    const txt = readFileSync(resolve(notesPath), "utf8").replace(/\[[a-z-]+\]|[A-Za-z]+:[^\s]+/g, "");
    const cyr = (txt.match(/[а-щьюяґєіїА-ЩЬЮЯҐЄІЇʼ']/g) || []).length;
    const lat = (txt.match(/[A-Za-z]/g) || []).length;
    if (cyr < lat) r.warnings.push("notes.md does not look Ukrainian. Reports must be in Ukrainian: rewrite notes.md in Ukrainian and re-run report.");
  }
  console.log(`PDF: ${r.path}${r.scale < 1 ? ` (content scaled to ${Math.round(r.scale * 100)}% to fit one page)` : ""}`);
  for (const w of r.warnings) console.log(`WARNING: ${w}`);
  if (issues.length) { console.log("CLAIM CHECK — fix these in notes.md and re-run report:"); for (const i of issues) console.log(`  - ${i}`); }
  else if (notesPath) console.log("CLAIM CHECK: all percentages in notes match computed figures.");
}

async function cmdCheck(o: Opts) {
  const { checkClaims } = await import("./lib/report.ts");
  const { a } = loadAnalysis(need(o, "analysis", ""));
  const md = readFileSync(resolve(need(o, "notes", "")), "utf8");
  const issues = checkClaims(md, a);
  console.log(issues.length ? issues.map((i) => `- ${i}`).join("\n") : "OK: all percentages match computed figures.");
  const low = a.series.filter((s) => s.metrics && s.confidence === "low").map((s) => s.id);
  if (low.length && !/(caveat|limitation|обмежен|застереж|low confidence|низьк)/i.test(md)) console.log(`- Low-confidence series (${low.join(", ")}) but notes have no caveats section.`);
}

async function cmdTop(o: Opts) {
  const lang = need(o, "lang", "Example: --lang uk");
  if (lang === "ru") throw new Error('"ru" is excluded from this skill. Choose another language edition.');
  const month = one(o, "month") ? parseMonth(one(o, "month")!) : lastCompleteMonth();
  const limit = Number(one(o, "limit", "30"));
  const grep = one(o, "grep");
  const re = grep ? new RegExp(grep, "i") : null;
  const arts = (await topArticles(lang, month)).filter((x) => !/^(Special|Спеціальна|Specjalna|Speciální|Spezial|Wikipedia|Вікіпедія|Main_Page|Головна_сторінка)[:_]/i.test(x.article) && x.article !== "-");
  const hits = re ? arts.filter((x) => re.test(x.article.replace(/_/g, " "))) : arts;
  console.log(`Top articles ${lang}.wikipedia ${month}${re ? ` matching /${grep}/i` : ""} (from the top-1000 list):`);
  for (const x of hits.slice(0, limit)) console.log(`  #${x.rank}  ${x.article.replace(/_/g, " ")}  ${int(x.views)}`);
  if (!hits.length) console.log("  (none — the top list only has ~1000 articles; use analyze for specific topics)");
}

async function cmdCache(o: Opts) {
  if (one(o, "clear") === "true") { rmSync(CACHE_DIR, { recursive: true, force: true }); console.log(`Cleared ${CACHE_DIR}`); }
  else console.log(`Cache dir: ${CACHE_DIR} (completed months are cached ~6 months, lookups 7 days, current month 12h)`);
}

async function cmdDoctor() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  console.log(`node ${process.versions.node}: ${maj > 22 || (maj === 22 && min >= 18) ? "OK" : "TOO OLD — need >= 22.18 (runs .ts natively)"}`);
  for (const dep of ["pdfkit", "svg-to-pdfkit", "@resvg/resvg-js", "dejavu-fonts-ttf"]) {
    try { await import(dep === "dejavu-fonts-ttf" ? "./lib/chart.ts" : dep); if (dep === "dejavu-fonts-ttf") (await import("./lib/chart.ts")).fontPath(); console.log(`${dep}: OK`); }
    catch { console.log(`${dep}: MISSING — run "npm ci" in ${join(dirname(relScript()), "..")}`); }
  }
  console.log(`cache: ${CACHE_DIR}`);
  try {
    const { projectMonthly } = await import("./lib/wiki.ts");
    const m = await projectMonthly("en", "2024-01" as Month, "2024-02" as Month);
    console.log(`wikimedia API: ${m.size ? "OK" : "reachable but empty"}`);
  } catch (e) { console.log(`wikimedia API: NOT REACHABLE (${(e as Error).message.slice(0, 120)})`); }
}

async function main() {
  const { cmd, o } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case "resolve": return cmdResolve(o);
    case "analyze": return cmdAnalyze(o);
    case "report": return cmdReport(o);
    case "check": return cmdCheck(o);
    case "top": return cmdTop(o);
    case "cache": return cmdCache(o);
    case "doctor": return cmdDoctor();
    default: console.log(HELP);
  }
}

main().catch((e: Error) => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});

export { pct };
