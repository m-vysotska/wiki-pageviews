// Human/agent-readable summaries of an Analysis.
import { type Analysis, type SeriesResult, pct, seriesLabel } from "./analyze.ts";
import { type Ui, tr, trUk, DIRECTION_UK, CONFIDENCE_UK } from "./i18n.ts";

export const int = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "n/a");
const ci = (c: [number, number]) => (Number.isFinite(c[0]) ? `[${pct(c[0], 0)}, ${pct(c[1], 0)}]` : "n/a");

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

export function seriesTable(a: Analysis): string {
  const w = a.series.find((s) => s.metrics)?.metrics?.windowMonths ?? 12;
  const head = ["series", "article", `avg/mo(last${w})`, "per1M", "growth", "90%CI", "rel.growth", "months↑", "trend", "confidence"];
  const rows = a.series.map((s) => {
    const m = s.metrics;
    if (!m) return [s.id, s.title ?? "—", "—", "—", "—", "—", "—", "—", s.status, "—"];
    return [
      s.id, s.title ?? "—", int(m.avgMonthlyRecent), m.perMillionRecent.toFixed(1), pct(m.growth), ci(m.growthCI90),
      pct(m.growthRelative), `${m.monthsUp}/${m.monthsCompared}`, s.direction + (s.status !== "ok" ? "*" : ""), s.confidence,
    ];
  });
  const widths = head.map((h, i) => Math.min(28, Math.max(h.length, ...rows.map((r) => String(r[i]).length))));
  return [head, ...rows].map((r) => r.map((c, i) => pad(String(c), widths[i])).join("  ")).join("\n");
}

export function stdoutSummary(a: Analysis, files: Record<string, string>): string {
  const p = a.params;
  const out: string[] = [];
  out.push(`PERIOD ${p.start}..${p.end} (${a.series[0]?.months.length ?? 0} months) | metric: monthly pageviews, agent=user, ${p.access}${p.redirects ? ", incl. redirects" : ""}`);
  out.push("TOPICS");
  for (const t of a.topics) {
    out.push(`  "${t.input}" -> ${t.qid ?? "no Wikidata item"} ${t.label}${t.description ? ` (${t.description})` : ""}`);
    if (t.alternatives.length) out.push(`     other matches: ${t.alternatives.map((x) => `${x.qid} ${x.label} (${x.description || "—"})`).join("; ")}`);
  }
  out.push("");
  out.push(seriesTable(a));
  out.push("  growth = last 12 months vs previous 12 (same calendar months); rel.growth = same for share of the edition's total traffic;");
  out.push("  per1M = views per 1M pageviews of that language edition (comparable across languages); months↑ = months higher than a year before");
  out.push("");
  out.push("KEY FACTS (accurate sentences — safe to quote or translate; don't add claims beyond these)");
  out.push(...keyFacts(a).map((f) => `  - ${f}`));
  const ranked = a.series.filter((s) => s.metrics && s.status === "ok");
  if (a.comparisons.length) {
    out.push("");
    out.push("PAIRWISE (growth difference; 'yes' = 90% intervals do not overlap)");
    for (const c of a.comparisons.slice(0, 12)) out.push(`  ${c.a} vs ${c.b}: ${c.diffPP >= 0 ? "+" : ""}${c.diffPP.toFixed(1)} pp, distinguishable: ${c.distinguishable ? "yes" : "no"}`);
    if (a.comparisons.length > 12) out.push(`  … ${a.comparisons.length - 12} more in analysis.json`);
  }
  out.push("");
  out.push("CONFIDENCE REASONS");
  for (const s of a.series) out.push(`  ${s.id}: ${s.confidence} — ${s.confidenceReasons.join("; ")}`);
  const flags = a.series.flatMap((s) => s.flags.map((f) => `  ${s.id}: ${f}`));
  if (flags.length || a.notes.length) {
    out.push("");
    out.push("FLAGS (mention relevant ones to the user)");
    out.push(...a.notes.map((n) => `  ${n}`), ...flags);
  }
  if (ranked.length > 2) {
    out.push("");
    out.push(`RANK by growth: ${[...ranked].sort((x, y) => y.metrics!.growth - x.metrics!.growth).map((s) => `${s.id} ${pct(s.metrics!.growth, 0)}`).join(" > ")}`);
    out.push(`RANK by level (per1M): ${[...ranked].sort((x, y) => y.metrics!.perMillionRecent - x.metrics!.perMillionRecent).map((s) => `${s.id} ${s.metrics!.perMillionRecent.toFixed(1)}`).join(" > ")}`);
  }
  out.push("");
  out.push("FILES");
  for (const [k, v] of Object.entries(files)) out.push(`  ${k}: ${v}`);
  return out.join("\n");
}

function seriesSentence(s: SeriesResult, ui: Ui): string {
  const m = s.metrics;
  const name = seriesLabel(s, ui);
  if (!m) return `- **${name}**: ${tr(s.flags[0] ?? s.status, ui)}.`;
  const w = m.windowMonths;
  if (ui === "uk") {
    return `- **${name}** (${s.title}): ${int(m.avgMonthlyRecent)} переглядів/міс; останні ${w} міс. ${pct(m.growth)} порівняно з попередніми ${w} (90% ДІ ${ci(m.growthCI90)}), ` +
      `відносно трафіку розділу ${pct(m.growthRelative)}; ${m.monthsUp} з ${m.monthsCompared} місяців вищі, ніж рік тому. ` +
      `Напрям: ${DIRECTION_UK[s.direction]}; довіра: **${CONFIDENCE_UK[s.confidence]}** (${s.confidenceReasons.map(trUk).join("; ")}).`;
  }
  return `- **${s.id}** (${s.title}): ${int(m.avgMonthlyRecent)} views/month; last ${w} months ${pct(m.growth)} vs previous ${w} (90% CI ${ci(m.growthCI90)}), ` +
    `relative to edition traffic ${pct(m.growthRelative)}; ${m.monthsUp}/${m.monthsCompared} months up year-over-year. ` +
    `Direction: ${s.direction}; confidence: **${s.confidence}** (${s.confidenceReasons.join("; ")}).`;
}

/** Human-readable summary file. Ukrainian by default. */
export function markdownSummary(a: Analysis, ui: Ui = "uk"): string {
  const p = a.params;
  const uk = ui === "uk";
  const label = (id: string) => { const s = a.series.find((x) => x.id === id); return s ? seriesLabel(s, ui) : id; };
  const lines: string[] = [];
  const topicNames = a.topics.map((t) => (uk ? t.titles.uk ?? t.label : t.label)).join(", ");
  lines.push(uk ? `# Інтерес у Вікіпедії: ${topicNames}` : `# Wikipedia interest: ${topicNames}`);
  lines.push("");
  lines.push(uk
    ? `Мовні розділи: ${p.langs.join(", ")} · Період: ${p.start} – ${p.end} · Створено ${a.generatedAt.slice(0, 10)}`
    : `Languages: ${p.langs.join(", ")} · Period: ${p.start} – ${p.end} · Generated ${a.generatedAt.slice(0, 10)}`);
  lines.push("");
  lines.push(uk ? "## Ряди даних" : "## Series");
  lines.push(...a.series.map((s) => seriesSentence(s, ui)));
  if (a.comparisons.length) {
    lines.push("", uk ? "## Попарні відмінності у зростанні" : "## Pairwise differences in growth");
    for (const c of a.comparisons) {
      const d = `${c.diffPP >= 0 ? "+" : ""}${c.diffPP.toFixed(1)}`;
      lines.push(uk
        ? `- ${label(c.a)} проти ${label(c.b)}: ${d} в.п. — ${c.distinguishable ? "різниця статистично розрізняється" : "різниця не розрізняється на рівні 90%"}`
        : `- ${c.a} vs ${c.b}: ${d} pp — ${c.distinguishable ? "distinguishable" : "not distinguishable at 90%"}`);
    }
  }
  const flags = [...a.notes.map((n) => tr(n, ui)), ...a.series.flatMap((s) => s.flags.map((f) => `${seriesLabel(s, ui)}: ${tr(f, ui)}`))];
  if (flags.length) lines.push("", uk ? "## Застереження та прапорці" : "## Flags", ...flags.map((f) => `- ${f}`));
  lines.push("", uk ? "## Методика" : "## Method", uk ? METHOD_TEXT_UK : METHOD_TEXT);
  lines.push("", uk ? "## Обмеження" : "## Limitations", uk ? LIMITATIONS_UK : LIMITATIONS);
  return lines.join("\n");
}

export const METHOD_TEXT_UK =
  "Місячні перегляди з Wikimedia Analytics API (agent=user, тобто без ідентифікованих ботів і автоматичного трафіку), " +
  "стаття разом із перенаправленнями. Зміна = останні 12 повних місяців проти тих самих 12 календарних місяців роком раніше; " +
  "90% інтервал — парний бутстреп по місяцях. «Відносна» зміна — зміна частки статті в усіх переглядах мовного розділу, " +
  "що прибирає загальні тренди розділу (наприклад, спад трафіку Вікіпедії). Довіра враховує обсяг, інтервал, узгодженість по місяцях, " +
  "чутливість до сплесків і збіг сирої та відносної динаміки.";

export const LIMITATIONS_UK =
  "Перегляди показують увагу, а не готовність платити. Одна стаття — лише проксі теми: інтерес може йти на суміжні статті, " +
  "інші мовні розділи (наприклад, англомовну Вікіпедію) або інші джерела (пошук, ШІ-асистенти), що знижує перегляди без зниження інтересу. " +
  "Мовний розділ ≠ країна. Новини, навчальний календар, боти, класифіковані як люди, та перейменування статей можуть спотворювати дані.";

export const METHOD_TEXT =
  "Monthly pageviews from the Wikimedia Analytics API (agent=user, i.e. excluding identified bots/automated traffic), " +
  "summing the article and its redirects. Growth compares the last 12 complete months with the same 12 calendar months a year earlier; " +
  "the 90% interval is a paired bootstrap over months. 'Relative' growth uses the article's share of all pageviews of that language edition, " +
  "which removes edition-wide trends (e.g. overall Wikipedia traffic decline). Confidence combines volume, interval, month-by-month consistency, " +
  "spike sensitivity and raw-vs-relative agreement.";

export const LIMITATIONS =
  "Pageviews measure attention, not purchase intent. One article is a proxy for a topic: interest can also land on related articles, " +
  "other languages (e.g. users reading English Wikipedia) or other sources (search snippets, AI assistants), which lowers Wikipedia views without lower interest. " +
  "Language editions ≠ countries. News events, school calendars, bots misclassified as users and article renames/merges can distort figures.";


/** Plain-language, correct statements an agent can reuse verbatim. */
export function keyFacts(a: Analysis): string[] {
  const facts: string[] = [];
  const w = a.series.find((s) => s.metrics)?.metrics?.windowMonths ?? 12;
  for (const s of a.series) {
    const m = s.metrics;
    if (!m) { facts.push(`${s.id}: ${s.flags[0] ?? s.status}.`); continue; }
    const dirWord = { growing: "is growing", declining: "is declining", flat: "is roughly flat", unclear: "shows no clear change" }[s.direction];
    let f = `${s.id} ${dirWord}: ${int(m.totalRecent)} views in the last ${w} months, ${pct(m.growth)} vs the ${w} months before (90% CI ${ci(m.growthCI90)}); ` +
      `${m.monthsDown > m.monthsUp ? `${m.monthsDown} of ${m.monthsCompared} months were lower` : `${m.monthsUp} of ${m.monthsCompared} months were higher`} than a year earlier.`;
    if (Number.isFinite(m.growthRelative)) {
      f += ` The whole ${s.lang} Wikipedia changed ${pct(m.editionGrowth)}; the topic's SHARE of ${s.lang} Wikipedia views changed ${pct(m.growthRelative)}` +
        (m.growthRelative > m.growth ? " (so part of the raw change is the edition-wide trend)." : ".");
    }
    if (m.spikes.length && Number.isFinite(m.growthDespiked) && Math.abs(m.growthDespiked - m.growth) >= 0.005) f += ` Without one-off spikes the change is ${pct(m.growthDespiked)}.`;
    if (m.prevGrowth !== null && Number.isFinite(m.prevGrowth)) f += ` One year earlier the same comparison gave ${pct(m.prevGrowth)}.`;
    if (Number.isFinite(m.trendAnnualPct) && s.months.length >= 48) f += ` Long-run trend over ${a.params.start}..${a.params.end}: ${pct(m.trendAnnualPct)} per year (Sen's slope).`;
    f += ` Confidence: ${s.confidence}.`;
    facts.push(f);
  }
  for (const c of a.comparisons) {
    if (!c.distinguishable) facts.push(`${c.a} vs ${c.b}: the difference in growth (${c.diffPP >= 0 ? "+" : ""}${c.diffPP.toFixed(1)} pp) is NOT statistically distinguishable — do not rank these two by growth.`);
    else facts.push(`${c.diffPP > 0 ? c.a : c.b} ${c.diffPP !== 0 ? "grew faster / declined less than" : "matches"} ${c.diffPP > 0 ? c.b : c.a} (difference ${Math.abs(c.diffPP).toFixed(1)} pp, distinguishable).`);
  }
  const ok = a.series.filter((s) => s.metrics && Number.isFinite(s.metrics.perMillionRecent));
  if (ok.length > 1) {
    const top = [...ok].sort((x, y) => y.metrics!.perMillionRecent - x.metrics!.perMillionRecent)[0];
    const big = [...ok].sort((x, y) => y.metrics!.avgMonthlyRecent - x.metrics!.avgMonthlyRecent)[0];
    facts.push(`Highest intensity relative to edition size: ${top.id} (${top.metrics!.perMillionRecent.toFixed(1)} views per 1M edition views). Largest absolute audience: ${big.id} (${int(big.metrics!.avgMonthlyRecent)} views/month).`);
  }
  return facts;
}
