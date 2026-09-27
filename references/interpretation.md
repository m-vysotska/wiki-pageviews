# Interpreting `wv analyze` output

## Columns

| Column | Meaning | Use it for |
|---|---|---|
| `avg/mo(last12)` | Mean monthly views (article + redirects), last 12 full months | Audience size in that edition |
| `per1M` | Views per 1 million pageviews of the whole language edition | Comparing *intensity* of interest across languages of different size |
| `growth` | Last 12 months vs same 12 months a year earlier, raw views | Is the audience getting bigger? |
| `90%CI` | Paired bootstrap interval for `growth` | Is the change distinguishable from noise? |
| `rel.growth` | Same as growth, but for the share of edition traffic | Is interest shifting *toward* the topic, net of Wikipedia-wide trends? |
| `months↑` | Months (out of 12) higher than the same month a year before | Consistency; 10+/12 or ≤2/12 = very consistent |
| `trend` | Direction label: growing / declining / flat / unclear | Headline |
| `confidence` | high / medium / low, reasons listed below the table | How strongly to phrase conclusions |

`analysis.json` additionally has: `trendAnnualPct` (Sen's slope over the whole period),
`prevGrowth` (same metric one year earlier → acceleration/deceleration), `growthMedianBased`,
`growthDespiked`, `seasonalPeaks`, full monthly series.

## Wording by confidence

| Confidence | Wording |
|---|---|
| high | "Interest is growing/declining" |
| medium | "Data suggest interest is growing…, but …" (+ the main reason) |
| low | "No reliable signal"/"Weak signal; treat as a hypothesis to test" |

## Common situations

- **Raw down, relative flat/up**: the edition as a whole is losing traffic (AI answers, search
  snippets, shifting to other languages). The topic holds its share → interest is stable in
  relative terms. For market sizing use raw; for "is the topic gaining mindshare" use relative.
- **Both down strongly, 10+/12 months down**: genuine decline in attention on Wikipedia.
- **Growth driven by one month**: see "one-off spike" flag and "without spikes" figure. Report the
  latter as the underlying trend. Suggest the user check what happened that month (news, a film,
  a viral post) — the skill does not know causes; don't invent them.
- **Recurring peak (e.g. September)**: school-year seasonality; a signal that the audience is
  students. Useful for product timing (launch before the peak).
- **Very different levels across languages**: compare `per1M`; a small edition with high
  per1M = an engaged niche. Absolute audience = `avg/mo`.
- **English Wikipedia**: many non-native speakers read `en`. Low interest in a local edition
  can mean the audience reads English — relevant for localisation decisions.
- **Language ≠ country**: `es`, `pt`, `ar`, `en`, `fr` span many countries; `uk`, `pl`, `cs`,
  `ja` are close to single markets.

## Recommending where to go next (products/markets)

Build a small table from the output and rank on explicit criteria, e.g.:
1. relative growth (momentum), 2. per1M (intensity), 3. avg/mo (reach), 4. confidence.
State the criteria and weights you used; if the user gave their own criteria, use those.
Recommend *further research* (survey, landing-page test, keyword research), not final decisions.

## Statistical notes

- Growth CI: 4000 paired bootstrap resamples of month pairs (same calendar month), seed fixed → reproducible.
- Pairwise "distinguishable" = 90% intervals do not overlap (conservative).
- Spike: month > 2.5× median of the surrounding ±3 months and ≥ 300 views above it.
  Spikes in the same calendar month in ≥ 2 years are treated as seasonality.
- Confidence score: volume (+1 ≥ 3000/mo, −1 < 1000, −2 < 300, forced low < 100),
  CI excludes 0 (+1/−1), consistency ≥ 80% (+1) or < 65% (−1), spikes flip sign (−2) or
  distort size (−1), raw vs relative disagree (−1), windows < 12 months (−1).
  high ≥ 3, low ≤ −1; insufficient history → low.
