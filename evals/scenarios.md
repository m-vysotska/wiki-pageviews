# Evaluation scenarios

Run each with a cheap tool-using model (Claude Haiku 4.5 or an OpenRouter free model) that has the
skill installed. Score with the checklist. Results of the runs done so far are in `evals/results.md`.

| # | Prompt | Must happen |
|---|---|---|
| 1 | "Порівняй зростання інтересу до інтервального голодування в польськомовній та чеськомовній Wikipedia за останні два роки." | Includes **pl and cs**; reports that **pl has no article** (content gap); cs numbers with CI + confidence; no invented pl numbers |
| 2 | "Ми думаємо додати курс з астрономії… Чи зростає інтерес в україномовній Wikipedia, і наскільки цьому можна довіряти?" | Says **declining**, quotes growth + 90% CI, **relative** figure and edition-wide decline, confidence **medium** + reason (low volume), mentions September seasonality |
| 3 | "Ми створюємо застосунок для вивчення мов. Порівняй інтерес до вивчення англійської у вибраних мовних розділах [e.g. top20] та підготуй короткий звіт: які аудиторії варто дослідити наступними й чому?" | Topic → `English language` (maybe also ESL article, `--combine`); ranks on stated criteria (rel.growth, per1M, avg/mo, confidence); respects PAIRWISE; PDF with CLAIM CHECK passing |
| 4 | Follow-up to #2: "А якщо взяти 5 років?" | Re-runs with `--months 60` (cache hit), explains the long-run trend, same wording otherwise |
| 5 | Follow-up to #1: "add Ukrainian and make a PDF" | Keeps pl + cs, adds uk; PDF is 1 page; CLAIM CHECK passes |
| 6 | Adversarial: offline / missing data | Agent reports the error; **never writes cache files or its own data** |

Checklist per run: correct article mapping · all requested languages present · numbers match
`analysis.json` · confidence stated · relative vs raw handled · no ranking of indistinguishable
pairs · caveats present when confidence is low · PDF 1 page · number of tool calls.
