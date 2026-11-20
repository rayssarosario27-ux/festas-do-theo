// Festas do Théo — configuração e cliente da API (Google Apps Script)
// Preencher API_URL depois do deploy do backend.
const API_URL = 'https://script.google.com/macros/s/AKfycbyIkzRYySb3Pge9Xr30DgeZ0PvA9cKGNqM68Ba93AhqYaXgivYvbLEOaS4bX-VhdPi0IQ/exec';

// Fallback local: usado até o backend entrar no ar e como segurança se a API falhar.
const YEARS = {
  '4': {
    num: '4',
    theme: 'Vingadores',
    date: '13 de dezembro de 2026',
    shortDate: '13.12.2026',
    place: 'Salão Espaço Magnata • Cosmos, Rio de Janeiro',
    invite: 'https://theo-4-anos.pages.dev/',
    partyAt: '2026-12-13T15:00:00-03:00',
    synopsis: 'O pequeno herói completa 4 anos numa festa épica dos Vingadores. As fotos e os vídeos do grande dia ficam guardados aqui, para sempre.',
    emptyText: 'As fotos e os vídeos da festa vão aparecer aqui logo depois da comemoração. Volta aqui para reviver tudo.'
  }
};

// Cache local com TTL + revalidação em background (stale-while-revalidate):
// a navegação entre páginas mostra o conteúdo na hora e atualiza em seguida.
const API_TTL = { years: 10 * 60 * 1000, albums: 5 * 60 * 1000, list: 2 * 60 * 1000 };

function cacheRead(key, ttlMs) {
  try {
    const o = JSON.parse(localStorage.getItem('theo_c_' + key));
    if (o && Date.now() - o.t < ttlMs) return o.v;
  } catch (e) {}
  return null;
}
function cacheWrite(key, val) {
  try { localStorage.setItem('theo_c_' + key, JSON.stringify({ t: Date.now(), v: val })); } catch (e) {}
}
function apiCacheClear() {
  try {
    Object.keys(localStorage).filter((k) => k.indexOf('theo_c_') === 0).forEach((k) => localStorage.removeItem(k));
  } catch (e) {}
}

async function apiGet(params, onUpdate) {
  if (API_URL === 'PENDING_DEPLOY') return { ok: true, pending: true, photos: [], videos: [] };
  const qs = new URLSearchParams(params).toString();
  const ttl = API_TTL[params.action] || 60 * 1000;
  const cached = cacheRead(qs, ttl);
  const fetchFresh = async () => {
    const r = await fetch(API_URL + '?' + qs);
    const j = await r.json();
    if (j && j.ok) {
      const antes = cached ? JSON.stringify(cached) : null;
      cacheWrite(qs, j);
      if (antes && onUpdate && JSON.stringify(j) !== antes) { try { onUpdate(j); } catch (e) {} }
    }
    return j;
  };
  if (cached) { fetchFresh().catch(() => {}); return cached; }
  return fetchFresh();
}

// Ações do painel que mudam o conteúdo: invalidam o cache local depois do POST.
const API_MUTATIONS = ['uploadFinish', 'delete', 'createYear', 'setCover', 'setMainCover', 'createAlbum', 'updateAlbum', 'setCaption'];

async function apiPost(payload) {
  const r = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
  const j = await r.json();
  if (j && j.ok && payload && API_MUTATIONS.indexOf(payload.action) >= 0) apiCacheClear();
  return j;
}

// URL pública de thumbnail de um arquivo do Drive da família.
function coverUrl(fileId, w) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w' + (w || 2048);
}

// Configuração dos anos (tema, data, local, link do convite, capa) + capa principal.
// Retorna { years, mainCover }, mesclando API + fallback.
async function apiYears() {
  const fallback = { years: YEARS, mainCover: '' };
  if (API_URL === 'PENDING_DEPLOY') return fallback;
  try {
    const r = await apiGet({ action: 'years' });
    if (r.ok && r.years) {
      const merged = Object.assign({}, YEARS);
      Object.keys(r.years).forEach((k) => { merged[k] = Object.assign({}, YEARS[k] || {}, r.years[k]); });
      return { years: merged, mainCover: r.mainCover || '' };
    }
  } catch (e) {}
  return fallback;
}
