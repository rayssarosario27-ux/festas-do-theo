/*****************************************************************
 * Festas do Théo — backend (Google Apps Script)
 *
 * Guarda fotos e vídeos no Google Drive da dona da conta:
 *   Festas do Théo/
 *     4 anos/        (uma pasta por festa)
 *     5 anos/
 *     _uploads/      (partes temporárias de uploads grandes)
 *
 * Tudo que entra numa pasta de ano aparece no site,
 * inclusive arquivos colocados direto pelo app do Drive.
 *
 * Deploy: Implantar > Nova implantação > App da Web
 *   Executar como: Eu
 *   Quem pode acessar: Qualquer pessoa
 * Depois do deploy, definir a senha do painel:
 *   Propriedades do script > ADMIN_PASSWORD = <senha>
 * e colar a URL /exec em assets/api.js (API_URL).
 *****************************************************************/

var ROOT_FOLDER_NAME = 'Festas do Théo';
var PROP_PW = 'ADMIN_PASSWORD';
var PROP_YEARS = 'YEARS_CONFIG';
var PROP_MAIN_COVER = 'MAIN_COVER';
var CACHE_TTL_SECONDS = 120;

var DEFAULT_YEARS = {
  '4': {
    num: '4',
    theme: 'Vingadores',
    date: '13 de dezembro de 2026',
    shortDate: '13.12.2026',
    place: 'Salão Espaço Magnata • Cosmos, Rio de Janeiro',
    invite: 'https://theo-4-anos.pages.dev/',
    partyAt: '2026-12-13T15:00:00-03:00'
  }
};

function getYearsConfig_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_YEARS);
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      for (var k in DEFAULT_YEARS) if (!parsed[k]) parsed[k] = DEFAULT_YEARS[k];
      return parsed;
    } catch (e) {}
  }
  return JSON.parse(JSON.stringify(DEFAULT_YEARS));
}

function saveYearsConfig_(cfg) {
  PropertiesService.getScriptProperties().setProperty(PROP_YEARS, JSON.stringify(cfg));
}

function getMainCover_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_MAIN_COVER) || '';
}

function setCover_(b) {
  var cfg = getYearsConfig_();
  var ano = String(b.ano);
  if (!cfg[ano]) cfg[ano] = { num: ano };
  cfg[ano].coverFileId = b.fileId || '';
  saveYearsConfig_(cfg);
  bustCache_(ano);
  return { ok: true };
}

function setMainCover_(b) {
  PropertiesService.getScriptProperties().setProperty(PROP_MAIN_COVER, b.fileId || '');
  bustCache_(String(b.ano || '4'));
  return { ok: true };
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'health') return json_({ ok: true });
    if (p.action === 'years') return json_({ ok: true, years: getYearsConfig_(), mainCover: getMainCover_() });
    if (p.action === 'albums') return json_({ ok: true, albums: getAlbumsConfig_() });
    if (p.action === 'list') {
      if (p.album) return json_(applyCaptions_(listAlbum_(String(p.album))));
      return json_(applyCaptions_(listYear_(String(p.ano || '4'))));
    }
    return json_({ ok: false, error: 'acao desconhecida' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'json invalido' });
  }
  try {
    if (body.action === 'login') return json_({ ok: checkPw_(body.password) });

    // ações públicas de conta (visitantes do site)
    switch (body.action) {
      case 'cadastro': return json_(cadastro_(body));
      case 'verificar': return json_(verificar_(body));
      case 'reenviar': return json_(reenviar_(body));
      case 'loginConta': return json_(loginConta_(body));
      case 'sessao': return json_(sessao_(body));
      case 'logout': return json_(logout_(body));
      case 'recuperar': return json_(recuperar_(body));
      case 'redefinir': return json_(redefinir_(body));
    }

    if (!checkPw_(body.password)) return json_({ ok: false, error: 'senha incorreta' });
    switch (body.action) {
      case 'uploadDirect': return json_(uploadDirect_(body));
      case 'uploadStart': return json_({ ok: true, uploadId: Utilities.getUuid() });
      case 'uploadChunk': return json_(uploadChunk_(body));
      case 'uploadFinish': return json_(uploadFinish_(body));
      case 'delete': return json_(deleteFile_(body));
      case 'createYear':
        return json_(createYear_(body));
      case 'setCover':
        return json_(setCover_(body));
      case 'setMainCover':
        return json_(setMainCover_(body));
      case 'stats': return json_(stats_());
      case 'pessoas': return json_(pessoas_());
      case 'liberar': return json_(setStatus_(body, 'APROVADO'));
      case 'bloquear': return json_(setStatus_(body, 'BLOQUEADO'));
      case 'desbloquear': return json_(setStatus_(body, 'APROVADO'));
      case 'excluir': return json_(excluir_(body));
      case 'createAlbum': return json_(createAlbum_(body));
      case 'updateAlbum': return json_(updateAlbum_(body));
      case 'setCaption': return json_(setCaption_(body));
      default: return json_({ ok: false, error: 'acao desconhecida' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ---------- pastas ---------- */

function getRoot_() {
  var it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
}

function getYearFolder_(ano, create) {
  var root = getRoot_();
  var name = ano + '-anos';
  var it = root.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  if (create) return root.createFolder(name);
  return null;
}

function uploadsRoot_() {
  var root = getRoot_();
  var it = root.getFoldersByName('_uploads');
  return it.hasNext() ? it.next() : root.createFolder('_uploads');
}

/* ---------- segurança ---------- */

function checkPw_(pw) {
  var real = PropertiesService.getScriptProperties().getProperty(PROP_PW);
  return !!real && pw === real;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- listagem pública ---------- */

function listYear_(ano) {
  var cache = CacheService.getScriptCache();
  var key = 'list_' + ano;
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var folder = getYearFolder_(ano, true);
  var coverIds = {};
  var mc = getMainCover_(); if (mc) coverIds[mc] = true;
  var ycfg = getYearsConfig_()[ano]; if (ycfg && ycfg.coverFileId) coverIds[ycfg.coverFileId] = true;
  var photos = [];
  var videos = [];
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.isTrashed()) continue;
    if (coverIds[f.getId()]) continue; // capa não entra na galeria
    try {
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {}
    var mime = f.getMimeType();
    var item = {
      id: f.getId(),
      name: f.getName(),
      created: f.getDateCreated().toISOString(),
      size: f.getSize(),
      thumb: 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w1600',
      preview: 'https://drive.google.com/file/d/' + f.getId() + '/preview',
      download: 'https://drive.google.com/uc?export=download&id=' + f.getId()
    };
    if (mime.indexOf('video/') === 0) videos.push(item);
    else if (mime.indexOf('image/') === 0) photos.push(item);
  }
  var byNewest = function (a, b) { return a.created < b.created ? 1 : -1; };
  photos.sort(byNewest);
  videos.sort(byNewest);

  var out = { ok: true, ano: ano, meta: getYearsConfig_()[ano] || null, photos: photos, videos: videos };
  try { cache.put(key, JSON.stringify(out), CACHE_TTL_SECONDS); } catch (e) {}
  return out;
}

/* ---------- upload ---------- */

function mediaFolder_(b) {
  return b.album ? getAlbumFolder_(String(b.album), true) : getYearFolder_(String(b.ano), true);
}

function uploadDirect_(b) {
  var folder = mediaFolder_(b);
  var blob = Utilities.newBlob(
    Utilities.base64Decode(b.data),
    b.mime || 'application/octet-stream',
    b.name || 'arquivo'
  );
  var f = folder.createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  bustCache_(b.ano, b.album);
  return { ok: true, id: f.getId() };
}

function uploadChunk_(b) {
  var ur = uploadsRoot_();
  var it = ur.getFoldersByName(b.uploadId);
  var uf = it.hasNext() ? it.next() : ur.createFolder(b.uploadId);
  var bytes = Utilities.base64Decode(b.data);
  var name = 'part_' + ('00000' + Number(b.index)).slice(-6);
  uf.createFile(Utilities.newBlob(bytes, 'application/octet-stream', name));
  return { ok: true };
}

function uploadFinish_(b) {
  var ur = uploadsRoot_();
  var it = ur.getFoldersByName(b.uploadId);
  if (!it.hasNext()) return { ok: false, error: 'upload nao encontrado' };
  var uf = it.next();
  var parts = [];
  var files = uf.getFiles();
  while (files.hasNext()) parts.push(files.next());
  parts.sort(function (x, y) { return x.getName() < y.getName() ? -1 : 1; });
  if (!parts.length) return { ok: false, error: 'sem partes' };

  var all = [];
  parts.forEach(function (p) {
    all = all.concat(p.getBlob().getBytes());
    p.setTrashed(true);
  });
  var blob = Utilities.newBlob(all, b.mime || 'application/octet-stream', b.name || 'arquivo');
  var folder = mediaFolder_(b);
  var f = folder.createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  uf.setTrashed(true);
  bustCache_(b.ano, b.album);
  return { ok: true, id: f.getId() };
}

/* ---------- anos ---------- */

function createYear_(b) {
  var ano = String(b.ano);
  getYearFolder_(ano, true);
  var cfg = getYearsConfig_();
  cfg[ano] = {
    num: ano,
    theme: b.theme || '',
    date: b.date || '',
    place: b.place || '',
    invite: b.invite || ''
  };
  saveYearsConfig_(cfg);
  return { ok: true };
}

/* ---------- manutenção ---------- */

function deleteFile_(b) {
  DriveApp.getFileById(b.fileId).setTrashed(true);
  bustCache_(b.ano, b.album);
  return { ok: true };
}

function stats_() {
  var out = {
    ok: true,
    used: DriveApp.getStorageUsed(),
    limit: DriveApp.getStorageLimit(),
    years: []
  };
  var root = getRoot_();
  var it = root.getFolders();
  while (it.hasNext()) {
    var fo = it.next();
    if (fo.getName() === '_uploads') continue;
    var count = 0;
    var bytes = 0;
    var fs = fo.getFiles();
    while (fs.hasNext()) {
      var f = fs.next();
      if (!f.isTrashed()) { count++; bytes += f.getSize(); }
    }
    out.years.push({ name: fo.getName(), count: count, bytes: bytes });
  }
  return out;
}

function bustCache_(ano, album) {
  try {
    if (album) CacheService.getScriptCache().remove('album_' + album);
    else CacheService.getScriptCache().remove('list_' + ano);
  } catch (e) {}
}

/* ---------- legendas (captions) por arquivo ----------
 * Aba "Legendas" na planilha: fileId | caption | atualizadoEm
 * Sem legenda = nada aparece no site. */

function captionsSheet_() { return sheet_('Legendas', ['fileId', 'caption', 'atualizadoEm']); }

function getCaptions_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('captions_v1');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var vals = captionsSheet_().getDataRange().getValues();
  var map = {};
  for (var i = 1; i < vals.length; i++) {
    if (vals[i][0] && vals[i][1]) map[String(vals[i][0])] = String(vals[i][1]);
  }
  try { cache.put('captions_v1', JSON.stringify(map), CACHE_TTL_SECONDS); } catch (e) {}
  return map;
}

function setCaption_(b) {
  var fileId = String(b.fileId || '');
  var caption = String(b.caption || '').trim().slice(0, 120);
  if (!fileId) return { ok: false, error: 'arquivo não encontrado' };
  var sh = captionsSheet_();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === fileId) {
      if (caption) sh.getRange(i + 1, 1, 1, 3).setValues([[fileId, caption, new Date().toISOString()]]);
      else sh.deleteRow(i + 1);
      try { CacheService.getScriptCache().remove('captions_v1'); } catch (e) {}
      return { ok: true };
    }
  }
  if (caption) sh.appendRow([fileId, caption, new Date().toISOString()]);
  try { CacheService.getScriptCache().remove('captions_v1'); } catch (e) {}
  return { ok: true };
}

function applyCaptions_(out) {
  var caps = getCaptions_();
  ['photos', 'videos'].forEach(function (k) {
    (out[k] || []).forEach(function (it) { it.caption = caps[it.id] || ''; });
  });
  return out;
}

/* ==================================================================
 * CONTAS — visitantes do site (cadastro, aprovação, login, senha)
 * Planilha "Festas do Théo — Usuários" na pasta Festas do Théo:
 *   Usuarios: email | nome | hash | salt | status | criadoEm | verificadoEm
 *   Codigos:  email | codigo | tipo | expiraEm(ms)
 *   Sessoes:  token | email | expiraEm(ms)
 * Status: VERIFICAR (código pendente) > PENDENTE (aguarda liberação)
 *         > APROVADO | BLOQUEADO
 * ================================================================== */

var PROP_SSID = 'USERS_SSID';
var SS_NAME = 'Festas do Théo — Usuários';
var SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
var CODE_MS = 15 * 60 * 1000;              // 15 minutos

function getSs_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_SSID);
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(SS_NAME);
    var file = DriveApp.getFileById(ss.getId());
    getRoot_().addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    ss.getSheets()[0].setName('Usuarios');
    props.setProperty(PROP_SSID, ss.getId());
  }
  return ss;
}

function sheet_(name, headers) {
  var sh = getSs_().getSheetByName(name);
  if (!sh) sh = getSs_().insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  return sh;
}

function usersSheet_() { return sheet_('Usuarios', ['email', 'nome', 'hash', 'salt', 'status', 'criadoEm', 'verificadoEm']); }
function codesSheet_() { return sheet_('Codigos', ['email', 'codigo', 'tipo', 'expiraEm']); }
function sessSheet_() { return sheet_('Sessoes', ['token', 'email', 'expiraEm']); }

function sha256_(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return b.map(function (x) { var v = (x < 0 ? x + 256 : x).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function findUser_(email) {
  email = String(email || '').trim().toLowerCase();
  var sh = usersSheet_();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).toLowerCase() === email) {
      return {
        row: i + 1,
        email: vals[i][0], nome: vals[i][1], hash: vals[i][2], salt: vals[i][3],
        status: vals[i][4], criadoEm: vals[i][5]
      };
    }
  }
  return null;
}

function newCode_(email, tipo) {
  var sh = codesSheet_();
  var vals = sh.getDataRange().getValues();
  for (var i = vals.length - 1; i >= 1; i--) {
    if (String(vals[i][0]).toLowerCase() === String(email).toLowerCase() && vals[i][2] === tipo) {
      sh.deleteRow(i + 1);
    }
  }
  var code = String(Math.floor(100000 + Math.random() * 900000));
  sh.appendRow([String(email).toLowerCase(), code, tipo, Date.now() + CODE_MS]);
  return code;
}

function checkCode_(email, code, tipo) {
  var sh = codesSheet_();
  var vals = sh.getDataRange().getValues();
  var now = Date.now();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).toLowerCase() === String(email).toLowerCase()
        && String(vals[i][1]) === String(code).trim() && vals[i][2] === tipo) {
      if (Number(vals[i][3]) < now) return false;
      sh.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function createSession_(email) {
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  sessSheet_().appendRow([token, String(email).toLowerCase(), Date.now() + SESSION_MS]);
  return token;
}

function sessionUser_(token) {
  if (!token) return null;
  var sh = sessSheet_();
  var vals = sh.getDataRange().getValues();
  var now = Date.now();
  for (var i = vals.length - 1; i >= 1; i--) {
    if (vals[i][0] === token) {
      if (Number(vals[i][2]) < now) { sh.deleteRow(i + 1); return null; }
      return findUser_(vals[i][1]);
    }
  }
  return null;
}

function excluir_(b) {
  var email = String(b.email || '').trim().toLowerCase();
  var u = findUser_(email);
  killSessions_(email);
  killCodes_(email);
  if (u) usersSheet_().deleteRow(u.row);
  return { ok: true };
}

function killCodes_(email) {
  var sh = codesSheet_();
  var vals = sh.getDataRange().getValues();
  email = String(email).toLowerCase();
  for (var i = vals.length - 1; i >= 1; i--) {
    if (String(vals[i][0]).toLowerCase() === email) sh.deleteRow(i + 1);
  }
}

function killSessions_(email) {
  var sh = sessSheet_();
  var vals = sh.getDataRange().getValues();
  for (var i = vals.length - 1; i >= 1; i--) {
    if (String(vals[i][1]).toLowerCase() === String(email).toLowerCase()) sh.deleteRow(i + 1);
  }
}

/* ---------- emails ---------- */

function mailHtml_(title, lines, code) {
  var codeBlock = code
    ? '<div style="margin:28px 0;text-align:center"><span style="display:inline-block;background:#181818;border:1px solid #333;border-radius:12px;padding:18px 34px;font-size:34px;letter-spacing:10px;font-weight:700;color:#fff;font-family:Arial,sans-serif">' + code + '</span></div>'
    : '';
  return '<div style="background:#0b0b0f;padding:36px 16px;font-family:Arial,sans-serif">'
    + '<div style="max-width:440px;margin:0 auto;background:#141419;border-radius:16px;padding:34px 30px;border:1px solid #26262e">'
    + '<div style="color:#e50914;font-weight:800;font-size:15px;letter-spacing:2px;margin-bottom:18px">FESTAS DO THÉO</div>'
    + '<div style="color:#fff;font-size:21px;font-weight:700;margin-bottom:14px">' + title + '</div>'
    + '<div style="color:#b9b9c3;font-size:14px;line-height:1.65">' + lines + '</div>'
    + codeBlock
    + '<div style="color:#6d6d78;font-size:12px;margin-top:26px;line-height:1.6">Este código vale por 15 minutos.<br>Se você não pediu isso, pode ignorar este email.</div>'
    + '</div></div>';
}

function sendMail_(email, subject, title, lines, code) {
  // GmailApp garante charset UTF-8 explícito nos headers MIME do email.
  var plain = title + '\n\n' + lines + (code ? '\n\nSeu código: ' + code : '') + '\n\nFestas do Théo';
  GmailApp.sendEmail(email, subject, plain, { htmlBody: mailHtml_(title, lines, code), name: 'Festas do Théo' });
}

function sendCodeMail_(email, nome, code, tipo) {
  var first = String(nome || '').split(' ')[0] || 'oi';
  var subject, title, lines;
  if (tipo === 'RECUPERACAO') {
    subject = 'Seu código para redefinir a senha — Festas do Théo';
    title = 'Redefinir sua senha';
    lines = 'Oi, ' + first + '! Recebemos seu pedido para redefinir a senha no álbum Festas do Théo. Use este código para criar uma senha nova:';
  } else {
    subject = 'Confirme seu cadastro — Festas do Théo';
    title = 'Bem-vindo(a) ao álbum do Théo!';
    lines = 'Oi, ' + first + '! Falta pouco: confirme seu email com este código para terminar seu cadastro no álbum Festas do Théo:';
  }
  sendMail_(email, subject, title, lines, code);
}

function sendApprovedMail_(email, nome) {
  var first = String(nome || '').split(' ')[0] || 'oi';
  sendMail_(email, 'Seu acesso foi liberado! — Festas do Théo', 'Acesso liberado 🎉', 'Oi, ' + first + '! Sua conta no álbum Festas do Théo foi liberada pela família. Entre com seu email e senha para ver as fotos e os vídeos.', null);
}


/* ---------- ações públicas de conta ---------- */

function cadastro_(b) {
  var nome = String(b.name || '').trim();
  var email = String(b.email || '').trim().toLowerCase();
  var pw = String(b.password || '');
  if (nome.length < 2) return { ok: false, error: 'digite seu nome' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'digite um email válido' };
  if (pw.length < 8) return { ok: false, error: 'A senha precisa ter pelo menos 8 caracteres' };

  var u = findUser_(email);
  if (u && u.status !== 'VERIFICAR') return { ok: false, error: 'já existe uma conta com este email' };
  if (!u) {
    var salt = Utilities.getUuid();
    usersSheet_().appendRow([email, nome, sha256_(salt + ':' + pw), salt, 'VERIFICAR', new Date().toISOString(), '']);
  } else {
    var sh = usersSheet_();
    var salt2 = Utilities.getUuid();
    sh.getRange(u.row, 2, 1, 4).setValues([[nome, sha256_(salt2 + ':' + pw), salt2, 'VERIFICAR']]);
  }
  var code = newCode_(email, 'CADASTRO');
  sendCodeMail_(email, nome, code, 'CADASTRO');
  return { ok: true, verify: true };
}

function verificar_(b) {
  var email = String(b.email || '').trim().toLowerCase();
  var u = findUser_(email);
  if (!u) return { ok: false, error: 'conta não encontrada' };
  if (u.status !== 'VERIFICAR') return { ok: true, status: u.status };
  if (!checkCode_(email, b.code, 'CADASTRO')) return { ok: false, error: 'código inválido ou expirado' };
  usersSheet_().getRange(u.row, 5, 1, 3).setValues([['PENDENTE', usersSheet_().getRange(u.row, 6).getValue(), new Date().toISOString()]]);
  return { ok: true, status: 'PENDENTE' };
}

function reenviar_(b) {
  var email = String(b.email || '').trim().toLowerCase();
  var u = findUser_(email);
  if (!u) return { ok: true }; // não revela existência
  if (u.status !== 'VERIFICAR') return { ok: true };
  var code = newCode_(email, 'CADASTRO');
  sendCodeMail_(email, u.nome, code, 'CADASTRO');
  return { ok: true };
}

function loginConta_(b) {
  var email = String(b.email || '').trim().toLowerCase();
  var u = findUser_(email);
  if (!u || u.hash !== sha256_(u.salt + ':' + String(b.password || ''))) {
    return { ok: false, error: 'email ou senha incorretos' };
  }
  if (u.status === 'VERIFICAR') {
    var code = newCode_(email, 'CADASTRO');
    sendCodeMail_(email, u.nome, code, 'CADASTRO');
    return { ok: false, needsVerification: true, error: 'confirme seu email — enviamos um código novo' };
  }
  if (u.status === 'BLOQUEADO') return { ok: false, error: 'conta bloqueada — fale com a família' };
  var token = createSession_(email);
  return { ok: true, token: token, name: u.nome, email: email, status: u.status };
}

function sessao_(b) {
  var u = sessionUser_(String(b.token || ''));
  if (!u) return { ok: false };
  return { ok: true, name: u.nome, email: u.email, status: u.status };
}

function logout_(b) {
  var sh = sessSheet_();
  var vals = sh.getDataRange().getValues();
  for (var i = vals.length - 1; i >= 1; i--) {
    if (vals[i][0] === String(b.token || '')) sh.deleteRow(i + 1);
  }
  return { ok: true };
}

function recuperar_(b) {
  var email = String(b.email || '').trim().toLowerCase();
  var u = findUser_(email);
  if (u) {
    var code = newCode_(email, 'RECUPERACAO');
    sendCodeMail_(email, u.nome, code, 'RECUPERACAO');
  }
  return { ok: true }; // não revela existência
}

function redefinir_(b) {
  var email = String(b.email || '').trim().toLowerCase();
  var pw = String(b.password || '');
  if (pw.length < 8) return { ok: false, error: 'A senha precisa ter pelo menos 8 caracteres' };
  var u = findUser_(email);
  if (!u) return { ok: false, error: 'código inválido ou expirado' };
  if (!checkCode_(email, b.code, 'RECUPERACAO')) return { ok: false, error: 'código inválido ou expirado' };
  var salt = Utilities.getUuid();
  usersSheet_().getRange(u.row, 3, 1, 2).setValues([[sha256_(salt + ':' + pw), salt]]);
  killSessions_(email);
  return { ok: true };
}

/* ---------- ações do painel (Pessoas) ---------- */

function pessoas_() {
  var sh = usersSheet_();
  var vals = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    out.push({
      email: vals[i][0], nome: vals[i][1], status: vals[i][4],
      criadoEm: vals[i][5] ? String(vals[i][5]) : ''
    });
  }
  out.sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : -1; });
  return { ok: true, pessoas: out };
}

function setStatus_(b, status) {
  var u = findUser_(b.email);
  if (!u) return { ok: false, error: 'conta não encontrada' };
  usersSheet_().getRange(u.row, 5).setValue(status);
  if (status === 'BLOQUEADO') killSessions_(u.email);
  if (status === 'APROVADO') { try { sendApprovedMail_(u.email, u.nome); } catch (e) {} }
  return { ok: true };
}

/* ==================================================================
 * ÁLBUNS LIVRES — "Crescendo com Theo"
 * Pastas: Festas do Théo/albuns/<slug>
 * Config: propriedade ALBUMS_CONFIG { slug: {slug, nome, desc, coverFileId, criadoEm} }
 * ================================================================== */

var PROP_ALBUMS = 'ALBUMS_CONFIG';

function getAlbumsConfig_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_ALBUMS);
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  return {};
}

function saveAlbumsConfig_(cfg) {
  PropertiesService.getScriptProperties().setProperty(PROP_ALBUMS, JSON.stringify(cfg));
}

function slugify_(s) {
  var base = String(s || 'album').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'album';
  var slug = base, n = 2;
  var cfg = getAlbumsConfig_();
  while (cfg[slug]) { slug = base + '-' + n; n++; }
  return slug;
}

function albumsRoot_() {
  var root = getRoot_();
  var it = root.getFoldersByName('albuns');
  return it.hasNext() ? it.next() : root.createFolder('albuns');
}

function getAlbumFolder_(slug, create) {
  var root = albumsRoot_();
  var it = root.getFoldersByName(slug);
  if (it.hasNext()) return it.next();
  if (create) return root.createFolder(slug);
  return null;
}

function createAlbum_(b) {
  var nome = String(b.name || '').trim();
  if (nome.length < 2) return { ok: false, error: 'digite o nome do álbum' };
  var cfg = getAlbumsConfig_();
  var slug = slugify_(nome);
  cfg[slug] = { slug: slug, nome: nome, desc: String(b.desc || '').trim(), coverFileId: '', criadoEm: new Date().toISOString() };
  saveAlbumsConfig_(cfg);
  getAlbumFolder_(slug, true);
  return { ok: true, slug: slug };
}

function updateAlbum_(b) {
  var cfg = getAlbumsConfig_();
  var a = cfg[String(b.slug)];
  if (!a) return { ok: false, error: 'álbum não encontrado' };
  if (b.name) a.nome = String(b.name).trim();
  if (typeof b.desc === 'string') a.desc = b.desc.trim();
  if (typeof b.coverFileId === 'string') a.coverFileId = b.coverFileId;
  saveAlbumsConfig_(cfg);
  bustCache_(null, String(b.slug));
  return { ok: true };
}

function listAlbum_(slug) {
  var cache = CacheService.getScriptCache();
  var key = 'album_' + slug;
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var folder = getAlbumFolder_(slug, true);
  var coverIds = {};
  var mc = getMainCover_(); if (mc) coverIds[mc] = true;
  var ameta = getAlbumsConfig_()[slug]; if (ameta && ameta.coverFileId) coverIds[ameta.coverFileId] = true;
  var photos = [], videos = [];
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.isTrashed()) continue;
    if (coverIds[f.getId()]) continue; // capa não entra na galeria
    try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    var mime = f.getMimeType();
    var item = {
      id: f.getId(), name: f.getName(), created: f.getDateCreated().toISOString(), size: f.getSize(),
      thumb: 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w1600',
      preview: 'https://drive.google.com/file/d/' + f.getId() + '/preview',
      download: 'https://drive.google.com/uc?export=download&id=' + f.getId()
    };
    if (mime.indexOf('video/') === 0) videos.push(item);
    else if (mime.indexOf('image/') === 0) photos.push(item);
  }
  var byNewest = function (a, b) { return a.created < b.created ? 1 : -1; };
  photos.sort(byNewest); videos.sort(byNewest);
  var out = { ok: true, slug: slug, meta: getAlbumsConfig_()[slug] || null, photos: photos, videos: videos };
  try { cache.put(key, JSON.stringify(out), CACHE_TTL_SECONDS); } catch (e) {}
  return out;
}
