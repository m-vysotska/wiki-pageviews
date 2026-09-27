// Import API responses fetched outside this machine (e.g. from a browser) into the cache.
// Input JSON: { "<url>": { "status": 200, "body": {...} }, ... }
// Useful when the machine running the skill cannot reach wikimedia.org directly:
//   1) WV_OFFLINE=1 WV_RECORD_MISSES=urls.txt node scripts/wv.ts analyze ...   (collect missing URLs; repeat until none)
//   2) fetch those URLs anywhere and save as responses.json
//   3) node scripts/tools/import-responses.ts responses.json
import { readFileSync } from "node:fs";
import { writeCache, CACHE_DIR } from "../lib/http.ts";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/tools/import-responses.ts responses.json"); process.exit(1); }
const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, { status: number; body: unknown }>;
let n = 0;
for (const [url, r] of Object.entries(data)) {
  if (r.status !== 200 && r.status !== 404) { console.error(`skip ${r.status} ${url}`); continue; }
  writeCache({ url, status: r.status, fetchedAt: new Date().toISOString(), body: r.body, source: `import:${file}` });
  n++;
}
console.log(`imported ${n} responses into ${CACHE_DIR}`);
