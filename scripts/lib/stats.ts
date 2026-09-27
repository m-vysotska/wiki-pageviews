// Small, dependency-free statistics used by the analysis. All pure functions.

export const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
export const mean = (a: number[]) => (a.length ? sum(a) / a.length : NaN);

export function median(a: number[]): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

export function quantile(a: number[], q: number): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Deterministic PRNG so bootstrap results are reproducible between runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Relative change of totals: sum(cur)/sum(prev) - 1. */
export function growth(cur: number[], prev: number[]): number {
  const p = sum(prev);
  return p > 0 ? sum(cur) / p - 1 : NaN;
}

/**
 * Paired bootstrap CI for year-over-year growth. Month i of the current window is
 * paired with the same calendar month a year earlier, so seasonality cancels.
 */
export function growthCI(cur: number[], prev: number[], level = 0.9, iters = 4000, seed = 42): [number, number] {
  const n = Math.min(cur.length, prev.length);
  if (n < 3 || sum(prev) <= 0) return [NaN, NaN];
  const rnd = mulberry32(seed);
  const res: number[] = [];
  for (let b = 0; b < iters; b++) {
    let sc = 0;
    let sp = 0;
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rnd() * n);
      sc += cur[j];
      sp += prev[j];
    }
    if (sp > 0) res.push(sc / sp - 1);
  }
  const a = (1 - level) / 2;
  return [quantile(res, a), quantile(res, 1 - a)];
}

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}
/** Two-sided exact binomial (sign) test p-value for k successes out of n at p=0.5. */
export function signTestP(k: number, n: number): number {
  if (n === 0) return 1;
  const pmf = (i: number) => Math.exp(logFactorial(n) - logFactorial(i) - logFactorial(n - i) - n * Math.LN2);
  const extreme = Math.min(k, n - k);
  let p = 0;
  for (let i = 0; i <= extreme; i++) p += pmf(i);
  return Math.min(1, 2 * p);
}

/** Month pairs (same calendar month, one year apart) where the newer value is higher. */
export function pairedUps(cur: number[], prev: number[]): { up: number; down: number; n: number } {
  let up = 0;
  let down = 0;
  const n = Math.min(cur.length, prev.length);
  for (let i = 0; i < n; i++) {
    if (cur[i] > prev[i]) up++;
    else if (cur[i] < prev[i]) down++;
  }
  return { up, down, n };
}

function normCdf(z: number): number {
  // Abramowitz–Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * Mann–Kendall trend test with Sen's slope, on log(1+views).
 * Returns the annualised % change implied by the median slope and a two-sided p-value.
 * Note: ignores autocorrelation/seasonality, so the p-value is optimistic; used as a secondary signal.
 */
export function senTrend(values: number[]): { annualPct: number; p: number } {
  const y = values.map((v) => Math.log1p(v));
  const n = y.length;
  if (n < 6) return { annualPct: NaN, p: NaN };
  const slopes: number[] = [];
  let s = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      slopes.push((y[j] - y[i]) / (j - i));
      s += Math.sign(y[j] - y[i]);
    }
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return { annualPct: Math.expm1(median(slopes) * 12), p };
}

/**
 * Spike detection: a month is a spike when it is > `ratio` × the centred rolling
 * median (window 7) and exceeds it by at least `minAbs` views.
 */
export function detectSpikes(values: number[], ratio = 2.5, minAbs = 300): Array<{ index: number; ratio: number }> {
  const out: Array<{ index: number; ratio: number }> = [];
  for (let i = 0; i < values.length; i++) {
    const w: number[] = [];
    for (let k = Math.max(0, i - 3); k < Math.min(values.length, i + 4); k++) if (k !== i) w.push(values[k]);
    const base = median(w);
    if (w.length && values[i] > ratio * Math.max(base, 1) && values[i] - base >= minAbs) out.push({ index: i, ratio: values[i] / Math.max(base, 1) });
  }
  return out;
}

/** Replace spike months by the rolling median, for a "without spikes" robustness check. */
export function despike(values: number[], spikes: Array<{ index: number }>): number[] {
  const v = [...values];
  for (const s of spikes) {
    const w = values.slice(Math.max(0, s.index - 3), Math.min(values.length, s.index + 4));
    v[s.index] = median(w);
  }
  return v;
}
