// Festas do Théo — contas de visitantes: sessão, guarda de páginas, navbar e menu de perfil
const AUTH_TOKEN_KEY = 'theo_token';
const AUTH_NAME_KEY = 'theo_name';

function authToken() { return localStorage.getItem(AUTH_TOKEN_KEY) || ''; }

async function authSession() {
  const t = authToken();
  if (!t) return null;
  try {
    const r = await apiPost({ action: 'sessao', token: t });
    if (r.ok) { localStorage.setItem(AUTH_NAME_KEY, r.name || ''); return r; }
  } catch (e) {}
  return null;
}

// Limpa tudo que é da sessão: token, nome e TODO o cache local (theo_c_*).
// Cache protegido nunca sobrevive a um logout ou a uma sessão rejeitada.
function authClearLocal() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_NAME_KEY);
  try { if (typeof apiCacheClear === 'function') apiCacheClear(); } catch (e) {}
}

async function authLogout() {
  const t = authToken();
  try { if (t) await apiPost({ action: 'logout', token: t }); } catch (e) {}
  authClearLocal();
  location.href = 'conta.html';
}

// Guarda: chama no início de páginas protegidas. Redireciona quando preciso.
// Retorna o usuário aprovado ({name, email, status}) ou null (já redirecionou).
async function requireAuth() {
  if (API_URL === 'PENDING_DEPLOY') return { name: 'família', status: 'APROVADO' };
  const t = authToken();
  if (!t) { authClearLocal(); location.replace('conta.html'); return null; }
  const s = await authSession();
  if (!s) { authClearLocal(); location.replace('conta.html'); return null; }
  if (s.status === 'PENDENTE' || s.status === 'VERIFICAR') { authClearLocal(); location.replace('aguardando.html'); return null; }
  if (s.status === 'BLOQUEADO') {
    authClearLocal();
    location.replace('conta.html?bloqueado=1');
    return null;
  }
  return s;
}

// Navbar estilo Netflix: logo, seções, botão de instalar (PWA) e menu de perfil.
function buildNav(active, user) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const first = (user && user.name ? user.name : localStorage.getItem(AUTH_NAME_KEY) || 'F').trim();
  const initial = (first[0] || 'F').toUpperCase();
  nav.innerHTML =
    '<a class="wordmark" href="catalogo.html">FESTAS DO THÉO</a>' +
    '<div class="nav-links">' +
    '  <a href="catalogo.html"' + (active === 'inicio' ? ' class="on"' : '') + '>Início</a>' +
    '  <a href="aniversarios.html"' + (active === 'aniversarios' ? ' class="on"' : '') + '>Aniversários</a>' +
    '  <a href="crescendo.html"' + (active === 'crescendo' ? ' class="on"' : '') + '>Crescendo com Theo</a>' +
    '</div>' +
    '<div class="nav-right">' +
    '  <button class="nav-install" id="navInstall" hidden>Instalar app</button>' +
    '  <div class="profile" id="profileChip">' +
    '    <button class="profile-btn" id="profileBtn" aria-label="Conta">' +
    '      <span class="profile-avatar">' + initial + '</span><span class="profile-caret">▾</span>' +
    '    </button>' +
    '    <div class="profile-menu" id="profileMenu" hidden>' +
    '      <div class="profile-name">' + first.split(' ')[0] + '</div>' +
    '      <button class="profile-out" id="menuInstall" hidden>Instalar app</button>' +
    '      <button class="profile-out" id="btnLogout">Sair</button>' +
    '    </div>' +
    '  </div>' +
    '</div>';
  document.getElementById('btnLogout').addEventListener('click', authLogout);
  const btn = document.getElementById('profileBtn');
  const menu = document.getElementById('profileMenu');
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => { menu.hidden = true; });
  setupInstall();
}

// ---------- PWA: botão discreto de instalação ----------
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  ['navInstall', 'menuInstall'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.hidden = false;
  });
  maybeInstallBanner();
});

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function setupInstall() {
  const buttons = [document.getElementById('navInstall'), document.getElementById('menuInstall')].filter(Boolean);
  if (!buttons.length) return;
  if (isStandalone()) { buttons.forEach((b) => { b.hidden = true; }); return; }
  buttons.forEach((b) => {
    if (isIos()) b.hidden = false; // iOS não dispara beforeinstallprompt
    b.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try { await deferredInstallPrompt.userChoice; } catch (e) {}
        deferredInstallPrompt = null;
        buttons.forEach((x) => { x.hidden = true; });
      } else if (isIos()) {
        showIosHint();
      }
    });
  });
}

function showIosHint() {
  if (document.getElementById('iosHint')) return;
  const d = document.createElement('div');
  d.id = 'iosHint';
  d.className = 'ios-hint';
  d.innerHTML =
    '<span>Para instalar: toque em <b>Compartilhar</b> <span class="ios-share">⎋</span> e depois em <b>Adicionar à Tela de Início</b>.</span>' +
    '<button aria-label="Fechar">✕</button>';
  d.querySelector('button').addEventListener('click', () => d.remove());
  document.body.appendChild(d);
  setTimeout(() => { if (d.parentNode) d.remove(); }, 9000);
}

// Banner bem visível de instalação do app (bottom card). Aparece uma vez por
// semana no máximo, só quando o aparelho consegue instalar (Android/desktop)
// ou quando é iPhone/iPad (instrução Compartilhar > Adicionar à Tela de Início).
function installDismissed() {
  try { return Date.now() - Number(localStorage.getItem('theo_install_dismiss') || 0) < 7 * 24 * 3600 * 1000; } catch (e) { return false; }
}

function maybeInstallBanner() {
  if (isStandalone() || installDismissed()) return;
  if (document.getElementById('installBanner')) return;
  if (!deferredInstallPrompt && !isIos()) return;
  const d = document.createElement('div');
  d.id = 'installBanner';
  d.className = 'install-banner';
  d.innerHTML =
    '<img src="assets/icon-192.png" alt="" class="ib-icon">' +
    '<div class="ib-txt"><b>Instale o app Festas do Théo</b><span>Fotos e vídeos direto na sua tela de início, como um aplicativo.</span></div>' +
    '<button class="ib-btn" id="ibGo">Instalar</button>' +
    '<button class="ib-close" id="ibClose" aria-label="Fechar">✕</button>';
  document.body.appendChild(d);
  d.querySelector('#ibGo').addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try { await deferredInstallPrompt.userChoice; } catch (e) {}
      deferredInstallPrompt = null;
      d.remove();
    } else if (isIos()) {
      showIosHint();
    }
  });
  d.querySelector('#ibClose').addEventListener('click', () => {
    try { localStorage.setItem('theo_install_dismiss', String(Date.now())); } catch (e) {}
    d.remove();
  });
}

window.addEventListener('load', () => setTimeout(maybeInstallBanner, 2500));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
