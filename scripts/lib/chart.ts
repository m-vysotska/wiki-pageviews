// Dependency-free SVG charts (light theme, print-friendly). PNG conversion via resvg.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Analysis, SeriesResult } from "./analyze.ts";
import { mean } from "./stats.ts";

// Validated categorical order (CVD-safe adjacent pairs), fixed order, never cycled.
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const INK = "#0b0b0b", INK2 = "#52514e", MUTED = "#8a8984", GRID = "#e4e3df", SURFACE = "#ffffff";
const FONT = "DejaVu Sans";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtNum = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `${Math.round(v)}`);

function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 0.5) || mag * 10;
  const out: number[] = [];
  const top = Math.ceil(hi / step - 1e-9) * step;
  for (let v = Math.floor(lo / step + 1e-9) * step; v <= top + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export type TrendMode = "index" | "views" | "share";
export type Ui = "en" | "uk";
const L = {
  en: {
    index: "Monthly views, indexed (first 12 months = 100)", share: "Views per 1M pageviews of the language edition", views: "Monthly views", log: " (log scale)",
    sub: "3-month rolling mean; faint line = raw month; ○ = detected spike. Source: Wikimedia pageviews (user agent)",
    change: (w: number) => `Change: last ${w} months vs previous ${w}`, raw: "raw views (whisker = 90% CI)", rel: "relative to language-edition total traffic", conf: "conf.",
  },
  uk: {
    index: "Місячні перегляди, індекс (перші 12 місяців = 100)", share: "Переглядів на 1 млн переглядів мовного розділу", views: "Місячні перегляди", log: " (лог. шкала)",
    sub: "Ковзне середнє за 3 міс.; бліда лінія — сирі дані; ○ — разовий сплеск. Дані: Wikimedia (agent=user)",
    change: (w: number) => `Зміна: останні ${w} міс. проти попередніх ${w}`, raw: "сирі перегляди (вуса = 90% ДІ)", rel: "відносно загального трафіку розділу", conf: "довіра",
  },
};

/** Pick up to 8 series to draw (largest recent volume first), keeping a stable colour per series id. */
export function chartSeries(a: Analysis): SeriesResult[] {
  return a.series.filter((s) => s.metrics).sort((x, y) => y.metrics!.avgMonthlyRecent - x.metrics!.avgMonthlyRecent).slice(0, 8);
}
export function colorOf(a: Analysis, id: string): string {
  const idx = a.series.filter((s) => s.metrics).findIndex((s) => s.id === id);
  return SERIES_COLORS[Math.max(0, idx) % SERIES_COLORS.length];
}

export function trendChart(a: Analysis, mode: TrendMode, W = 640, H = 300, ui: Ui = "uk"): string {
  const tx = L[ui];
  const drawn = chartSeries(a);
  const months = a.series[0]?.months || [];
  const n = months.length;
  const lines = drawn.map((s) => {
    let vals: number[];
    if (mode === "share") vals = s.perMillion;
    else if (mode === "index") {
      const first = s.views.findIndex((v) => v > 0);
      const base = mean(s.views.slice(first, first + 12));
      vals = s.views.map((v, i) => (i < first || base <= 0 ? NaN : (v / base) * 100));
    } else vals = s.views;
    // 3-month centred rolling mean to make the trend readable; raw monthly shown faintly.
    const smooth = vals.map((_, i) => {
      const w = vals.slice(Math.max(0, i - 1), i + 2).filter(Number.isFinite);
      return w.length ? mean(w) : NaN;
    });
    return { s, vals, smooth, color: colorOf(a, s.id) };
  });
  const all = lines.flatMap((l) => l.vals).filter((v) => Number.isFinite(v) && v > 0);
  const lo0 = Math.min(...all), hi0 = Math.max(...all);
  const useLog = mode !== "index" && hi0 / Math.max(lo0, 1e-9) > 30;
  const maxLabel = Math.max(0, ...drawn.map((s) => shortId(s, ui).length));
  const M = { l: 52, r: drawn.length <= 4 ? Math.max(90, 24 + maxLabel * 6.2) : 16, t: 34, b: drawn.length > 4 ? 64 : 30 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const x = (i: number) => M.l + (n <= 1 ? 0 : (i / (n - 1)) * pw);
  let y: (v: number) => number;
  let ticks: number[];
  if (useLog) {
    // 1-2-5 ticks, domain snapped to the nearest tick outside the data
    const cands: number[] = [];
    for (let e = Math.floor(Math.log10(lo0)) - 1; e <= Math.ceil(Math.log10(hi0)) + 1; e++) for (const k of [1, 2, 5]) cands.push(k * 10 ** e);
    const dLo = [...cands].reverse().find((c) => c <= lo0) ?? lo0;
    const dHi = cands.find((c) => c >= hi0) ?? hi0;
    const a0 = Math.log10(dLo), b0 = Math.log10(dHi);
    ticks = cands.filter((c) => c >= dLo && c <= dHi);
    if (ticks.length > 7) ticks = ticks.filter((c) => /^1/.test(String(c)) || c === dHi || /^5/.test(String(c)));
    y = (v) => M.t + ph - ((Math.log10(Math.max(v, dLo)) - a0) / (b0 - a0 || 1)) * ph;
  } else {
    const lo = mode === "index" ? Math.min(0, lo0) : 0;
    ticks = niceTicks(lo, hi0 * 1.05);
    const top = ticks[ticks.length - 1];
    y = (v) => M.t + ph - ((v - lo) / (top - lo || 1)) * ph;
  }
  const title = mode === "index" ? tx.index : mode === "share" ? tx.share : `${tx.views}${useLog ? tx.log : ""}`;
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  o.push(`<rect width="${W}" height="${H}" fill="${SURFACE}"/>`);
  o.push(`<text x="${M.l}" y="18" font-size="13" font-weight="bold" fill="${INK}">${esc(title)}</text>`);
  o.push(`<text x="${M.l}" y="30" font-size="9.5" fill="${INK2}">${esc(tx.sub)}</text>`);
  for (const t of ticks) {
    o.push(`<line x1="${M.l}" x2="${M.l + pw}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`);
    o.push(`<text x="${M.l - 6}" y="${(y(t) + 3).toFixed(1)}" font-size="9.5" fill="${INK2}" text-anchor="end">${fmtNum(t)}</text>`);
  }
  if (mode === "index") o.push(`<line x1="${M.l}" x2="${M.l + pw}" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}" stroke="${MUTED}" stroke-dasharray="3 3"/>`);
  // x labels: January of each year
  months.forEach((m, i) => {
    const firstJan = months.findIndex((mm) => mm.endsWith("-01"));
    if (m.endsWith("-01") || (i === 0 && (firstJan < 0 || firstJan > Math.max(3, n / 12)))) {
      o.push(`<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${M.t + ph}" y2="${M.t + ph + 4}" stroke="${MUTED}"/>`);
      o.push(`<text x="${x(i).toFixed(1)}" y="${M.t + ph + 15}" font-size="9.5" fill="${INK2}" text-anchor="middle">${m.endsWith("-01") ? m.slice(0, 4) : m}</text>`);
    }
  });
  const path = (vals: number[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (!Number.isFinite(v) || (useLog && v <= 0)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const labelYs: Array<{ y: number; l: (typeof lines)[number] }> = [];
  for (const l of lines) {
    o.push(`<path d="${path(l.vals)}" fill="none" stroke="${l.color}" stroke-width="1" stroke-opacity="0.35"/>`);
    o.push(`<path d="${path(l.smooth)}" fill="none" stroke="${l.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const sp of l.s.metrics?.spikes || []) {
      const i = months.indexOf(sp.month);
      if (i >= 0 && Number.isFinite(l.vals[i])) o.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(l.vals[i]).toFixed(1)}" r="4" fill="${SURFACE}" stroke="${l.color}" stroke-width="2"/>`);
    }
    const lastI = l.smooth.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0).pop();
    if (lastI !== undefined) labelYs.push({ y: y(l.smooth[lastI]), l });
  }
  if (drawn.length <= 4) {
    // direct labels at line ends, de-collided
    labelYs.sort((p, q) => p.y - q.y);
    for (let i = 1; i < labelYs.length; i++) if (labelYs[i].y - labelYs[i - 1].y < 12) labelYs[i].y = labelYs[i - 1].y + 12;
    const bottom = M.t + ph + 4;
    for (let i = labelYs.length - 1; i >= 0; i--) {
      const limit = i === labelYs.length - 1 ? bottom : labelYs[i + 1].y - 12;
      if (labelYs[i].y > limit) labelYs[i].y = limit;
    }
    for (const { y: ly, l } of labelYs) {
      o.push(`<circle cx="${M.l + pw + 8}" cy="${(ly - 3).toFixed(1)}" r="3.5" fill="${l.color}"/>`);
      o.push(`<text x="${M.l + pw + 15}" y="${ly.toFixed(1)}" font-size="10" fill="${INK}">${esc(shortId(l.s, ui))}</text>`);
    }
  } else {
    // legend below the plot
    let lx = M.l, ly = M.t + ph + 32;
    for (const l of lines) {
      const label = shortId(l.s, ui);
      const w = 16 + label.length * 6;
      if (lx + w > W - 10) { lx = M.l; ly += 14; }
      o.push(`<rect x="${lx}" y="${ly - 7}" width="10" height="3" rx="1" fill="${l.color}"/><text x="${lx + 14}" y="${ly}" font-size="9.5" fill="${INK}">${esc(label)}</text>`);
      lx += w;
    }
  }
  o.push(`</svg>`);
  return o.join("\n");
}

function shortId(s: SeriesResult, ui: Ui = "uk"): string {
  const name = ui === "uk" ? s.topicUk ?? s.topic : s.topic;
  const t = name.length > 16 ? name.slice(0, 15) + "…" : name;
  return `${t} · ${s.lang}`;
}

/** Horizontal bars: YoY growth (raw) with 90% CI whiskers + relative-to-edition growth. */
export function growthChart(a: Analysis, W = 640, ui: Ui = "uk"): string {
  const tx = L[ui];
  const rows = a.series.filter((s) => s.metrics).sort((p, q) => q.metrics!.growth - p.metrics!.growth).slice(0, 14);
  const rowH = 30;
  const M = { l: 150, r: 136, t: 50, b: 26 };
  const H = M.t + M.b + Math.max(1, rows.length) * rowH;
  const pw = W - M.l - M.r;
  const vals = rows.flatMap((r) => [r.metrics!.growth, r.metrics!.growthRelative, ...r.metrics!.growthCI90]).filter(Number.isFinite).map((v) => Math.max(-1, Math.min(v, 3)));
  const lo = Math.min(0, ...vals), hi = Math.max(0.05, ...vals);
  const ticks = niceTicks(lo * 100, hi * 100, 5);
  const t0 = ticks[0] / 100, t1 = ticks[ticks.length - 1] / 100;
  const x = (v: number) => M.l + ((Math.max(t0, Math.min(v, t1)) - t0) / (t1 - t0 || 1)) * pw;
  const w = rows[0]?.metrics?.windowMonths ?? 12;
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  o.push(`<rect width="${W}" height="${H}" fill="${SURFACE}"/>`);
  o.push(`<text x="12" y="18" font-size="13" font-weight="bold" fill="${INK}">${esc(tx.change(w))}</text>`);
  o.push(`<rect x="12" y="28" width="12" height="8" rx="2" fill="${SERIES_COLORS[0]}"/><text x="28" y="36" font-size="9.5" fill="${INK2}">${esc(tx.raw)}</text>`);
  o.push(`<rect x="250" y="30" width="12" height="4" rx="1" fill="${SERIES_COLORS[1]}"/><text x="266" y="36" font-size="9.5" fill="${INK2}">${esc(tx.rel)}</text>`);
  for (const t of ticks) {
    o.push(`<line x1="${x(t / 100).toFixed(1)}" x2="${x(t / 100).toFixed(1)}" y1="${M.t - 4}" y2="${H - M.b}" stroke="${t === 0 ? MUTED : GRID}" stroke-width="1"/>`);
    o.push(`<text x="${x(t / 100).toFixed(1)}" y="${H - M.b + 14}" font-size="9.5" fill="${INK2}" text-anchor="middle">${t > 0 ? "+" : ""}${t}%</text>`);
  }
  rows.forEach((r, i) => {
    const m = r.metrics!;
    const cy = M.t + i * rowH + rowH / 2;
    const x0 = x(0);
    o.push(`<text x="${M.l - 8}" y="${cy + 3}" font-size="10" fill="${INK}" text-anchor="end">${esc(shortId(r, ui))}</text>`);
    if (Number.isFinite(m.growth)) {
      const xa = x(m.growth);
      o.push(`<rect x="${Math.min(x0, xa).toFixed(1)}" y="${cy - 9}" width="${Math.max(1, Math.abs(xa - x0)).toFixed(1)}" height="10" rx="2" fill="${SERIES_COLORS[0]}"/>`);
      const [c0, c1] = m.growthCI90;
      if (Number.isFinite(c0)) o.push(`<line x1="${x(c0).toFixed(1)}" x2="${x(c1).toFixed(1)}" y1="${cy - 4}" y2="${cy - 4}" stroke="${INK}" stroke-width="1.2"/><line x1="${x(c0).toFixed(1)}" x2="${x(c0).toFixed(1)}" y1="${cy - 7}" y2="${cy - 1}" stroke="${INK}"/><line x1="${x(c1).toFixed(1)}" x2="${x(c1).toFixed(1)}" y1="${cy - 7}" y2="${cy - 1}" stroke="${INK}"/>`);
    }
    if (Number.isFinite(m.growthRelative)) {
      const xb = x(m.growthRelative);
      o.push(`<rect x="${Math.min(x0, xb).toFixed(1)}" y="${cy + 3}" width="${Math.max(1, Math.abs(xb - x0)).toFixed(1)}" height="5" rx="1.5" fill="${SERIES_COLORS[1]}"/>`);
    }
    const g = Number.isFinite(m.growth) ? `${m.growth >= 0 ? "+" : ""}${(m.growth * 100).toFixed(0)}%` : "n/a";
    o.push(`<text x="${W - M.r + 8}" y="${cy + 3}" font-size="10" fill="${INK}">${g}  <tspan fill="${INK2}">${ui === "uk" ? ({ high: "висока", medium: "середня", low: "низька" } as Record<string, string>)[r.confidence] : r.confidence} ${tx.conf}</tspan></text>`);
  });
  o.push(`</svg>`);
  return o.join("\n");
}

const require = createRequire(import.meta.url);
export function fontPath(bold = false): string {
  return require.resolve(`dejavu-fonts-ttf/ttf/DejaVuSans${bold ? "-Bold" : ""}.ttf`);
}

export async function svgToPng(svg: string, scale = 2): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  const r = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: { loadSystemFonts: false, fontFiles: [fontPath(false), fontPath(true)], defaultFontFamily: FONT },
  });
  return Buffer.from(r.render().asPng());
}

export function readFontBuffer(bold = false): Buffer {
  return readFileSync(fontPath(bold));
}
