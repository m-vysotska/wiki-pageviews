# Choosing articles and languages

## Topic → article

A Wikipedia article is a proxy for a topic. Pick the article a curious person would land on.

| User says | Good `--topic` | Notes |
|---|---|---|
| astronomy course | `Astronomy` | Optionally also `Solar System`, `Telescope` as separate topics or `--combine` |
| intermittent fasting | `Intermittent fasting` | Diet topics are spiky (New Year) — check flags |
| learning English | `English language` | Also consider `English as a second or foreign language` |
| personal finance app | `Personal finance`, `Budget` | Several proxies → use `--combine "Personal finance"` or compare |
| a named product/brand | exact item, e.g. `Duolingo` | Check `resolve` picks the company, not a namesake |

Rules:
- Search terms go to Wikidata in English by default (`--search-lang en`). If the user gives a
  local term, translate it, or use `--search-lang uk` / an exact `uk:Title`.
- Always run `resolve` first for a new topic and read the "alt:" lines. Items described as
  journal, song, film, album, disambiguation are wrong picks.
- If a language has no article, the output says so. You may add a related local article
  explicitly: `--topic "pl:Post przerywany"` (check it exists with `resolve`).
- Broad concepts (e.g. "Health") are noisy proxies; prefer 2–4 concrete articles.
- Max ~6 topics × ~10 languages per run keeps output readable; for 20–40 languages use one topic
  and a preset (`--langs top40`), redirects are auto-capped for large runs.

## Language presets

`top10 top20 top40 eu cee nordics slavic asia mena latam` — see `assets/lang-presets.json`.
Codes are Wikipedia codes: `uk` Ukrainian, `cs` Czech, `pl` Polish, `sv` Swedish, `no`
Norwegian (Bokmål), `zh` Chinese, `he` Hebrew, `simple` Simple English, `be-tarask` Belarusian (Taraškievica).

## Period

- Default 36 months (3 years): last 12 vs previous 12 plus context and `prevGrowth`.
- ≥ 24 months is required for a seasonally matched comparison; shorter periods are flagged.
- Data exist from 2015-07. The current (incomplete) month is always excluded.
