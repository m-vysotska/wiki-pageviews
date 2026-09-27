// Ukrainian wording for report-facing text (reports default to Ukrainian).
// Analysis internals keep English strings; these helpers translate them for reports.

export type Ui = "en" | "uk";

export const DIRECTION_UK: Record<string, string> = {
  growing: "зростає", declining: "спадає", flat: "майже без змін", unclear: "немає чіткої зміни",
};
export const CONFIDENCE_UK: Record<string, string> = { high: "висока", medium: "середня", low: "низька" };

const RULES: Array<[RegExp, string]> = [
  [/very low volume \((\d+) views\/month\): too few readers to generalise/, "дуже малий обсяг ($1 переглядів/міс): замало читачів для висновків"],
  [/very low volume \((\d+) views\/month\): small absolute changes look like big %/, "дуже малий обсяг ($1 переглядів/міс): невеликі абсолютні зміни дають великі відсотки"],
  [/low volume \((\d+) views\/month\)/, "малий обсяг ($1 переглядів/міс)"],
  [/^solid volume$/, "достатній обсяг"],
  [/90% interval excludes zero/, "90% інтервал не містить нуля"],
  [/90% interval includes zero/, "90% інтервал містить нуль"],
  [/consistent: (\d+)\/(\d+) months moved the same way/, "стабільно: $1 з $2 місяців змінилися в один бік"],
  [/inconsistent month-by-month \((\d+) up \/ (\d+) down\)/, "непослідовно по місяцях ($1 вгору / $2 вниз)"],
  [/one-off spikes flip the sign of the change \(without spikes: ([^)]+)\); direction judged without spikes/, "разові сплески змінюють знак зміни (без сплесків: $1); напрям оцінено без сплесків"],
  [/one-off spikes distort the size of the change \(without spikes: ([^)]+)\)/, "разові сплески спотворюють розмір зміни (без сплесків: $1)"],
  [/; direction judged without spikes/, "; напрям оцінено без сплесків"],
  [/raw and relative-to-edition trends disagree \(edition traffic ([^)]+)\)/, "сира й відносна динаміка розходяться (трафік розділу $1)"],
  [/windows not seasonally matched/, "періоди не вирівняні за сезоном"],
  [/not enough history before the recent window/, "замало історії до останнього періоду"],
  [/^no usable data$/, "немає придатних даних"],
  [/^no article in this language edition$/, "статті в цьому мовному розділі немає"],
  [/^no ([a-z-]+) Wikipedia article for this topic.*$/, "у $1 Вікіпедії немає статті на цю тему — це прогалина в контенті, а не нульовий інтерес"],
  [/one-off spike (\d{4}-\d{2}): ([\d.]+)x the surrounding median.*$/, "разовий сплеск $1: у $2 раза вище медіани сусідніх місяців — перевірте новини, події або бот-трафік"],
  [/recurring yearly peak in month\(s\) ([\d, ]+) .*$/, "щорічний пік у місяці(ях) $1 — сезонність (напр., навчальний рік); у порівнянні рік до року компенсується"],
  [/article has data only from (\d{4}-\d{2}).*$/, "дані статті є лише з $1 — порівняння з попереднім періодом ненадійне (ймовірно, нова або перейменована стаття)"],
  [/period < 24 months: comparing last (\d+) vs previous (\d+) months.*$/, "період коротший за 24 міс.: порівнюються останні $1 і попередні $2 місяців без сезонного вирівнювання"],
  [/edition totals missing.*$/, "немає загальних даних розділу за деякі місяці; відносну зміну не пораховано"],
  [/only (\d+) of (\d+) redirects included.*$/, "враховано лише $1 з $2 перенаправлень"],
  [/combined series lacks articles for: (.*)$/, "в об'єднаному ряді немає статей для: $1"],
  [/^([a-z-]+)\.wikipedia total traffic changed ([^ ]+) year-over-year.*$/, "Загальний трафік $1.wikipedia за рік змінився на $2; порівнюйте сиру зміну з відносною."],
  [/^DATA INTEGRITY WARNING: (\d+) cached responses.*$/, "ПОПЕРЕДЖЕННЯ ПРО ЦІЛІСНІСТЬ ДАНИХ: $1 записів кешу невідомого походження — результати можуть бути сфабриковані."],
  [/^No Wikidata item for ([a-z-]+):(.*); only .* is analysed\.$/, "Для $1:$2 немає елемента Wikidata; аналізується лише $1."],
];

/** Translate an analysis reason/flag/note into Ukrainian (falls back to the original text). */
export function trUk(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}

export const tr = (text: string, ui: Ui) => (ui === "uk" ? trUk(text) : text);
