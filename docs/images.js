// Sources d'images, appelées directement depuis le navigateur de l'hôte (pas de clé, CORS autorisé).
// Chaque provider renvoie une liste [{ url, thumb }]. On essaie Openverse, puis Wikimedia Commons,
// et en dernier recours le mode "demo" (images en emojis) pour que la partie ne bloque jamais.

const cache = new Map(); // "provider:query" -> [{ url, thumb }]
let forced = null;

export function setProvider(name) {
  forced = providers[name] ? name : null;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${new URL(url).host}`);
  return res.json();
}

const providers = {
  // Openverse : moteur d'images libres de droits. Index anglophone, on cherche la traduction.
  async openverse(item) {
    const p = new URLSearchParams({ q: item.en || item.q, page_size: '20', mature: 'false' });
    const data = await getJson(`https://api.openverse.org/v1/images/?${p}`);
    return (data.results || []).map((r) => ({ url: r.url, thumb: r.thumbnail || r.url }));
  },

  // Wikimedia Commons : recherche de fichiers images, vignettes de 800 px.
  async wikimedia(item) {
    const p = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'search',
      gsrsearch: `${item.en || item.q} filetype:bitmap`,
      gsrnamespace: '6',
      gsrlimit: '15',
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '800',
    });
    const data = await getJson(`https://commons.wikimedia.org/w/api.php?${p}`);
    return Object.values(data.query?.pages || {})
      .sort((a, b) => a.index - b.index)
      .map((pg) => pg.imageinfo?.[0])
      .filter(Boolean)
      .map((i) => ({ url: i.thumburl || i.url, thumb: i.thumburl || i.url }));
  },

  // Mode hors ligne : une "image" SVG faite d'emojis.
  async demo(item) {
    const hue = [...item.q].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
<rect width="600" height="400" fill="hsl(${hue},55%,82%)"/>
<text x="300" y="235" font-size="120" text-anchor="middle">${item.e}</text></svg>`;
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return [{ url, thumb: url }];
  },
};

const CHAIN = ['openverse', 'wikimedia', 'demo'];

async function resultsFor(item) {
  for (const name of forced ? [forced] : CHAIN) {
    const key = `${name}:${item.q}`;
    if (cache.has(key)) return cache.get(key);
    try {
      const results = (await providers[name](item)).filter((r) => r.url);
      if (results.length) {
        cache.set(key, results);
        return results;
      }
    } catch (err) {
      console.warn(`[images] ${name} a échoué pour "${item.q}" : ${err.message}`);
    }
  }
  return providers.demo(item);
}

// Renvoie une image au hasard parmi les premiers résultats de la recherche.
export async function imageFor(item) {
  const top = (await resultsFor(item)).slice(0, 8);
  return top[Math.floor(Math.random() * top.length)];
}
