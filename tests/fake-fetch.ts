// Synthetic Wikimedia API for offline development/tests.
// Usage: WV_CACHE_DIR=$(mktemp -d) node --import ./tests/fake-fetch.ts scripts/wv.ts analyze ...
// Deterministic series: growth rate & level derived from a hash of (lang, title).

function h(s: string): number {
  let x = 2166136261;
  for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
  return (x >>> 0) / 4294967296;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ENTITIES: Record<string, { label: string; desc: string; titles: Record<string, string> }> = {
  Q333: { label: "astronomy", desc: "natural science that studies celestial objects", titles: { en: "Astronomy", uk: "Астрономія", pl: "Astronomia", cs: "Astronomie", de: "Astronomie" } },
  Q1066: { label: "intermittent fasting", desc: "eating pattern", titles: { en: "Intermittent fasting", pl: "Post przerywany", cs: "Přerušovaný půst" } },
  Q999: { label: "Astronomy", desc: "Wikimedia disambiguation page", titles: { en: "Astronomy (disambiguation)" } },
};

function months(start: string, end: string): string[] {
  const out: string[] = [];
  let y = +start.slice(0, 4), m = +start.slice(4, 6);
  const ey = +end.slice(0, 4), em = +end.slice(4, 6);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}${String(m).padStart(2, "0")}0100`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const q = url.searchParams;
  if (url.hostname === "www.wikidata.org") {
    if (q.get("action") === "wbsearchentities") {
      const s = (q.get("search") || "").toLowerCase();
      const ids = Object.entries(ENTITIES).filter(([, e]) => e.label.toLowerCase().includes(s.split(" ")[0])).map(([id]) => id).sort((a) => (a === "Q999" ? -1 : 1));
      return json({ search: ids.map((id) => ({ id })) });
    }
    const ids = q.get("ids")?.split("|") || Object.entries(ENTITIES).filter(([, e]) => Object.values(e.titles).includes(q.get("titles") || "")).map(([id]) => id);
    const entities: Record<string, unknown> = {};
    for (const id of ids) {
      const e = ENTITIES[id];
      entities[id] = e ? { id, labels: { en: { value: e.label } }, descriptions: { en: { value: e.desc } }, sitelinks: Object.fromEntries(Object.entries(e.titles).map(([l, t]) => [`${l}wiki`, { title: t }])) } : { id, missing: "" };
    }
    return json({ entities });
  }
  if (url.pathname.endsWith("/w/api.php")) {
    const t = q.get("titles") || "";
    return json({ query: { pages: [{ title: t, redirects: [{ title: t + " (alt)" }, { title: t.toLowerCase() }] }] } });
  }
  const parts = url.pathname.split("/");
  const i = parts.indexOf("pageviews");
  const kind = parts[i + 1];
  if (kind === "aggregate") {
    const [, project, , , , s, e] = parts.slice(i + 1);
    const lang = project.split(".")[0];
    const base = 2e7 + h(lang) * 3e8;
    return json({ items: months(s, e).map((ts, k) => ({ timestamp: ts, views: Math.round(base * (1 - 0.004 * k) * (1 + 0.08 * Math.sin((k / 12) * 2 * Math.PI))) })) });
  }
  if (kind === "per-article") {
    const [, project, , , art, , s, e] = parts.slice(i + 1);
    const lang = project.split(".")[0];
    const title = decodeURIComponent(art);
    const r = h(lang + title);
    const isRedirect = title.includes("(alt)") || title === title.toLowerCase();
    const base = isRedirect ? 20 * r : 400 + r * 20000;
    const g = (r - 0.4) * 0.06; // monthly growth
    const ms = months(s.slice(0, 6), e.slice(0, 6));
    return json({ items: ms.map((ts, k) => {
      const noise = 1 + 0.1 * Math.sin(k * 7.3 + r * 50);
      let v = base * Math.exp(g * k) * noise * (1 + 0.15 * Math.cos((k / 12) * 2 * Math.PI));
      if (!isRedirect && r > 0.6 && k === ms.length - 8) v *= 5; // a spike
      return { timestamp: ts, views: Math.round(v) };
    }) });
  }
  if (kind === "top") return json({ items: [{ articles: [{ rank: 1, article: "Головна_сторінка", views: 1e6 }, { rank: 2, article: "Астрономія", views: 5e4 }, { rank: 3, article: "Україна", views: 4e4 }] }] });
  return json({ detail: "not found" }, 404);
}) as typeof fetch;
