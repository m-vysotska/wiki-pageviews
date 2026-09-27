// HTTP layer: polite fetching from Wikimedia APIs with a disk cache,
// retries, a concurrency limit and an offline mode for reproducible re-runs.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CACHE_DIR = process.env.WV_CACHE_DIR || join(homedir(), ".cache", "wiki-pageviews");
const OFFLINE = process.env.WV_OFFLINE === "1";
const CONTACT = process.env.WV_CONTACT || "set WV_CONTACT env var to your email or URL";
// Wikimedia's User-Agent policy requires a descriptive UA with contact info.
const USER_AGENT = `wiki-pageviews-agent-skill/0.1 (${CONTACT})`;
const MAX_CONCURRENCY = Number(process.env.WV_CONCURRENCY || 6);

export interface CachedResponse {
  url: string;
  status: number;
  fetchedAt: string;
  body: unknown;
  /** "network" or "import:<file>"; anything else = unknown provenance (hand-made) */
  source?: string;
}

export const stats = { network: 0, cacheHits: 0, notFound: 0, unknownProvenance: [] as string[] };

let active = 0;
const queue: Array<() => void> = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENCY) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

function cachePath(url: string): string {
  const h = createHash("sha1").update(url).digest("hex");
  return join(CACHE_DIR, h.slice(0, 2), `${h}.json`);
}

function readCache(url: string, ttlMs: number): CachedResponse | null {
  const p = cachePath(url);
  if (!existsSync(p)) return null;
  try {
    const c = JSON.parse(readFileSync(p, "utf8")) as CachedResponse;
    const age = Date.now() - Date.parse(c.fetchedAt);
    if (OFFLINE || ttlMs === Infinity || age < ttlMs) return c;
  } catch {
    /* corrupted cache entry: refetch */
  }
  return null;
}

export function writeCache(c: CachedResponse): void {
  const p = cachePath(c.url);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(c));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET JSON. Returns {status, body}. 404 is a valid, cacheable answer
 * (the pageviews API returns 404 when an article has no data in the range).
 */
export async function getJson(url: string, ttlMs: number): Promise<CachedResponse> {
  const cached = readCache(url, ttlMs);
  if (cached) {
    stats.cacheHits++;
    if (!cached.source || !(cached.source === "network" || cached.source.startsWith("import:"))) stats.unknownProvenance.push(url);
    return cached;
  }
  if (OFFLINE && process.env.WV_RECORD_MISSES) {
    // Collect URLs to fetch elsewhere (see scripts/tools/import-responses.ts); return an empty answer.
    appendFileSync(process.env.WV_RECORD_MISSES, url + "\n");
    return { url, status: 404, fetchedAt: new Date().toISOString(), body: {} };
  }
  if (OFFLINE) throw new Error(`Offline mode (WV_OFFLINE=1): this data was never downloaded (${url}). Do NOT create or edit cache files — report to the user that the data is unavailable offline, or run without WV_OFFLINE on a machine with internet access.`);
  return withSlot(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        stats.network++;
        const res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status} for ${url}`);
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        const text = await res.text();
        let body: unknown = null;
        try {
          body = JSON.parse(text);
        } catch {
          body = { raw: text.slice(0, 500) };
        }
        if (res.status !== 200 && res.status !== 404) {
          throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 300)}`);
        }
        if (res.status === 404) stats.notFound++;
        const c: CachedResponse = { url, status: res.status, fetchedAt: new Date().toISOString(), body, source: "network" };
        writeCache(c);
        return c;
      } catch (e) {
        lastErr = e;
        if (e instanceof Error && e.message.startsWith("HTTP 4")) throw e;
        await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error(
      `Network error after retries: ${String(lastErr)}. ` +
        `If this machine has no access to wikimedia.org, run where it does, or re-run with WV_OFFLINE=1 to use cached data only.`,
    );
  });
}

export const DAY = 24 * 3600 * 1000;
