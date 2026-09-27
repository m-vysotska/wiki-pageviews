import { test } from "node:test";
import assert from "node:assert/strict";
import { growth, growthCI, signTestP, senTrend, detectSpikes, median, pairedUps } from "../scripts/lib/stats.ts";
import { addMonths, monthRange, monthEnd, parseMonth, lastCompleteMonth } from "../scripts/lib/months.ts";
import { computeMetrics, judge } from "../scripts/lib/analyze.ts";
import { parseNotes } from "../scripts/lib/report.ts";
import { langFromSiteKey, siteKey } from "../scripts/lib/wiki.ts";
import type { Month } from "../scripts/lib/months.ts";

test("months", () => {
  assert.equal(addMonths("2024-11", 3), "2025-02");
  assert.equal(addMonths("2024-01", -1), "2023-12");
  assert.equal(monthRange("2024-11", "2025-02").length, 4);
  assert.equal(monthEnd("2024-02"), "2024-02-29");
  assert.equal(parseMonth("202403"), "2024-03");
  assert.equal(lastCompleteMonth(new Date("2026-09-27T00:00:00Z")), "2026-08");
  assert.equal(lastCompleteMonth(new Date("2026-09-01T00:00:00Z")), "2026-07");
});

test("site keys", () => {
  assert.equal(siteKey("be-tarask"), "be_x_oldwiki");
  assert.equal(langFromSiteKey("zh_yuewiki"), "zh-yue");
  assert.equal(langFromSiteKey("enwikiquote"), null);
  assert.equal(langFromSiteKey("commonswiki"), null);
  assert.equal(langFromSiteKey("ukwiki"), "uk");
});

test("growth and CI", () => {
  const prev = Array(12).fill(100);
  const cur = Array(12).fill(120);
  assert.ok(Math.abs(growth(cur, prev) - 0.2) < 1e-9);
  const [lo, hi] = growthCI(cur, prev);
  assert.ok(lo <= 0.2 + 1e-9 && hi >= 0.2 - 1e-9);
  assert.deepEqual(growthCI(cur, prev), growthCI(cur, prev)); // deterministic
});

test("sign test", () => {
  assert.ok(signTestP(12, 12) < 0.001);
  assert.equal(signTestP(6, 12), 1);
  assert.deepEqual(pairedUps([2, 1, 3], [1, 1, 1]), { up: 2, down: 0, n: 3 });
});

test("sen trend detects exponential growth", () => {
  const v = Array.from({ length: 36 }, (_, i) => 1000 * Math.exp(0.02 * i));
  const t = senTrend(v);
  assert.ok(Math.abs(t.annualPct - (Math.exp(0.24) - 1)) < 0.02, String(t.annualPct));
  assert.ok(t.p < 0.001);
});

test("spike detection", () => {
  const v = Array(24).fill(1000);
  v[10] = 6000;
  const s = detectSpikes(v);
  assert.equal(s.length, 1);
  assert.equal(s[0].index, 10);
  assert.equal(median([1, 3, 2]), 2);
});

const M = monthRange("2023-09", "2026-08") as Month[];

test("metrics: steady growth is high confidence", () => {
  const views = M.map((_, i) => 5000 * Math.exp(0.015 * i) * (1 + 0.1 * Math.sin(i)));
  const ed = M.map(() => 1e8);
  const { metrics, status } = computeMetrics(M, views, ed);
  const j = judge(metrics, status);
  assert.equal(j.direction, "growing");
  assert.equal(j.confidence, "high");
});

test("metrics: spike-driven growth is downgraded", () => {
  const views = M.map(() => 2000 + 0);
  views[30] = 40000;
  const { metrics, status } = computeMetrics(M, views, M.map(() => 1e8));
  const j = judge(metrics, status);
  assert.ok(metrics!.growth > 0.5);
  assert.ok(Math.abs(metrics!.growthDespiked) < 0.05);
  assert.notEqual(j.confidence, "high");
  assert.ok(j.reasons.some((r) => r.includes("spikes")));
});

test("metrics: tiny volume is low confidence", () => {
  const views = M.map((_, i) => 20 + i);
  const j = judge(...(Object.values(computeMetrics(M, views, M.map(() => 1e7))).slice(0, 2) as [never, never]));
  assert.equal(j.confidence, "low");
});

test("metrics: new article flagged", () => {
  const views = M.map((_, i) => (i < 20 ? 0 : 3000));
  const r = computeMetrics(M, views, M.map(() => 1e8));
  assert.equal(r.status, "insufficient_history");
});

test("notes parser", () => {
  const n = parseNotes("# T\n\n## Answer\nLine one\ncontinued.\n\n## Recs\n- a\n- b\n");
  assert.equal(n.title, "T");
  assert.equal(n.sections[0].body[0], "Line one continued.");
  assert.deepEqual(n.sections[1].body, ["• a", "• b"]);
});
