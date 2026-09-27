---
name: wiki-pageviews
description: Measure and compare public interest in topics across Wikipedia language editions using Wikimedia pageview data, with charts, trust ratings and one-page PDF reports. Use when a founder or product team asks whether interest in a topic is growing, which topics to build next (courses, features, content), or which languages/markets to launch or localize into — e.g. "is interest in astronomy growing in Ukrainian Wikipedia?", "compare intermittent fasting in Polish vs Czech", "which language audiences should our English-learning app research next?".
license: MIT
compatibility: Node.js >= 22.18 (runs TypeScript natively, no build step). Needs HTTPS access to wikimedia.org, www.wikidata.org and *.wikipedia.org. Run `npm ci` once in the skill directory.
metadata:
  version: "0.1.0"
  data-source: "Wikimedia Analytics API (pageviews), Wikidata"
---

# Wikipedia interest analysis

The CLI `scripts/wv.ts` does all data work: finds the right article in every language
(via Wikidata), downloads monthly pageviews (+ redirects), normalises by the size of each
language edition, computes growth with 90% intervals, rates confidence, draws charts and
builds a one-page PDF. **Do not write your own fetching or statistics code; use the CLI and
read its output.**

`SKILL_DIR` below = the directory containing this file. Run commands from the user's
working directory so outputs land there (`./wv-output/...`).

## Setup (once)

```bash
cd SKILL_DIR && npm ci && cd -
node SKILL_DIR/scripts/wv.ts doctor        # checks node, deps, API access
```
If `doctor` says the API is not reachable, tell the user; see `references/troubleshooting.md`.

## Workflow

1. **Translate the question into parameters.**
   - Topic(s) → one encyclopedic concept each, in English ("Astronomy", "Intermittent fasting",
     "English language"). See `references/topics-and-languages.md` for picking articles.
   - Languages → Wikipedia codes (`uk`, `pl`, `cs`) or presets (`top20`, `eu`, `cee`, `slavic`…).
   - Period → default `--months 36` (needs ≥ 24 for a seasonally fair comparison).
     "Last two years" → `--months 24`.
2. **Check the mapping** (fast, cheap):
   ```bash
   node SKILL_DIR/scripts/wv.ts resolve --topic "Astronomy" --langs uk,pl,cs
   ```
   Confirm the Wikidata item is the concept the user means (not a journal, film, band).
   If wrong, re-run with a QID from the alternatives (`--topic Q333`) or an exact title
   (`--topic "en:Astronomy"`).
3. **Analyse:**
   ```bash
   node SKILL_DIR/scripts/wv.ts analyze --topic "Astronomy" --langs uk,pl,cs --months 36
   ```
   Several topics: repeat `--topic`. Sum related articles into one topic: add `--combine "Label"`.
   Charts and `summary.md` are in Ukrainian (default `--ui uk`). It prints a table, pairwise comparisons,
   confidence reasons, flags, ranks and file paths (charts PNG/SVG, `analysis.json`,
   `data.csv`, `summary.md`).
4. **Interpret**: build your answer from the **KEY FACTS** block — its sentences are
   pre-checked and safe to quote/translate. Add nothing that contradicts it. Rules below;
   details in `references/interpretation.md`.
5. **Answer in chat** first: 3–6 sentences + key numbers + confidence + main caveat.
   Show `trend.png` / `growth.png` if the interface can display images.
6. **PDF on request** (or when the user wants something shareable): write `notes.md`
   **in Ukrainian** (template in `references/report-notes.md`), then
   ```bash
   node SKILL_DIR/scripts/wv.ts report --analysis <dir printed by analyze> --notes notes.md
   ```
   Fix every `CLAIM CHECK` line (a % in your notes that matches no computed figure) and every
   `WARNING`, then re-run. Deliver the PDF path.

Follow-ups ("what about German?", "use 5 years", "add physics") → just re-run `analyze` with
changed flags; everything already downloaded is cached, so it is fast. Reuse the same
wording/assumptions unless the user changed them, and say what changed.

## Hard rules

- **Never use Russian Wikipedia (`ru`)** — it is excluded from this skill (the tool skips it). Do not
  suggest it as an audience or add it to comparisons.
- **All reports are in Ukrainian**: `notes.md`, the PDF, charts and `summary.md` — whatever language
  the user writes in (the tool defaults to Ukrainian). Use `--ui en` only if the user explicitly asks
  for an English report. Chat replies stay in the user's language.
- Include **every language the user asked about** in `--langs`, even if you expect no article:
  the tool reports gaps ("no article") and that is itself a finding.
- If a command fails, show the user the error and what it means. **Never create, edit or
  "pre-populate" cache/data files, and never write your own scripts to produce numbers.**
  Results built on data the tool did not download are fabricated (the tool flags them with
  `DATA INTEGRITY WARNING`).
- Use a translated English term for `--topic`, even when the user writes in another language.

## Reading the numbers (must-follow rules)

- **growth** = last 12 full months vs the same 12 months a year earlier (raw views).
  **rel.growth** = the same for the article's share of all views of that language edition.
  Wikipedia traffic as a whole is falling in many languages (the FLAGS say by how much),
  so **rel.growth is the fairer measure of interest shifting toward the topic**; raw growth
  is what an audience-size estimate needs. Report both when they differ in sign or by > 10 pp.
- **Confidence** (`high`/`medium`/`low`) is computed from volume, interval, month-by-month
  consistency, spike sensitivity and raw-vs-relative agreement. Always state it and the
  main reason. Never upgrade it in prose. `low` → phrase conclusions as hypotheses.
- **90% CI includes 0** → say "no clear change", not growth/decline.
- **Comparing languages**: only call one "faster growing" if PAIRWISE says `distinguishable: yes`.
  Compare levels with **per1M** (views per 1M edition views), not raw views — editions differ
  enormously in size.
- **Spikes**: one-off spikes (news, viral posts, bots) are flagged; mention them and use the
  "without spikes" figure from CONFIDENCE REASONS. Recurring yearly peaks are seasonality
  (school year) and already cancel out in year-over-year growth.
- **No article** in a language = content gap, not zero interest. Say so; optionally measure a
  related local article with `--topic "pl:<Title>"`.
- Never invent numbers. Every figure you write must come from the CLI output or
  `analysis.json`. Pageviews show attention, not willingness to pay — say that once when
  making product recommendations.

## Answer shape (chat)

> **Short answer:** Interest in astronomy in Ukrainian Wikipedia is **falling**: −59.6% in the
> last 12 months vs the year before (90% CI −64…−52%); even relative to the whole Ukrainian
> edition, which itself fell 24.6%, it is −45.5%. Confidence: medium (low volume, ~560 views/month).
> **What it means:** … **Caveats:** … **Next step:** …

## Other commands

- `top --lang uk [--month 2026-08] [--grep "regex"]` — most-read articles in a month; use to
  discover topics people already read about.
- `check --analysis DIR --notes notes.md` — claim check only.
- `cache [--clear]` — cache location (`~/.cache/wiki-pageviews`, override `WV_CACHE_DIR`).
- Set `WV_CONTACT=<email or URL>` so requests carry a contact in the User-Agent (Wikimedia policy).

Full option list: `node SKILL_DIR/scripts/wv.ts help`.
