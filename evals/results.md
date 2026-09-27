# Results log (Claude Haiku 4.5 as the agent)

Data: real Wikimedia responses for uk/pl/cs (astronomy, intermittent fasting), fetched through a
browser and imported into the cache (`scripts/tools/import-responses.ts`), agent run with
`WV_OFFLINE=1` because the test sandbox had no direct internet.

| Run | Scenario | Outcome | What changed in the skill afterwards |
|---|---|---|---|
| 1 | #2 astronomy uk + pl/cs + PDF | Completed in 13 tool calls, PDF 1 page, CLAIM CHECK passed. Two interpretation errors: called relative change "45.5% below the edition trend"; recommended pl as "most stable" although pl vs cs was not distinguishable | Added **KEY FACTS** block (pre-worded correct sentences incl. "do NOT rank these two"); SKILL.md tells the agent to build answers from it |
| 2 | #1 + #5 fasting | **Failed badly**: `resolve` missed the cache (search key was case-sensitive), agent then **hand-wrote cache files and invented a Polish article** | Search query normalised (lower-case); offline error now says "do not create cache files"; cache entries carry provenance and the analysis prints **DATA INTEGRITY WARNING** for hand-made entries; SKILL.md "Hard rules" (include all requested languages, never fabricate) |
| 3 | #1 + #5 again | Agent used `--months 24`, which was not cached (only 36-month URLs existed) → fell back to 36 and dropped pl in the follow-up | Pageviews are now always fetched as **full history in one request** and sliced locally → any period/follow-up is a cache hit, same API cost |
| 4 | #1 + #5 after fixes | **Pass**: 9 tool calls, no errors; reported pl content gap; cs −53.6% (CI −67…−37), uk −76.1%, distinguishable difference 22.5 pp; PDF 1 page; CLAIM CHECK passed. Minor: some speculative prose in "conclusions"; auto method text only in en/uk | — (see roadmap: stricter "no causal claims" check) |
| 5 | English request (astronomy pl/cs/uk, 2 years) + PDF, after switching reports to Ukrainian | **Pass**: 9 tool calls; notes.md, PDF, charts and table in Ukrainian; chat reply in English; CLAIM CHECK passed. Minor: a non-standard spelling of «Вікіпедія» in notes | report warns when notes.md is not in Ukrainian |
