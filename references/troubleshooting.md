# Troubleshooting

| Symptom | Fix |
|---|---|
| `ERROR: Missing --topic` / `Unknown language code` | Check flags; quote values with spaces: `--topic "English language"` |
| `No Wikidata item found` | Use an English term, a QID (`--topic Q333`) or `lang:Title` |
| Wrong item picked | Re-run with a QID from the `other matches` line |
| `Cannot find module 'pdfkit'` etc. | `cd SKILL_DIR && npm ci` (analysis works without it; PNG/PDF need it) |
| Node errors about `.ts` / type stripping | Need Node ≥ 22.18 (`node -v`) |
| `Network error after retries` / `HTTP 403` from a proxy | The machine can't reach wikimedia.org. Tell the user. Cached data still works with `WV_OFFLINE=1`. |
| Rate limiting (HTTP 429) | Handled with backoff; lower `WV_CONCURRENCY` (default 6) |
| PDF > 1 page warning | Shorten notes.md |

## Working behind a restrictive network

If the machine running the agent cannot reach Wikimedia but a browser or another machine can:

```bash
# 1. Record the URLs the analysis needs (repeat until the file stays empty: each round
#    unlocks the next set: search → entities → redirects → pageviews)
WV_OFFLINE=1 WV_RECORD_MISSES=urls.txt node SKILL_DIR/scripts/wv.ts analyze --topic ... --langs ...
# 2. Fetch the listed URLs elsewhere; save {"<url>": {"status": 200, "body": <json>}, ...}
# 3. Import into the cache and re-run normally with WV_OFFLINE=1
node SKILL_DIR/scripts/tools/import-responses.ts responses.json
```
