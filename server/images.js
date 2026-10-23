// Sources d'images. Chaque provider renvoie une liste [{ url, thumb }] pour une recherche.
// Choix via IMAGE_PROVIDER (google | brave | openverse | demo), sinon automatique selon les clés présentes.

const cache = new Map(); // "provider:query" -> [{ url, thumb }]

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${new URL(url).host}`);
  return res.json();
}

const providers = {
  // Google Custom Search JSON API (searchType=image). Nécessite GOOGLE_API_KEY et GOOGLE_CX.
  async google(item) {
    const p = new URLSearchParams({
      key: process.env.GOOGLE_API_KEY,
      cx: process.env.GOOGLE_CX,
      q: item.q,
      searchType: 'image',
      num: '10',
      safe: 'active',
      hl: 'fr',
    });
    const data = await getJson(`https://www.googleapis.com/customsearch/v1?${p}`);
    return (data.items || []).map((i) => ({ url: i.link, thumb: i.image?.thumbnailLink || i.link }));
  },

  // Brave Search API (images). Nécessite BRAVE_API_KEY. Les vignettes passent par le proxy de Brave.
  async brave(item) {
    const p = new URLSearchParams({ q: item.q, count: '20', safesearch: 'strict', search_lang: 'fr' });
    const data = await getJson(`https://api.search.brave.com/res/v1/images/search?${p}`, {
      'X-Subscription-Token': process.env.BRAVE_API_KEY,
      Accept: 'application/json',
    });
    return (data.results || []).map((r) => ({ url: r.thumbnail?.src || r.properties?.url, thumb: r.thumbnail?.src }));
  },

  // Openverse (images libres de droits, sans clé). Index anglophone : on cherche la traduction.
  async openverse(item) {
    const p = new URLSearchParams({ q: item.en || item.q, page_size: '20', mature: 'false' });
    const data = await getJson(`https://api.openverse.org/v1/images/?${p}`);
    return (data.results || []).map((r) => ({ url: r.url, thumb: r.thumbnail || r.url }));
  },

  // Mode hors ligne : une "image" SVG faite d'emojis. Pratique pour tester sans réseau.
  async demo(item) {
    const hue = [...item.q].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
<rect width="600" height="400" fill="hsl(${hue},55%,82%)"/>
<text x="300" y="235" font-size="120" text-anchor="middle">${item.e}</text></svg>`;
    const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    return [{ url, thumb: url }];
  },
};

export function activeProvider() {
  const forced = process.env.IMAGE_PROVIDER;
  if (forced && providers[forced]) return forced;
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX) return 'google';
  if (process.env.BRAVE_API_KEY) return 'brave';
  return 'openverse';
}

// Renvoie une image au hasard parmi les premiers résultats de la recherche.
// En cas d'échec du provider, bascule sur le mode demo pour que la partie continue.
export async function imageFor(item) {
  const name = activeProvider();
  const key = `${name}:${item.q}`;
  let results = cache.get(key);
  if (!results) {
    try {
      results = (await providers[name](item)).filter((r) => r.url);
    } catch (err) {
      console.warn(`[images] ${name} a échoué pour "${item.q}" : ${err.message}`);
      results = [];
    }
    if (results.length) cache.set(key, results);
  }
  if (!results.length) results = await providers.demo(item);
  const top = results.slice(0, 8);
  return top[Math.floor(Math.random() * top.length)];
}
