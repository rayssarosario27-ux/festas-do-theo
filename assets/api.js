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

async function apiGet(params) {
  if (API_URL === 'PENDING_DEPLOY') return { ok: true, pending: true, photos: [], videos: [] };
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(API_URL + '?' + qs);
  return r.json();
}

async function apiPost(payload) {
  const r = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
  return r.json();
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
