# Writing `notes.md` for the PDF report

The PDF = your notes + auto charts + metrics table + method + limitations, on ONE A4 page.
Write notes **in Ukrainian** (all reports are Ukrainian, even if the user writes in another language). Keep them ~150–220 words. Use only figures from the output.

Structure (headings are free text; the FIRST section is shown in a highlighted box):

```markdown
# <Питання як заголовок, напр. «Чи зростає інтерес до астрономії в україномовній Вікіпедії?»>

## Коротка відповідь
<2–3 речення: напрям, ключовий % з 90% ДІ, відносна зміна, рівень довіри + головна причина.>

## Що це означає для продукту
- <висновок 1, прив'язаний до числа>
- <висновок 2>

## Рекомендації
- <наступний крок дослідження 1 (напр., які аудиторії перевірити далі й чому)>
- <наступний крок 2>

## Застереження
- <головні прапорці: малий обсяг, сплеск, відсутня стаття, спад трафіку всього розділу>
```

Rules:
- `**bold**` is supported inside lines; bullets start with `- `.
- Every `%` you write is checked against computed figures (±1.5 pp). If `CLAIM CHECK` lists a
  line, fix the number or remove it, then re-run `report`.
- Use rounded numbers consistently with the output (e.g. −59.6% or −60%, not −58%).
- If any series has `low` confidence, include a Caveats section.
- The PDF's charts, table, method and limitations are Ukrainian by default; `--ui en` only on explicit request.
- Terms: growth → «зміна», 90% CI → «90% ДІ», confidence high/medium/low → «висока/середня/низька», pp → «в.п.».
- If `WARNING: Content is too long` appears, shorten the notes.
