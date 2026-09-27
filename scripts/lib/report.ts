// One-page PDF report: agent-written notes + auto charts/table/method. Also checks numeric claims.
import PDFDocument from "pdfkit";
// @ts-expect-error no types shipped
import SVGtoPDF from "svg-to-pdfkit";
import { createWriteStream } from "node:fs";
import { type Analysis, pct, seriesLabel } from "./analyze.ts";
import { DIRECTION_UK, CONFIDENCE_UK } from "./i18n.ts";
import { trendChart, growthChart, fontPath, type TrendMode } from "./chart.ts";
import { int } from "./format.ts";

export interface NoteSection { heading: string; body: string[] }

/** Parse notes markdown: optional "# Title", then "## Heading" sections with paragraphs / "- " bullets. */
export function parseNotes(md: string): { title: string | null; sections: NoteSection[] } {
  let title: string | null = null;
  const sections: NoteSection[] = [];
  let cur: NoteSection | null = null;
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (/^#\s+/.test(line) && !title && !cur) { title = line.replace(/^#\s+/, ""); continue; }
    const h = /^#{2,3}\s+(.*)$/.exec(line);
    if (h) { cur = { heading: h[1].trim(), body: [] }; sections.push(cur); continue; }
    if (!line.trim()) { if (cur && cur.body.length && cur.body[cur.body.length - 1] !== "") cur.body.push(""); continue; }
    if (!cur) { cur = { heading: "", body: [] }; sections.push(cur); }
    const isBullet = /^\s*[-*•]\s+/.test(line);
    if (!isBullet && cur.body.length && cur.body[cur.body.length - 1] !== "" && !/^\s*[-*•]\s+/.test(cur.body[cur.body.length - 1])) {
      cur.body[cur.body.length - 1] += " " + line.trim();
    } else cur.body.push(isBullet ? "• " + line.replace(/^\s*[-*•]\s+/, "") : line.trim());
  }
  for (const s of sections) while (s.body.length && s.body[s.body.length - 1] === "") s.body.pop();
  return { title, sections };
}

/** Find percentages in the notes that don't match any figure in the analysis (±tolerance pp). */
export function checkClaims(notes: string, a: Analysis, tolPP = 1.5): string[] {
  const allowed: number[] = [90, 100, 50];
  for (const s of a.series) {
    const m = s.metrics;
    if (!m) continue;
    const vals = [m.growth, m.growthRelative, m.growthMedianBased, m.growthDespiked, m.editionGrowth, m.trendAnnualPct, ...m.growthCI90, ...m.growthRelativeCI90];
    if (m.prevGrowth !== null) vals.push(m.prevGrowth);
    for (const v of vals) if (Number.isFinite(v)) allowed.push(v * 100, Math.abs(v * 100));
    if (m.monthsCompared) allowed.push((m.monthsUp / m.monthsCompared) * 100, (m.monthsDown / m.monthsCompared) * 100);
  }
  for (const c of a.comparisons) allowed.push(c.diffPP, Math.abs(c.diffPP));
  // ratios between series levels (e.g. "3x more") are not checked; only percentages.
  const issues: string[] = [];
  const re = /([+\-−–]?\d+(?:[.,]\d+)?)\s?(%|pp|п\.п\.|в\.п\.)/g;
  for (const m of notes.matchAll(re)) {
    const v = parseFloat(m[1].replace(/[−–]/, "-").replace(",", "."));
    if (!allowed.some((x) => Math.abs(x - v) <= tolPP)) issues.push(`"${m[0]}" does not match any computed figure (±${tolPP} pp). Check it against analysis.json or rephrase.`);
  }
  return issues;
}

const T = {
  en: { method: "Method & data", limits: "Limitations", series: "Series", views: "Views/mo", per1m: "Per 1M", growth: "Growth (90% CI)", rel: "Relative", up: "vs yr ago", conf: "Confidence", answer: "Summary", source: "Source: Wikimedia Analytics API (pageviews, agent=user)" },
  uk: { method: "Методика й дані", limits: "Обмеження", series: "Ряд", views: "Перегл./міс", per1m: "На 1 млн", growth: "Зміна (90% ДІ)", rel: "Відносна", up: "vs рік тому", conf: "Довіра", answer: "Висновок", source: "Джерело: Wikimedia Analytics API (перегляди, agent=user)" },
};
const METHOD: Record<string, string> = {
  en: "Monthly pageviews (agent=user) of the article plus its redirects. Growth = last 12 complete months vs the same months a year earlier; 90% CI by paired bootstrap over months. Relative = change of the article's share of all views of that language edition (removes edition-wide trends). Confidence combines volume, interval, month-by-month consistency, spike sensitivity and raw-vs-relative agreement.",
  uk: "Місячні перегляди (agent=user) статті разом із її перенаправленнями. Зміна = останні 12 повних місяців проти тих самих місяців роком раніше; 90% довірчий інтервал — парний бутстреп по місяцях. Відносна зміна = зміна частки статті в усіх переглядах мовного розділу (прибирає загальні тренди розділу). Рівень довіри враховує обсяг, інтервал, узгодженість по місяцях, чутливість до сплесків і збіг сирої та відносної динаміки.",
};
const LIMITS: Record<string, string> = {
  en: "Pageviews show attention, not willingness to pay. One article is a proxy for a topic; interest may go to related articles, other language editions or AI/search answers. Language edition ≠ country. News events, school calendars and misclassified bots can distort figures.",
  uk: "Перегляди показують увагу, а не готовність платити. Одна стаття — лише проксі теми: інтерес може йти на суміжні статті, інші мовні розділи чи відповіді пошуку/ШІ. Мовний розділ ≠ країна. Новини, навчальний календар і неправильно класифіковані боти можуть спотворювати дані.",
};

export interface ReportOptions {
  title: string;
  notes: { title: string | null; sections: NoteSection[] } | null;
  ui: "en" | "uk";
  chart: TrendMode;
  out: string;
}

export const confLabel = (c: string, ui: "en" | "uk") => (ui === "uk" ? ({ high: "висока", medium: "середня", low: "низька" } as Record<string, string>)[c] ?? c : c);
const INK = "#0b0b0b", INK2 = "#52514e", RULE = "#d9d8d3", TINT = "#eef4fc";

function autoSummary(a: Analysis, ui: "en" | "uk"): NoteSection {
  const body = a.series.filter((s) => s.metrics).slice(0, 6).map((s) => {
    const m = s.metrics!;
    return ui === "uk"
      ? `• ${seriesLabel(s, "uk")}: ${DIRECTION_UK[s.direction]} — ${pct(m.growth)} за рік (90% ДІ ${pct(m.growthCI90[0], 0)}…${pct(m.growthCI90[1], 0)}), відносно розділу ${pct(m.growthRelative)}; довіра — ${CONFIDENCE_UK[s.confidence]}.`
      : `• ${s.id}: ${pct(m.growth)} year-over-year (relative ${pct(m.growthRelative)}), confidence ${s.confidence}.`;
  });
  for (const s of a.series.filter((x) => x.status === "no_article")) body.push(ui === "uk" ? `• ${seriesLabel(s, "uk")}: статті немає — прогалина в контенті, а не нульовий інтерес.` : `• ${s.id}: no article (content gap).`);
  return { heading: T[ui].answer, body };
}

export async function buildReport(a: Analysis, o: ReportOptions): Promise<{ path: string; warnings: string[]; scale: number }> {
  const warnings: string[] = [];
  const t = T[o.ui];
  const sections = o.notes?.sections.length ? o.notes.sections : [autoSummary(a, o.ui)];
  if (!o.notes) warnings.push("No --notes given: the PDF uses an auto-generated summary. Write notes.md with your answer + recommendations for a better report.");
  const [lead, ...rest] = sections;
  const tableRows = a.series.filter((s) => s.metrics).sort((x, y) => y.metrics!.avgMonthlyRecent - x.metrics!.avgMonthlyRecent);
  const shownRows = tableRows.slice(0, 10);
  if (tableRows.length > shownRows.length) warnings.push(`Table shows the 10 largest of ${tableRows.length} series.`);
  const missing = a.series.filter((s) => !s.metrics).map((s) => seriesLabel(s, o.ui));

  const doc = new PDFDocument({ size: "A4", margins: { top: 36, left: 36, right: 36, bottom: 16 }, autoFirstPage: true, info: { Title: o.title, Creator: a.tool } });
  let pages = 1;
  doc.on("pageAdded", () => pages++);
  doc.registerFont("R", fontPath(false));
  doc.registerFont("B", fontPath(true));
  const W = doc.page.width - 72, X = 36, PAGE_BOTTOM = doc.page.height - 30;

  // Layout pass: try decreasing scales until everything fits on one page.
  const trendSvg = trendChart(a, o.chart, 640, 250, o.ui);
  const growthSvg = growthChart(a, 640, o.ui);
  const gH = Number(/height="(\d+)"/.exec(growthSvg)![1]);

  const paraHeight = (text: string, size: number, width: number) => { doc.font("R").fontSize(size); return doc.heightOfString(text.replace(/\*\*/g, ""), { width, lineGap: 1 }); };
  const sectionHeight = (s: NoteSection, size: number, width: number) => (s.heading ? size + 6 : 0) + s.body.reduce((h, b) => h + (b === "" ? size * 0.5 : paraHeight(b, size, width - (b.startsWith("• ") ? 8 : 0)) + 2), 0);

  let chosen = 1;
  const measure = (k: number) => {
    const fs = 9.5 * k;
    const chartW = W * Math.min(1, 0.72 + 0.28 * k);
    let h = 22 + 14; // title + meta
    h += sectionHeight(lead, fs + 0.5, W - 16) + 16; // lead box
    h += (250 * chartW) / 640 + 6 + (gH * chartW) / 640 + 6;
    h += 14 + shownRows.length * 12 * Math.max(0.85, k) + (missing.length ? 12 : 0) + 8;
    for (const s of rest) h += sectionHeight(s, fs, W) + 6;
    h += sectionHeight({ heading: t.method, body: [METHOD[o.ui]] }, 7.2, W) + sectionHeight({ heading: t.limits, body: [LIMITS[o.ui]] }, 7.2, W) + 10;
    return h;
  };
  for (const k of [1, 0.93, 0.86, 0.8, 0.74, 0.68]) { chosen = k; if (36 + measure(k) <= PAGE_BOTTOM) break; }
  if (36 + measure(chosen) > PAGE_BOTTOM) warnings.push("Content is too long for one page even at the smallest scale; the bottom will be cut. Shorten notes.md (aim for ~200 words).");
  const k = chosen;
  const fs = 9.5 * k;
  const chartW = W * Math.min(1, 0.72 + 0.28 * k);

  let y = 36;
  const richText = (text: string, size: number, x: number, width: number, color = INK) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/).filter(Boolean);
    doc.fillColor(color).fontSize(size);
    doc.text("", x, y, { width, lineGap: 1, continued: parts.length > 1 });
    parts.forEach((p, i) => {
      const bold = p.startsWith("**") && p.endsWith("**");
      doc.font(bold ? "B" : "R").text(bold ? p.slice(2, -2) : p, { width, lineGap: 1, continued: i < parts.length - 1 });
    });
    y = doc.y;
  };
  const drawSection = (s: NoteSection, size: number, x: number, width: number, headColor = INK) => {
    if (s.heading) { doc.font("B").fontSize(size + 0.5).fillColor(headColor).text(s.heading, x, y, { width }); y = doc.y + 2; }
    for (const b of s.body) {
      if (b === "") { y += size * 0.5; continue; }
      if (b.startsWith("• ")) { doc.font("R").fontSize(size).fillColor(INK).text("•", x, y); richText(b.slice(2), size, x + 8, width - 8); }
      else richText(b, size, x, width);
      y += 2;
    }
  };

  // Title + meta
  const title = o.notes?.title || o.title;
  doc.font("B").fontSize(15.5).fillColor(INK).text(title, X, y, { width: W });
  y = doc.y + 2;
  const p = a.params;
  doc.font("R").fontSize(7.8).fillColor(INK2).text(`${p.langs.join(", ")} · ${p.start} – ${p.end} · ${a.topics.map((tp) => `${o.ui === "uk" ? tp.titles.uk ?? tp.label : tp.label}${tp.qid ? ` (${tp.qid})` : ""}`).join(", ")} · ${t.source} · ${a.generatedAt.slice(0, 10)}`, X, y, { width: W });
  y = doc.y + 6;

  // Lead box
  const leadH = sectionHeight(lead, fs + 0.5, W - 16);
  doc.roundedRect(X, y, W, leadH + 12, 4).fill(TINT);
  y += 6;
  drawSection(lead, fs + 0.5, X + 8, W - 16);
  y += 10;

  // Charts
  const cx = X + (W - chartW) / 2;
  const fontCallback = (_family: string, bold: boolean) => (bold ? "B" : "R");
  SVGtoPDF(doc, trendSvg, cx, y, { width: chartW, height: (250 * chartW) / 640, fontCallback, assumePt: false });
  y += (250 * chartW) / 640 + 6;
  SVGtoPDF(doc, growthSvg, cx, y, { width: chartW, height: (gH * chartW) / 640, fontCallback, assumePt: false });
  y += (gH * chartW) / 640 + 6;

  // Table
  const cols = [
    { h: t.series, w: 0.23 }, { h: t.views, w: 0.11 }, { h: t.per1m, w: 0.09 }, { h: t.growth, w: 0.2 },
    { h: t.rel, w: 0.09 }, { h: t.up, w: 0.12 }, { h: t.conf, w: 0.15 },
  ];
  const tfs = 7.6 * Math.max(0.9, k);
  const rowH = 12 * Math.max(0.85, k);
  let tx = X;
  doc.font("B").fontSize(tfs * 0.92).fillColor(INK2);
  for (const c of cols) { doc.text(c.h, tx, y, { width: c.w * W - 4, lineBreak: false }); tx += c.w * W; }
  y += rowH;
  doc.moveTo(X, y - 2).lineTo(X + W, y - 2).lineWidth(0.5).strokeColor(RULE).stroke();
  for (const s of shownRows) {
    const m = s.metrics!;
    const cells = [
      seriesLabel(s, o.ui), int(m.avgMonthlyRecent), m.perMillionRecent.toFixed(1),
      `${pct(m.growth, 0)} [${pct(m.growthCI90[0], 0)}, ${pct(m.growthCI90[1], 0)}]`, pct(m.growthRelative, 0),
      `${m.monthsUp}↑ ${m.monthsDown}↓`, confLabel(s.confidence, o.ui) + (s.status !== "ok" ? "*" : ""),
    ];
    tx = X;
    doc.font("R").fontSize(tfs).fillColor(INK);
    const fit = (txt: string, w: number) => {
      if (doc.widthOfString(txt) <= w) return txt;
      const m = /^(.*?)( \[[a-z-]+\])$/.exec(txt); // keep the language code visible
      const tail = m ? m[2] : "";
      let head = m ? m[1] : txt;
      while (head.length > 1 && doc.widthOfString(head + "…" + tail) > w) head = head.slice(0, -1);
      return head + "…" + tail;
    };
    cells.forEach((c, i) => { doc.text(fit(c, cols[i].w * W - 6), tx, y, { width: cols[i].w * W - 4, lineBreak: false, ellipsis: true }); tx += cols[i].w * W; });
    y += rowH;
  }
  if (missing.length) {
    doc.font("R").fontSize(tfs).fillColor(INK2).text((o.ui === "uk" ? "Немає статті/даних: " : "No article/data: ") + missing.join(", "), X, y, { width: W, lineBreak: false, ellipsis: true });
    y += rowH;
  }
  y += 6;

  for (const s of rest) { drawSection(s, fs, X, W); y += 4; }

  // Method + limitations (small print)
  doc.moveTo(X, y).lineTo(X + W, y).lineWidth(0.5).strokeColor(RULE).stroke();
  y += 4;
  drawSection({ heading: t.method, body: [METHOD[o.ui]] }, 7.2, X, W, INK2);
  drawSection({ heading: t.limits, body: [LIMITS[o.ui]] }, 7.2, X, W, INK2);

  if (pages > 1) warnings.push("PDF spilled onto more than one page; shorten notes.md.");
  await new Promise<void>((res, rej) => {
    const ws = createWriteStream(o.out);
    ws.on("finish", () => res());
    ws.on("error", rej);
    doc.pipe(ws);
    doc.end();
  });
  return { path: o.out, warnings, scale: k };
}
