'use strict';
/* =========================================================================
   Fallas Alumbrado — La Florida · App móvil (PWA)
   - Misma base de datos y mismos permisos (RLS) que la página web.
   - Solo reporta fallas (punto / circuito) y registra reparaciones.
   - Estadísticas y análisis siguen en la web. La gestión de usuarios (solo admin) también está aquí.
   ========================================================================= */

const SUPABASE_URL = 'https://rcwtqvhssgtufgypnobn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7DTKNsCtPUlaQVDhiwVtoA_o5A_dIcu';
const VERSION_APP = '1.24.1';

const LS_SESION = 'fm_sesion_v1';
const LS_PERFIL = 'fm_perfil_v1';

const ZOOM_EMPALMES = 19;     // desde este zoom se dibujan los empalmes (igual que en el escritorio)
const ZOOM_DATOS = 17;          // desde este zoom se cargan y se pueden tocar puntos y circuitos
const REFRESCO_MS = 60000;      // actualización automática de fallas
const DIAS_MAX_INSPECCION = 7;  // misma regla que la base (admin sin límite)

const PUEDE_REPORTAR = ['ito', 'ito2', 'admin', 'contratista2', 'contratista3'];
const PUEDE_CERRAR = ['contratista', 'contratista2', 'contratista3', 'camion', 'admin'];
const LS_MODO = 'fm_modo_v1';
const PUEDE_MODO_INSPECCION = ['ito', 'ito2', 'admin'];
const PUEDE_ASIGNAR = ['contratista', 'contratista2', 'contratista3', 'admin'];

const CAT_PUNTO = [
  { c: 'F01', d: 'Luminaria vial apagada' },
  { c: 'F04', d: 'Luminaria vial encendida de día' },
  { c: 'F05', d: 'Luminaria vial intermitente' },
  { c: 'F22', d: 'Luminaria agotada o tenue' },
  { c: 'F23', d: 'Luminaria virada - gancho virado' },
  { c: 'F29', d: 'Luminaria peatonal apagada' },
  { c: 'F32', d: 'Luminaria peatonal encendida de día' },
  { c: 'F33', d: 'Luminaria peatonal intermitente' },
  { c: 'F35', d: 'Aplomar poste' },
  { c: 'F38', d: 'Luminaria faltante' },
  { c: 'F43', d: 'Dos luminarias apagadas' },
  { c: 'OTRO', d: 'Otro (describe la falla)' },
];
const CAT_MONOPOSTE = [
  { c: 'F02', d: 'Monoposte apagado' },
  { c: 'F03', d: 'Monoposte encendido de día' },
  { c: 'OTRO', d: 'Otro (describe la falla)' },
];
const CAT_CIRCUITO = [
  { c: 'F02', d: 'Circuito vial apagado' },
  { c: 'F03', d: 'Circuito vial encendido de día' },
  { c: 'F30', d: 'Circuito peatonal apagado' },
  { c: 'F31', d: 'Circuito peatonal encendido de día' },
  { c: 'F45', d: 'Circuito vial intermitente' },
  { c: 'F46', d: 'Circuito peatonal intermitente' },
  { c: 'OTRO', d: 'Otro (describe la falla)' },
];
const CAT_CIERRES = [
  { c: '001', d: 'Cambio de lámpara quemada' },
  { c: '009', d: 'Luminaria en funcionamiento normal' },
  { c: '011', d: 'Cambio de Ballast o Driver' },
  { c: '012', d: 'Cambio de CFE dañada' },
  { c: '013', d: 'Cambio de CFE averiada' },
  { c: '026', d: 'Reparación de conexión' },
  { c: '037', d: 'Cambio de contactor dañado' },
  { c: '041', d: 'Circuito en funcionamiento normal' },
  { c: '047', d: 'Cambio de porta CFE' },
  { c: '052', d: 'Cambio de Ignitor' },
  { c: '054', d: 'Falla subterránea' },
  { c: '072', d: 'Normalización de luminaria o gancho virado' },
  { c: '126', d: 'Cambio de lámpara agotada' },
  { c: '129', d: 'Apriete CFE suelta' },
  { c: '130', d: 'Automático operado' },
  { c: '131', d: 'Automático operado por 3eros' },
  { c: '999', d: 'Otros' },
];
const DESC_CODIGO = {};
[...CAT_PUNTO, ...CAT_MONOPOSTE, ...CAT_CIRCUITO].forEach((x) => { DESC_CODIGO[x.c] = x.d; });
const ETIQUETA_ESTADO = { reportada: 'Reportada', pendiente: 'Pendiente', reiterada: 'Reiterada', reparada: 'Reparada' };
const COLOR_ESTADO = { reportada: '#d33a2c', pendiente: '#f08c00', reiterada: '#7b3fe4', reparada: '#2e9e57' };

/* ---------------------------- utilidades ---------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Fechas en hora de Chile (misma lógica que la página web) */
const ZONA_CHILE = 'America/Santiago';
const FMT_PARTES_CHILE = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_CHILE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const FMT_VISTA = new Intl.DateTimeFormat('es-CL', {
  timeZone: ZONA_CHILE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function fechaChileLocal(fechaStr, hh = 0, mm = 0, ss = 0) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const suponiendoUtc = Date.UTC(y, m - 1, d, hh, mm, ss);
  const desfase = (t) => {
    const p = Object.fromEntries(FMT_PARTES_CHILE.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
  };
  const DIA = 24 * 3600 * 1000;
  const candidatos = [...new Set([desfase(suponiendoUtc - DIA), desfase(suponiendoUtc + DIA)])].map((off) => suponiendoUtc - off);
  const validos = candidatos.filter((t) => desfase(t) === suponiendoUtc - t);
  return new Date(validos.length ? Math.min(...validos) : Math.max(...candidatos));
}
function hoyChileStr() {
  const p = Object.fromEntries(FMT_PARTES_CHILE.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function horaChileStr() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}
function sumarDiasStr(fechaStr, dias) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}
function fmtFecha(iso) { return iso ? FMT_VISTA.format(new Date(iso)) : '—'; }
// Fecha corta y hora en horario de Chile (dd/mm, hh:mm). Vacía si no hay fecha.
function fmtFechaHoraCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}, ${p.hour}:${p.minute}`;
}
// Duración desde que se informó la falla (mismo criterio que la web de escritorio).
function fmtDuracion(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return '0 min';
  const total = Math.floor(ms / 60000);
  const dias = Math.floor(total / 1440), horas = Math.floor((total % 1440) / 60), min = total % 60;
  const partes = [];
  if (dias > 0) partes.push(`${dias} día${dias !== 1 ? 's' : ''}`);
  if (horas > 0) partes.push(`${horas} h`);
  if (dias === 0 && min > 0) partes.push(`${min} min`);
  return partes.length ? partes.join(' ') : '0 min';
}
function fmtFechaCorta(fechaStr) { const [y, m, d] = fechaStr.split('-'); return `${d}-${m}-${y}`; }
function hace(iso) {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
function distanciaM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDist(m) { return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`; }
function centroGeom(g) {
  const pts = [];
  (function rec(c) { if (typeof c[0] === 'number') pts.push(c); else c.forEach(rec); })(g.coordinates);
  let mnLa = 90, mxLa = -90, mnLo = 180, mxLo = -180;
  pts.forEach(([lo, la]) => { mnLa = Math.min(mnLa, la); mxLa = Math.max(mxLa, la); mnLo = Math.min(mnLo, lo); mxLo = Math.max(mxLo, lo); });
  return [(mnLa + mxLa) / 2, (mnLo + mxLo) / 2];
}

let toastT = null;
function toast(msg, tipo = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = tipo;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, tipo === 'error' ? 6000 : 3500);
}

/* ------------------------- sesión y API (REST) ------------------------- */
class SesionExpirada extends Error { constructor() { super('Tu sesión expiró. Vuelve a iniciar sesión.'); this.name = 'SesionExpirada'; } }
let sesion = null;
function cargarSesion() { try { sesion = JSON.parse(localStorage.getItem(LS_SESION)); } catch (e) { sesion = null; } }
function guardarSesion(s) {
  sesion = s;
  try { s ? localStorage.setItem(LS_SESION, JSON.stringify(s)) : localStorage.removeItem(LS_SESION); } catch (e) { /* sin almacenamiento */ }
}
function sesionDesde(d) {
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    user_id: (d.user && d.user.id) || (sesion && sesion.user_id) || null,
  };
}
async function authPost(path, body) {
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, {
      method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch (e) { throw new Error('Sin conexión. Revisa tu señal e intenta de nuevo.'); }
  const data = await res.json().catch(() => ({}));
  return { res, data };
}
async function iniciarSesion(email, password) {
  const { res, data } = await authPost('/auth/v1/token?grant_type=password', { email, password });
  if (!res.ok) {
    const m = String(data.error_description || data.msg || data.message || '');
    throw new Error(/invalid login/i.test(m) ? 'Correo o contraseña incorrectos.' : (m || 'No se pudo iniciar sesión.'));
  }
  guardarSesion(sesionDesde(data));
}
let refrescando = null;
function refrescarSesion() {
  if (refrescando) return refrescando;
  refrescando = (async () => {
    try {
      if (!sesion || !sesion.refresh_token) throw new SesionExpirada();
      const { res, data } = await authPost('/auth/v1/token?grant_type=refresh_token', { refresh_token: sesion.refresh_token });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) { guardarSesion(null); throw new SesionExpirada(); }
        throw new Error('No se pudo renovar la sesión. Intenta de nuevo.');
      }
      guardarSesion(sesionDesde(data));
    } finally { refrescando = null; }
  })();
  return refrescando;
}
async function tokenVigente() {
  if (!sesion) throw new SesionExpirada();
  if (sesion.expires_at - Date.now() / 1000 < 60) await refrescarSesion();
  return sesion.access_token;
}
async function api(path, { method = 'GET', body, prefer } = {}, reintento = false) {
  const token = await tokenVigente();
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, {
      method,
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) { throw new Error('Sin conexión. Revisa tu señal e intenta de nuevo.'); }
  if (res.status === 401 && !reintento) { await refrescarSesion(); return api(path, { method, body, prefer }, true); }
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
  if (!res.ok) throw new Error((data && (data.message || data.hint || data.error_description)) || `Error ${res.status}`);
  return data;
}
const select = (tabla, q) => api(`/rest/v1/${tabla}?${q}`);
const rpc = (fn, args) => api(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args || {} });

/* ------------------------------ fotos de reparación ------------------------------ */
// Cada foto se reduce en el teléfono antes de subirla: lado mayor 1280 px, JPEG ~70 % (unos 150–250 KB en vez de 3–6 MB).
const MAX_FOTOS = 3, FOTO_LADO = 1280, FOTO_CALIDAD = 0.7, FOTO_MAX_BYTES = 400 * 1024;
async function comprimirFoto(file) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    img = await new Promise((ok, mal) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => mal(new Error('No se pudo leer la foto.')); im.src = URL.createObjectURL(file); });
  }
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  const k = Math.min(1, FOTO_LADO / Math.max(w0, h0));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  if (img.close) img.close();
  let q = FOTO_CALIDAD, blob;
  for (;;) {
    blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', q));
    if (!blob) throw new Error('No se pudo procesar la foto.');
    if (blob.size <= FOTO_MAX_BYTES || q <= 0.4) break;
    q = Math.round((q - 0.1) * 10) / 10;
  }
  return blob;
}
async function subirFoto(fallaId, blob) {
  const ruta = `${fallaId}/${(crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2))}.jpg`;
  const token = await tokenVigente();
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/storage/v1/object/fotos-reparacion/${ruta}`, {
      method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body: blob,
    });
  } catch (e) { throw new Error('Sin conexión al subir la foto. Intenta de nuevo.'); }
  if (!res.ok) throw new Error('No se pudo subir la foto (' + res.status + ').');
  await rpc('registrar_foto_falla', { p_falla_id: fallaId, p_ruta: ruta, p_bytes: blob.size });
}
async function urlFoto(ruta) {
  const r = await api(`/storage/v1/object/sign/fotos-reparacion/${ruta}`, { method: 'POST', body: { expiresIn: 3600 } });
  return r && r.signedURL ? SUPABASE_URL + '/storage/v1' + r.signedURL : null;
}

/* Borrador de la reparación: si Android cierra la app mientras se usa la cámara, el formulario se recupera solo */
function idbAbrir() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('fm_borrador', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('b');
    r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
  });
}
async function bdGet(k) {
  try { const d = await idbAbrir(); return await new Promise((ok, mal) => { const q = d.transaction('b').objectStore('b').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => mal(q.error); }); }
  catch (e) { return null; }
}
async function bdSet(k, v) {
  try { const d = await idbAbrir(); await new Promise((ok, mal) => { const t = d.transaction('b', 'readwrite'); t.objectStore('b').put(v, k); t.oncomplete = ok; t.onerror = () => mal(t.error); }); }
  catch (e) { /* sin borrador */ }
}
async function bdDel(k) {
  try { const d = await idbAbrir(); await new Promise((ok, mal) => { const t = d.transaction('b', 'readwrite'); t.objectStore('b').delete(k); t.oncomplete = ok; t.onerror = () => mal(t.error); }); }
  catch (e) { /* */ }
}
async function restaurarBorrador() {
  const b = await bdGet('cierre');
  if (!b) return;
  const f = S.features.find((x) => x.properties.id === b.id);
  if (Date.now() - b.ts > 2 * 3600e3 || !f || f.properties.estado === 'reparada' || !puedeCerrar()) { bdDel('cierre'); return; }
  formCierre(f.properties, b);
  toast('Recuperamos la reparación que estabas haciendo', 'ok');
}

// Cámara dentro de la app (así Android no la deja en segundo plano). Devuelve la foto, null si se cancela
// o undefined si la cámara no está disponible (entonces se usa la cámara del sistema).
async function abrirCamara() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return undefined;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); }
  catch (e) { return undefined; }
  return new Promise((ok) => {
    const ov = document.createElement('div');
    ov.id = 'camOv';
    ov.innerHTML = '<video playsinline muted autoplay></video><div class="cam-barra"><button type="button" id="camCancel">Cancelar</button><button type="button" id="camShot" aria-label="Capturar"></button><span></span></div>';
    document.body.appendChild(ov);
    const v = ov.querySelector('video'); v.srcObject = stream;
    const fin = (r) => { stream.getTracks().forEach((t) => t.stop()); ov.remove(); ok(r); };
    ov.querySelector('#camCancel').onclick = () => fin(null);
    ov.querySelector('#camShot').onclick = () => {
      if (!v.videoWidth) return;
      const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
      cv.getContext('2d').drawImage(v, 0, 0);
      cv.toBlob((b) => fin(b || null), 'image/jpeg', 0.92);
    };
  });
}

// Visor a pantalla completa: se abre al tocar una miniatura
function abrirFotoGrande(urls, i) {
  cerrarFotoGrande();
  let k = i || 0;
  const lb = document.createElement('div');
  lb.id = 'lbFoto';
  lb.innerHTML = `<button class="lb-x" aria-label="Cerrar">✕</button><img alt="Foto de la reparación">
    <div class="lb-barra"><button id="lbAnt" aria-label="Anterior">‹</button><span id="lbPos"></span><button id="lbSig" aria-label="Siguiente">›</button></div>
    <button class="lb-cerrar" aria-label="Cerrar">Cerrar</button>`;
  document.body.appendChild(lb);
  const pintar = () => {
    lb.querySelector('img').src = urls[k];
    lb.querySelector('#lbPos').textContent = `${k + 1} / ${urls.length}`;
    lb.querySelector('#lbAnt').style.visibility = lb.querySelector('#lbSig').style.visibility = urls.length > 1 ? 'visible' : 'hidden';
  };
  lb.querySelector('#lbAnt').onclick = (e) => { e.stopPropagation(); k = (k - 1 + urls.length) % urls.length; pintar(); };
  lb.querySelector('#lbSig').onclick = (e) => { e.stopPropagation(); k = (k + 1) % urls.length; pintar(); };
  lb.querySelector('.lb-x').onclick = cerrarFotoGrande;
  lb.querySelector('.lb-cerrar').onclick = cerrarFotoGrande;
  lb.onclick = (e) => { if (e.target === lb) cerrarFotoGrande(); };
  // El botón "atrás" del teléfono también cierra el visor
  try { history.pushState({ lbFoto: 1 }, ''); lb._hist = true; } catch (e) { /* */ }
  pintar();
}
function cerrarFotoGrande() {
  const lb = document.getElementById('lbFoto');
  if (!lb) return;
  lb.remove();
  if (lb._hist && history.state && history.state.lbFoto) { lbVolviendo = true; try { history.back(); } catch (e) { lbVolviendo = false; } }
}
// El "atrás" del visor no debe cerrar también la ficha que hay debajo (esa también usa el historial)
let lbVolviendo = false;
window.addEventListener('popstate', (e) => {
  const lb = document.getElementById('lbFoto');
  if (lbVolviendo) { lbVolviendo = false; e.stopImmediatePropagation(); return; }
  if (lb) { lb._hist = false; lb.remove(); e.stopImmediatePropagation(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarFotoGrande(); });

/* ------------------------------ estado ------------------------------ */
const S = {
  modo: { tipo: 'agregar', fecha: null, inspId: null },
  perfil: null,
  features: [],       // fallas_geojson (todas las que devuelve la base)
  activas: [],        // no reparadas
  pos: null,          // {lat, lng, prec}
  watchId: null,
  centrarAlFijar: false,
  vista: 'mapa',
  filtro: 'todas',
  estadosOff: {},
  busqueda: '',
  instalar: null,
};
const rol = () => (S.perfil ? S.perfil.rol : null);
const rolVisible = () => (rol() === 'contratista2' || rol() === 'contratista3' ? 'contratista' : rol());
const puedeReportar = () => PUEDE_REPORTAR.includes(rol());
const puedeAsignar = () => PUEDE_ASIGNAR.includes(rol());
const puedeCerrar = () => PUEDE_CERRAR.includes(rol());

function ocupar(btn, fn) {
  return async (ev) => {
    if (btn.disabled) return;
    btn.disabled = true;
    const txt = btn.textContent;
    try { await fn(ev); } catch (e) { if (e.name === 'SesionExpirada') { salir(e.message); } else { toast(e.message || 'Ocurrió un error', 'error'); } }
    finally { if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = txt; } }
  };
}

/* ------------------------- hoja inferior ------------------------- */
let hojaAbierta = false, hojaVolviendo = false;
function abrirHoja(html) {
  $('#hojaContenido').innerHTML = html;
  $('#hoja').classList.remove('hoja-menu');
  $('#hoja').hidden = false;
  $('#velo').hidden = false;
  $('#hoja').scrollTop = 0;
  if (!hojaAbierta) { hojaAbierta = true; try { history.pushState({ hoja: 1 }, ''); } catch (e) { /* */ } }
  return $('#hojaContenido');
}
function cerrarHoja(desdePop) {
  if (!hojaAbierta) return;
  hojaAbierta = false;
  $('#hoja').hidden = true;
  $('#velo').hidden = true;
  $('#hojaContenido').innerHTML = '';
  if (S.borradorId) { S.borradorId = null; bdDel('cierre'); }
  if (!desdePop && history.state && history.state.hoja) { hojaVolviendo = true; try { history.back(); } catch (e) { hojaVolviendo = false; } }
}
window.addEventListener('popstate', () => { if (hojaVolviendo) { hojaVolviendo = false; return; } if (hojaAbierta) { cerrarHoja(true); return; } if (window._usrPop) window._usrPop(); });
$('#velo').addEventListener('click', () => cerrarHoja());
$('#hojaCerrar').addEventListener('click', () => cerrarHoja());

/* ----------------------------- login ----------------------------- */
function mostrarLogin(msg) {
  $('#pantallaApp').hidden = true;
  $('#pantallaLogin').hidden = false;
  const e = $('#loginError');
  e.hidden = !msg;
  e.textContent = msg || '';
}
$('#formLogin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true; btn.textContent = 'Entrando…';
  $('#loginError').hidden = true;
  try {
    await iniciarSesion($('#loginEmail').value.trim(), $('#loginPass').value);
    $('#loginPass').value = '';
    await entrarApp();
  } catch (e) {
    mostrarLogin(e.message);
  } finally { btn.disabled = false; btn.textContent = 'Entrar'; }
});
$('#loginOlvido').addEventListener('click', async () => {
  const email = $('#loginEmail').value.trim();
  if (!email) { mostrarLogin('Escribe tu correo arriba y vuelve a tocar "Olvidé mi contraseña".'); return; }
  try {
    const { res } = await authPost('/auth/v1/recover', { email });
    mostrarLogin(res.ok ? 'Si el correo está registrado, recibirás un mensaje para crear una nueva contraseña.' : 'No se pudo enviar el correo. Intenta más tarde.');
  } catch (e) { mostrarLogin(e.message); }
});
function salir(msg) {
  guardarSesion(null);
  try { localStorage.removeItem(LS_PERFIL); localStorage.removeItem(LS_MODO); } catch (e) { /* */ }
  S.modo = { tipo: 'agregar', fecha: null, inspId: null };
  detenerGPS();
  clearInterval(S.timer);
  cerrarHoja();
  S.perfil = null; S.features = []; S.activas = [];
  mostrarLogin(msg);
}

async function cargarPerfil() {
  try {
    const f = await select('usuarios', `id=eq.${sesion.user_id}&select=id,nombre,rol,foto_obligatoria`);
    if (!f || !f.length) { guardarSesion(null); throw new Error('Tu cuenta no tiene un perfil asignado en el sistema. Consulta con el administrador.'); }
    S.perfil = f[0];
    try { localStorage.setItem(LS_PERFIL, JSON.stringify(S.perfil)); } catch (e) { /* */ }
  } catch (e) {
    if (e.name === 'SesionExpirada') throw e;
    // Sin señal al abrir: se usa el último perfil guardado
    let p = null;
    try { p = JSON.parse(localStorage.getItem(LS_PERFIL)); } catch (e2) { /* */ }
    if (p && p.id === sesion.user_id) S.perfil = p; else throw e;
  }
}

/* ------------------------------ mapa ------------------------------ */
let map, rend, rendSvg, capaCircuitos, capaPuntos, capaFallas, capaEmpalmes, marcadorPos, circuloPos;
let cacheBbox = null, cacheEmp = null;

/* ---------------- símbolo del punto según el tipo de poste (igual que en el escritorio) ---------------- */
// Dibuja la forma centrada en (x,y) con "radio" r en un canvas 2D.
function trazarForma(ctx, forma, x, y, r) {
  ctx.beginPath();
  const poli = (pts) => { pts.forEach(([a, b], i) => (i ? ctx.lineTo(x + a * r, y + b * r) : ctx.moveTo(x + a * r, y + b * r))); ctx.closePath(); };
  switch (forma) {
    case 'HORMIGON': poli([[-.9, -.9], [.9, -.9], [.9, .9], [-.9, .9]]); break;                                  // cuadrado
    case 'ACERO': poli([[0, -1.05], [1.05, .85], [-1.05, .85]]); break;                                            // triángulo
    case 'MONOPOSTE': poli([[0, -1.1], [.95, -.55], [.95, .55], [0, 1.1], [-.95, .55], [-.95, -.55]]); break;      // hexágono
    case 'ORNAMENTAL': poli([[0, -1.05], [1, -.32], [.62, .85], [-.62, .85], [-1, -.32]]); break;                 // pentágono
    case 'EMPALME': poli([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? .65 : 1.2; return [Math.cos(a) * k, Math.sin(a) * k]; })); break; // estrella (gorda: asoma como halo bajo el poste)
    case 'FACHADA': ctx.arc(x, y + r * .45, r * 1.05, Math.PI, 0); ctx.closePath(); break;                        // semicírculo
    default: ctx.arc(x, y, r, 0, Math.PI * 2);                                                                     // círculo
  }
}
const formaPoste = (simb) => String(simb || '').toUpperCase().trim();
let MarcadorForma = null;
function definirMarcadorForma() {
  if (MarcadorForma) return;
  MarcadorForma = L.CircleMarker.extend({
    options: { forma: '' },
    _updatePath() { this._renderer._updateForma(this); },
  });
  L.Canvas.include({
    _updateForma(layer) {
      if (!this._drawing || layer._empty()) return;
      const p = layer._point, r = Math.max(Math.round(layer._radius), 1);
      trazarForma(this._ctx, layer.options.forma, p.x, p.y, r);
      this._fillStroke(this._ctx, layer);
    },
  });
}

// Contorno aproximado de la comuna de La Florida (unión de las 7 zonas de inspección) ampliado 60 m hacia afuera para no ocultar
// puntos que quedan justo en el borde (los más alejados están a 28 m), [lon, lat].
const COMUNA_CONTORNO = [[-70.61562,-33.54644],[-70.61561,-33.54617],[-70.61545,-33.54593],[-70.61518,-33.54579],[-70.61485,-33.54578],[-70.61347,-33.54603],[-70.61167,-33.54608],[-70.61158,-33.54605],[-70.61151,-33.54597],[-70.61146,-33.54576],[-70.61142,-33.53893],[-70.61089,-33.53717],[-70.61061,-33.52621],[-70.611,-33.52173],[-70.61131,-33.52065],[-70.61246,-33.51077],[-70.6126,-33.51051],[-70.61438,-33.5087],[-70.61452,-33.50831],[-70.6145,-33.50812],[-70.61439,-33.50786],[-70.61414,-33.50768],[-70.61381,-33.50763],[-70.58318,-33.50965],[-70.56586,-33.51108],[-70.56575,-33.51107],[-70.56537,-33.51093],[-70.56509,-33.51088],[-70.56276,-33.51094],[-70.5605,-33.51113],[-70.54187,-33.51171],[-70.54153,-33.5118],[-70.5413,-33.51203],[-70.54103,-33.51255],[-70.54091,-33.51258],[-70.53861,-33.51246],[-70.53493,-33.51097],[-70.53221,-33.51016],[-70.52954,-33.50965],[-70.52745,-33.50858],[-70.52714,-33.5085],[-70.52366,-33.50838],[-70.52035,-33.50714],[-70.52005,-33.50709],[-70.51976,-33.50717],[-70.51954,-33.50734],[-70.51945,-33.50759],[-70.51917,-33.5104],[-70.51921,-33.51064],[-70.51996,-33.5122],[-70.51987,-33.51568],[-70.51995,-33.51594],[-70.52201,-33.5192],[-70.52361,-33.52115],[-70.52376,-33.52129],[-70.52604,-33.52267],[-70.52649,-33.52277],[-70.53144,-33.52235],[-70.53542,-33.52128],[-70.53554,-33.5213],[-70.5371,-33.52194],[-70.53745,-33.522],[-70.54258,-33.52158],[-70.54271,-33.52162],[-70.54276,-33.52168],[-70.54342,-33.52557],[-70.54338,-33.52568],[-70.54326,-33.52577],[-70.54176,-33.52604],[-70.54148,-33.52616],[-70.5413,-33.52638],[-70.54126,-33.52664],[-70.54159,-33.52876],[-70.54155,-33.52893],[-70.54136,-33.52916],[-70.54125,-33.52951],[-70.54154,-33.53251],[-70.54149,-33.53276],[-70.54139,-33.53284],[-70.54069,-33.53275],[-70.53548,-33.53315],[-70.53522,-33.53322],[-70.53502,-33.53337],[-70.53391,-33.53463],[-70.53379,-33.53487],[-70.53382,-33.53512],[-70.53398,-33.53534],[-70.53465,-33.53587],[-70.5349,-33.53599],[-70.53564,-33.53619],[-70.53714,-33.53698],[-70.5374,-33.53706],[-70.53912,-33.53725],[-70.53918,-33.5373],[-70.53934,-33.53757],[-70.5395,-33.53774],[-70.54055,-33.53848],[-70.5412,-33.5393],[-70.5416,-33.5402],[-70.54192,-33.54049],[-70.54518,-33.54184],[-70.54542,-33.5419],[-70.54745,-33.54202],[-70.55119,-33.54245],[-70.5513,-33.5425],[-70.55137,-33.54257],[-70.55141,-33.54277],[-70.55066,-33.54548],[-70.55066,-33.54573],[-70.5508,-33.54596],[-70.55105,-33.5461],[-70.55135,-33.54614],[-70.55264,-33.54602],[-70.55708,-33.54465],[-70.55813,-33.54452],[-70.56626,-33.5442],[-70.56855,-33.54416],[-70.56867,-33.54419],[-70.56874,-33.54426],[-70.56878,-33.54434],[-70.56876,-33.54455],[-70.56751,-33.5473],[-70.55682,-33.56037],[-70.55671,-33.56061],[-70.55675,-33.56087],[-70.55693,-33.56108],[-70.55721,-33.5612],[-70.58338,-33.56594],[-70.58353,-33.56603],[-70.58359,-33.5662],[-70.58314,-33.56889],[-70.58318,-33.56916],[-70.58338,-33.56938],[-70.58368,-33.56949],[-70.5922,-33.57062],[-70.59261,-33.57056],[-70.59873,-33.56782],[-70.59892,-33.56779],[-70.60003,-33.56789],[-70.6013,-33.56831],[-70.61134,-33.57095],[-70.61171,-33.57096],[-70.61203,-33.57078],[-70.61217,-33.5705],[-70.6132,-33.56223],[-70.61315,-33.56195],[-70.61295,-33.56174],[-70.61264,-33.56164],[-70.61161,-33.56152],[-70.61149,-33.56149],[-70.61143,-33.56141],[-70.6114,-33.56115]];

function iniciarMapa() {
  definirMarcadorForma();
  if (map) { map.invalidateSize(); return; }
  map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 20 }).setView([-33.52, -70.58], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  rend = L.canvas({ padding: 0.5, tolerance: 12 });
  rendSvg = L.svg({ padding: 0.5 });
  capaCircuitos = L.geoJSON(null, { renderer: rend });
  capaPuntos = L.geoJSON(null, { renderer: rend });
  capaFallas = L.geoJSON(null, { renderer: rend });
  capaEmpalmes = L.geoJSON(null, { renderer: rend });
  map.on('moveend', cargarArea);
  map.on('zoomend', () => { ajustarRadios(); dibujarFallas(); });
  map.on('click', () => { /* un toque en el vacío no hace nada */ });
  // Atenuar lo que queda fuera de la comuna (botón en el mapa, se recuerda la elección). No bloquea toques.
  // El círculo de precisión del GPS va BAJO las fallas: encima teñía de azul los puntos morados/rojos
  map.createPane('precisionPane');
  map.getPane('precisionPane').style.zIndex = 300;
  map.getPane('precisionPane').style.pointerEvents = 'none';
  map.createPane('atenuadoPane');
  map.getPane('atenuadoPane').style.zIndex = 250;             // sobre el fondo, bajo líneas y puntos
  map.getPane('atenuadoPane').style.pointerEvents = 'none';
  const contornoLL = COMUNA_CONTORNO.map((c) => [c[1], c[0]]);
  const capaAtenuado = L.layerGroup([
    L.polygon([[[-85, -180], [-85, 180], [85, 180], [85, -180]], contornoLL],
      { pane: 'atenuadoPane', interactive: false, stroke: false, fillColor: '#f4f6f3', fillOpacity: 0.85 }),
    L.polyline(contornoLL.concat([contornoLL[0]]),
      { pane: 'atenuadoPane', interactive: false, color: '#1f4d3d', weight: 2.5, opacity: 0.85 }),
  ]);
  let atenuar = true;
  try { if (localStorage.getItem('fa_atenuar_comuna') === '0') atenuar = false; } catch (e) { /* */ }
  const aplicarAtenuado = () => {
    if (atenuar) capaAtenuado.addTo(map); else map.removeLayer(capaAtenuado);
    const b = $('#btnComuna');
    b.classList.toggle('activo', atenuar);
    b.setAttribute('aria-pressed', atenuar ? 'true' : 'false');
    b.title = atenuar ? 'Mostrar también fuera de la comuna' : 'Atenuar fuera de la comuna';
  };
  $('#btnComuna').addEventListener('click', () => {
    atenuar = !atenuar;
    try { localStorage.setItem('fa_atenuar_comuna', atenuar ? '1' : '0'); } catch (e) { /* */ }
    aplicarAtenuado();
  });
  aplicarAtenuado();
}
const radioPunto = () => { const z = map.getZoom(); return z >= 19 ? 11 : z >= 18 ? 9 : 7; };
function ajustarRadios() { const r = radioPunto(); capaPuntos.eachLayer((l) => l.setRadius && l.setRadius(r)); }

function expandir(b, f) {
  const dx = (b[2] - b[0]) * f, dy = (b[3] - b[1]) * f;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
}
const contenido = (c, b) => c && b[0] >= c[0] && b[1] >= c[1] && b[2] <= c[2] && b[3] <= c[3];

// Reintenta una vez una consulta de capa (red móvil inestable)
const rpcReint = async (fn, args) => { try { return await rpc(fn, args); } catch (e) { if (e.name === 'SesionExpirada') throw e; await new Promise((r) => setTimeout(r, 600)); return rpc(fn, args); } };
let _areaSeq = 0;
async function cargarArea(forzar) {
  if (!map) return true;
  const z = map.getZoom();
  const visible = z >= ZOOM_DATOS;
  $('#zoomAviso').hidden = visible || S.vista !== 'mapa';
  [capaCircuitos, capaPuntos].forEach((c) => {
    if (visible && !map.hasLayer(c)) c.addTo(map);
    if (!visible && map.hasLayer(c)) map.removeLayer(c);
  });
  if (!map.hasLayer(capaFallas)) capaFallas.addTo(map);
  capaFallas.bringToFront && capaFallas.bringToFront();
  if (!visible) return;
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  let ok = true;
  const pEmp = z >= ZOOM_EMPALMES ? cargarEmpalmes(bbox, forzar === true) : (map.hasLayer(capaEmpalmes) && map.removeLayer(capaEmpalmes), true);
  if (forzar !== true && contenido(cacheBbox, bbox)) return pEmp;
  const grande = expandir(bbox, 0.4);
  const seq = ++_areaSeq;
  try {
    const args = { min_lon: grande[0], min_lat: grande[1], max_lon: grande[2], max_lat: grande[3] };
    // Cada capa por separado: si una falla, la otra igual se dibuja
    const [rc, rp] = await Promise.allSettled([rpcReint('circuitos_en_area', args), rpcReint('puntos_en_area', args)]);
    if (seq !== _areaSeq) return true;   // llegó otra carga más nueva
    [rc, rp].forEach((r) => { if (r.status === 'rejected' && r.reason && r.reason.name === 'SesionExpirada') throw r.reason; });
    const circ = rc.status === 'fulfilled' ? rc.value : null, pts = rp.status === 'fulfilled' ? rp.value : null;
    if (rc.status === 'fulfilled') capaCircuitos.clearLayers();
    if (rp.status === 'fulfilled') capaPuntos.clearLayers();
    if (rc.status === 'rejected' || rp.status === 'rejected') { ok = false; cacheBbox = null; if (forzar === true) toast('Algunas capas no cargaron. Toca actualizar de nuevo.', 'error'); }
    if (circ) {
      L.geoJSON(circ, {
        renderer: rend,
        style: { color: '#2563a8', weight: 4, opacity: 0.75 },
        onEachFeature: (f, l) => l.on('click', (e) => { L.DomEvent.stopPropagation(e); abrirCircuito(f.properties); }),
      }).eachLayer((l) => capaCircuitos.addLayer(l));
    }
    if (pts) {
      L.geoJSON(pts, {
        pointToLayer: (f, ll) => new MarcadorForma(ll, { renderer: rend, forma: formaPoste(f.properties.simb_poste), radius: radioPunto(), weight: 2, color: '#1f4d3d', fillColor: '#ffd54a', fillOpacity: 0.9 }),
        onEachFeature: (f, l) => l.on('click', (e) => { L.DomEvent.stopPropagation(e); abrirPunto(f.properties, f.geometry); }),
      }).eachLayer((l) => capaPuntos.addLayer(l));
    }
    if (ok) cacheBbox = grande;
    capaFallas.bringToFront && capaFallas.bringToFront();
  } catch (e) {
    if (e.name === 'SesionExpirada') salir(e.message); else toast(e.message, 'error');
    return false;
  }
  return (await pEmp) && ok;
}

// Empalmes (medidores): estrella roja bajo los puntos, solo con mucho zoom; al tocarla muestra medidor y cliente.
async function cargarEmpalmes(bbox, forzar) {
  if (!map.hasLayer(capaEmpalmes)) capaEmpalmes.addTo(map);
  if (!forzar && contenido(cacheEmp, bbox)) return true;
  const grande = expandir(bbox, 0.4);
  try {
    const emp = await rpcReint('empalmes_en_area', { min_lon: grande[0], min_lat: grande[1], max_lon: grande[2], max_lat: grande[3] });
    capaEmpalmes.clearLayers();
    if (emp) {
      L.geoJSON(emp, {
        pointToLayer: (f, ll) => new MarcadorForma(ll, { renderer: rend, forma: 'EMPALME', radius: 20, weight: 1, color: '#7a232f', fillColor: '#b23a48', fillOpacity: 1 }),
        onEachFeature: (f, l) => l.on('click', (e) => { L.DomEvent.stopPropagation(e); abrirEmpalme(f.properties); }),
      }).eachLayer((l) => capaEmpalmes.addLayer(l));
    }
    capaEmpalmes.eachLayer((l) => l.bringToBack && l.bringToBack());
    cacheEmp = grande;
    return true;
  } catch (e) {
    cacheEmp = null;
    if (e.name === 'SesionExpirada') salir(e.message); else if (forzar) toast(e.message, 'error');
    return false;
  }
}
function abrirEmpalme(p) {
  abrirHoja(`
    <h2>Empalme</h2>
    <dl class="kv">
      <dt>N.° de medidor</dt><dd>${esc(p.n_empalmes ?? '—')}</dd>
      <dt>Cliente</dt><dd>${esc(p.cliente_1 ?? '—')}</dd>
    </dl>
    ${infoSoloLectura()}`);
}

/* Filtros "Asignación" (admin, contratista y contratista2) y "Subcontrato": afectan a la lista y al mapa.
   No se guardan: se reinician al abrir la app. Los contadores muestran el estado actual de la comuna,
   sin importar los filtros puestos. */
try { localStorage.removeItem('fa_sin_asignar'); localStorage.removeItem('fa_solo_masivo'); } catch (e) { /* */ }
const puedeFiltrarSinAsignar = () => ['admin', 'contratista', 'contratista2', 'contratista3'].includes(rol());
const FO = { asig: 'todas', sub: 'todas' };   // asig: todas | sin | asignadas · sub: todas | masivo | normal
const asigActiva = () => (puedeFiltrarSinAsignar() ? FO.asig : 'todas');
const cuentaFiltrosOtros = () => (asigActiva() !== 'todas' ? 1 : 0) + (FO.sub !== 'todas' ? 1 : 0);
function pasaFiltrosOtros(masivo, asignadoId) {
  const a = asigActiva();
  if (a === 'sin' && asignadoId) return false;
  if (a === 'asignadas' && !asignadoId) return false;
  if (FO.sub === 'masivo' && !masivo) return false;
  if (FO.sub === 'normal' && masivo) return false;
  return true;
}
function actualizarFiltrosOtrosUI() {
  const grupo = $('#listaAsigGrupo'); if (!grupo) return;
  grupo.hidden = !puedeFiltrarSinAsignar();
  const base = S.activas.filter((f) => !f.properties.cascada);
  const nSin = base.filter((f) => !f.properties.asignado_camion_id).length;
  const nMas = base.filter((f) => f.properties.masivo).length;
  const poner = (id, n) => { $(id).textContent = '(' + n + ')'; };
  poner('#listaSinAsignarN', nSin); poner('#listaAsignadasN', base.length - nSin);
  poner('#listaMasivoN', nMas); poner('#listaNormalN', base.length - nMas);
  $$('#listaAsig .fchip').forEach((c) => c.classList.toggle('on', c.dataset.asig === FO.asig));
  $$('#listaSub .fchip').forEach((c) => c.classList.toggle('on', c.dataset.sub === FO.sub));
  // Aviso sobre el mapa mientras haya filtros de Asignación o Subcontrato puestos
  const partes = [];
  if (asigActiva() === 'sin') partes.push('sin asignar'); else if (asigActiva() === 'asignadas') partes.push('asignadas');
  if (FO.sub === 'masivo') partes.push('masivo'); else if (FO.sub === 'normal') partes.push('normal');
  const b = $('#badgeSinAsignar');
  b.hidden = !partes.length;
  b.textContent = 'Solo ' + partes.join(' · ') + ' ✕';
}
function ordenLista() { try { return localStorage.getItem('fm_orden_lista') === 'recientes' ? 'recientes' : 'cerca'; } catch (e) { return 'cerca'; } }
// Si el teléfono tiene un index.html antiguo en caché, el selector se crea aquí (así la lista nunca se rompe).
function asegurarOrdenUI() {
  if ($('#listaOrdenGrupo')) return;
  const g = document.createElement('div');
  g.id = 'listaOrdenGrupo'; g.hidden = true;
  g.innerHTML = '<div class="lf-t">Ordenar por</div><div class="lf-chips" id="listaOrden">'
    + '<button type="button" class="fchip fchip-sel on" data-orden="cerca">Cercanía</button>'
    + '<button type="button" class="fchip fchip-sel" data-orden="recientes">Más recientes</button></div>';
  const panel = $('#filtrosListaPanel');
  panel.insertBefore(g, panel.querySelector('.lf-t'));
}
document.addEventListener('click', (e) => {
  const c = e.target.closest && e.target.closest('#listaOrden .fchip');
  if (!c) return;
  try { localStorage.setItem('fm_orden_lista', c.dataset.orden); } catch (err) { /* sin almacenamiento */ }
  renderLista();
});
function fijarFiltroOtros(k, v) {
  FO[k] = v;
  actualizarFiltrosOtrosUI(); dibujarFallas(); if (S.vista === 'lista') renderLista();
}
const htmlBotonMasivo = () => '<button type="button" class="btn-masivo" id="fMasivo" aria-pressed="false">Masivo</button>';
function activarBotonMasivo(h) {
  const b = $('#fMasivo', h);
  b.addEventListener('click', () => { b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false'); });
}
const leerMasivo = (h) => !!$('#fMasivo.on', h);

function dibujarFallas() {
  if (!map || !capaFallas) return;
  const z = map.getZoom();
  capaFallas.clearLayers();
  const asigF = asigActiva(), subF = FO.sub;
  // Una falla reparada (verde, visible unas horas) no se dibuja si ese punto/circuito ya tiene una falla activa nueva
  // (reiterada, reportada...): si no, el verde semitransparente tapa el morado y se ve azulado.
  const activasEn = new Set();
  S.features.forEach((f) => {
    const q = f.properties;
    if (q.estado === 'reparada') return;
    if (q.ref_punto_gid != null) activasEn.add('p' + q.ref_punto_gid);
    if (q.ref_circuito_gid != null && !q.cascada) activasEn.add('c' + q.ref_circuito_gid);
  });
  S.features.forEach((f) => {
    const p = f.properties;
    if (p.estado === 'reparada' && ((p.ref_punto_gid != null && activasEn.has('p' + p.ref_punto_gid)) || (p.ref_circuito_gid != null && !p.cascada && activasEn.has('c' + p.ref_circuito_gid)))) return;
    // Subcontrato: los puntos de cascada se ocultan (manda el circuito); las reparadas recientes se siguen viendo
    if (subF !== 'todas') { if (p.cascada) return; if (subF === 'masivo' ? !p.masivo : !!p.masivo) return; }
    // Asignación: solo fallas activas (los puntos de cascada se ocultan; manda el circuito)
    if (asigF !== 'todas') { if (p.estado === 'reparada' || p.cascada) return; if (asigF === 'sin' ? p.asignado_camion_id : !p.asignado_camion_id) return; }
    if (S.estadosOff[p.estado]) return;
    const reparada = p.estado === 'reparada';
    if (p.cascada && z < ZOOM_DATOS) return;
    const color = COLOR_ESTADO[p.estado] || '#d33a2c';
    let capa;
    if (f.geometry.type === 'Point') {
      const [lng, lat] = f.geometry.coordinates;
      const r = p.cascada ? (z >= 18 ? 7 : 5) : (z >= 18 ? 13 : z >= 16 ? 11 : 8);
      capa = new MarcadorForma([lat, lng], { renderer: rend, forma: formaPoste(p.simb_poste), radius: r, weight: 3, color: '#fff', fillColor: color, fillOpacity: reparada ? 0.55 : 0.95, interactive: true });
    } else {
      if (p.estado === 'reportada' || p.estado === 'reiterada') {
        // Circuito reportado o reiterado: parpadea (como en el escritorio). El parpadeo es CSS sobre SVG;
        // debajo va una línea ancha invisible para que sea fácil tocarla con el dedo.
        const base = L.geoJSON(f.geometry, { renderer: rendSvg, style: { color, weight: 7, opacity: 0.9, className: 'falla-reportada' }, interactive: false });
        capaFallas.addLayer(base);
        capa = L.geoJSON(f.geometry, { renderer: rendSvg, style: { color: '#000', weight: 20, opacity: 0, className: 'falla-toque' }, interactive: true });
      } else {
        capa = L.geoJSON(f.geometry, { renderer: rend, style: { color, weight: 7, opacity: reparada ? 0.45 : 0.9 }, interactive: true });
      }
    }
    capa.on('click', (e) => { L.DomEvent.stopPropagation(e); abrirFalla(p, f.geometry); });
    capaFallas.addLayer(capa);
  });
}

/* ------------------------------ GPS ------------------------------ */
function iniciarGPS() {
  if (!navigator.geolocation) { toast('Este dispositivo no tiene GPS disponible.', 'error'); return; }
  if (S.watchId != null) return;
  // Si el permiso ya fue bloqueado no se insiste: se avisa una vez con instrucciones.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then((st) => {
      if (st.state === 'denied') { toast('La ubicación está bloqueada. Actívala en los permisos del sitio (candado junto a la dirección) y recarga.', 'error'); return; }
      comenzarGPS();
    }).catch(() => comenzarGPS());
    return;
  }
  comenzarGPS();
}
function comenzarGPS() {
  if (S.watchId != null) return;
  S.watchId = navigator.geolocation.watchPosition(onPos, onPosError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 });
}
function detenerGPS() {
  if (S.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(S.watchId);
  S.watchId = null; S.pos = null;
  if (map) { [marcadorPos, circuloPos].forEach((l) => l && map.removeLayer(l)); }
  marcadorPos = circuloPos = null;
  $('#btnUbicacion').classList.remove('activo');
}
function onPos(p) {
  S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, prec: p.coords.accuracy };
  $('#btnUbicacion').classList.add('activo');
  if (map) {
    const ll = [S.pos.lat, S.pos.lng];
    if (!marcadorPos) {
      circuloPos = L.circle(ll, { radius: S.pos.prec, weight: 1, color: '#2563a8', fillColor: '#2563a8', fillOpacity: 0.12, interactive: false, pane: 'precisionPane' }).addTo(map);
      marcadorPos = L.circleMarker(ll, { radius: 9, weight: 3, color: '#fff', fillColor: '#2563a8', fillOpacity: 1, interactive: false, className: 'punto-ubicacion' }).addTo(map);
    } else {
      marcadorPos.setLatLng(ll); circuloPos.setLatLng(ll); circuloPos.setRadius(S.pos.prec);
    }
    if (S.centrarAlFijar) { map.setView(ll, Math.max(map.getZoom(), 18)); S.centrarAlFijar = false; }
  }
  if (S.vista === 'lista') renderLista();
}
function onPosError(e) {
  S.centrarAlFijar = false;
  if (e.code === 1) { toast('Permiso de ubicación denegado. Actívalo en la configuración del navegador.', 'error'); S.watchId = null; }
  else toast('No se pudo obtener tu ubicación. ¿GPS activado?', 'error');
}
$('#btnUbicacion').addEventListener('click', () => {
  if (S.pos && map) { map.setView([S.pos.lat, S.pos.lng], Math.max(map.getZoom(), 18)); return; }
  S.centrarAlFijar = true;
  toast('Buscando tu ubicación…');
  iniciarGPS();
});

/* ------------------------- datos de fallas ------------------------- */
const CONTR = {};   // id -> {nombre, masivo} para la etiqueta de contrato en la lista
async function cargarContratosEtiqueta() {
  try { (await select('contratos', 'select=id,nombre,defecto_para')).forEach((c) => { CONTR[c.id] = { nombre: c.nombre, masivo: c.defecto_para === 'masivo' }; }); if (S.vista === 'lista') renderLista(); } catch (e) { /* sin etiqueta */ }
}
const tagContrato = (id) => (id && CONTR[id] ? ` <span class="tag-ctr ${CONTR[id].masivo ? 'm' : 'n'}">${esc(CONTR[id].nombre)}</span>` : '');

/* ---------- Suministro eléctrico (Enel): indicador + transformadores sin suministro ----------
   Lee las tablas suministro_enel / suministro_trafos, que llena el servidor cada 10 min
   (sql/2026-10-suministro-enel.sql). Si las tablas no existen o no hay dato, no se muestra nada. */
let suminDato = null, suminTrafos = [], suminVer = true, suminLayer = null, suminCtl = null, suminAbierto = false;
const suminEsc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const suminNum = (n) => Number(n || 0).toLocaleString('es-CL');
function suminEstado(){
  if(!suminDato) return null;
  const min = (Date.now() - new Date(suminDato.actualizado_en).getTime()) / 60000;
  const pct = Number(suminDato.porcentaje || 0), n = Number(suminDato.clientes_afectados || 0);
  const viejo = min > 90;
  const nivel = viejo ? 'gris' : (pct <= 5 ? 'verde' : pct <= 10 ? 'ambar' : 'rojo');   // verde hasta 5%, amarillo hasta 10%, rojo sobre 10%
  return { nivel, n, pct, viejo, min };
}
function suminHora(iso){ try{ return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }); }catch(e){ return ''; } }
// Botón flotante del mapa: oculta o muestra las fallas de distribución (transformadores y avisos) en este teléfono
function suminVisibleAhora(){ return suminVer || (suminPuedeAvisos() && suminAvisosVer); }
function actualizarBotonDistrib(){
  const b = document.getElementById('btnDistrib'); if(!b) return;
  b.hidden = !suminDato;
  const on = suminVisibleAhora();
  b.classList.toggle('activo', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.title = on ? 'Ocultar fallas de distribución' : 'Mostrar fallas de distribución';
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest && ev.target.closest('#btnDistrib'); if(!b) return;
  const nuevo = !suminVisibleAhora();
  suminVer = nuevo; if(suminPuedeAvisos()) suminAvisosVer = nuevo;
  try{ localStorage.setItem('fa_sum_trafos', suminVer ? '1' : '0'); if(suminPuedeAvisos()) localStorage.setItem('fa_sum_avisos', suminAvisosVer ? '1' : '0'); }catch(e){}
  pintarTrafosSuministro(); pintarAvisosSuministro(); actualizarBotonDistrib();
  toast(nuevo ? 'Fallas de distribución visibles' : 'Fallas de distribución ocultas');
});
function pintarSuministro(){
  const est = suminEstado();
  actualizarBotonDistrib();
  if(!suminCtl) return;
  const cont = suminCtl.getContainer();
  if(!est){ cont.style.display = 'none'; if(suminLayer) suminLayer.clearLayers(); if(suminAvisosLayer) suminAvisosLayer.clearLayers(); return; }
  cont.style.display = '';
  const etq = est.n === 0 ? 'Clientes sin suministro: 0' : `Clientes sin suministro: ${suminNum(est.n)} · ${String(est.pct).replace('.', ',')}%`;
  const d = suminDato;
  cont.innerHTML = `<button type="button" class="sum-chip sum-${est.nivel}" aria-expanded="${suminAbierto}"><span class="sum-d"></span>⚡ ${suminEsc(etq)}${est.viejo ? ' · sin dato reciente' : ''}</button>
    <div class="sum-card" ${suminAbierto ? '' : 'hidden'}>
      <h4>⚡ Suministro eléctrico · ${suminEsc(d.comuna || 'La Florida')}</h4>
      <div class="sum-k"><span>Clientes sin suministro</span><b>${suminNum(est.n)}</b></div>
      <div class="sum-k"><span>Clientes de la comuna</span><span>${suminNum(d.clientes_total)}</span></div>
      <div class="sum-k"><span>Porcentaje afectado</span><b>${suminEsc(String(est.pct).replace('.', ','))}%</b></div>
      <div class="sum-k"><span>Transformadores sin suministro</span><b>${suminTrafos.length}</b></div>
      ${suminPuedeAvisos() ? `<div class="sum-k"><span>Avisos de clientes</span><b>${suminAvisos.length}</b></div>` : ''}
      <label class="sum-sw"><input type="checkbox" id="sumVer" ${suminVer ? 'checked' : ''}> Mostrar transformadores en el mapa</label>
      ${suminPuedeAvisos() ? `<label class="sum-sw"><input type="checkbox" id="sumAv" ${suminAvisosVer ? 'checked' : ''}> Mostrar avisos de clientes en el mapa</label>
      <button type="button" id="sumLista" class="sum-btn" ${suminAvisos.length ? '' : 'disabled'}>Ver listado de avisos (caso, cliente, dirección)</button>` : ''}
      <div class="sum-f">Fuente: Mapa de Emergencia de Enel · actualizado ${suminEsc(suminHora(d.actualizado_en))}${est.viejo ? ' (dato antiguo)' : ''}</div>
    </div>`;
  const chip = cont.querySelector('.sum-chip');
  chip.addEventListener('click', () => { suminAbierto = !suminAbierto; pintarSuministro(); });
  const sw = cont.querySelector('#sumVer');
  if(sw) sw.addEventListener('change', () => { suminVer = sw.checked; try{ localStorage.setItem('fa_sum_trafos', suminVer ? '1' : '0'); }catch(e){} pintarTrafosSuministro(); });
  const sa = cont.querySelector('#sumAv');
  if(sa) sa.addEventListener('change', () => { suminAvisosVer = sa.checked; try{ localStorage.setItem('fa_sum_avisos', suminAvisosVer ? '1' : '0'); }catch(e){} pintarAvisosSuministro(); });
  const sl = cont.querySelector('#sumLista');
  if(sl) sl.addEventListener('click', () => abrirListadoAvisos());
  pintarTrafosSuministro();
  pintarAvisosSuministro();
}

function suminAvisosAgrupados(){
  const g = new Map();
  suminAvisos.forEach((a) => { const k = a.lat.toFixed(6) + ',' + a.lon.toFixed(6); if(!g.has(k)) g.set(k, { lat: a.lat, lon: a.lon, items: [] }); g.get(k).items.push(a); });
  return [...g.values()];
}
function pintarAvisosSuministro(){
  if(!map) return;
  if(!suminAvisosLayer) suminAvisosLayer = L.layerGroup();
  suminAvisosLayer.clearLayers();
  if(!suminAvisosVer || !suminDato || !suminPuedeAvisos() || !suminAvisos.length){ if(map.hasLayer(suminAvisosLayer)) map.removeLayer(suminAvisosLayer); return; }
  suminAvisosAgrupados().forEach((g) => {
    const lista = g.items.map((a) => `<div style="margin-top:5px;border-top:1px solid #eee;padding-top:4px"><b>Caso ${suminEsc(a.incidencia || '—')}</b> · Aviso ${suminEsc(a.cod_aviso)}<br>Cliente N.° <b>${suminEsc(a.numero_cliente || '—')}</b><br>${suminEsc(a.direccion || '')}${a.reposicion ? '<br>Reposición est.: ' + suminEsc(a.reposicion) : ''}</div>`).join('');
    const mas = '';
    L.marker([g.lat, g.lon], { icon: L.divIcon({ className: '', iconSize: [19, 19], iconAnchor: [9.5, 9.5], html: '<div class="sum-ad"><i></i></div>' }) })
      .bindPopup(`<b>${g.items.length} aviso${g.items.length === 1 ? '' : 's'} de clientes</b><div style="max-height:190px;overflow-y:auto;padding-right:4px">${lista}</div>${mas}<div style="margin-top:5px"><small>Fuente: Enel</small></div>`).addTo(suminAvisosLayer);
  });
  if(!map.hasLayer(suminAvisosLayer)) suminAvisosLayer.addTo(map);
}
function suminTextoAvisos(){
  return ['Caso\tAviso\tN° cliente\tDirección\tReposición estimada']
    .concat(suminAvisos.map((a) => [a.incidencia, a.cod_aviso, a.numero_cliente, a.direccion, a.reposicion].map((v) => String(v ?? '').replace(/[\t\n]/g, ' ')).join('\t'))).join('\n');
}
async function suminCopiarAvisos(btn){
  const txt = suminTextoAvisos();
  try{ await navigator.clipboard.writeText(txt); if(btn){ const t = btn.textContent; btn.textContent = '✓ Copiado'; setTimeout(() => { btn.textContent = t; }, 1600); } }
  catch(e){ window.prompt('Copia el listado (Ctrl+C):', txt); }
}


function abrirListadoAvisos(){
  const filas = suminAvisos.map((a) => `<div class="sum-av"><b>Caso ${suminEsc(a.incidencia || '—')}</b> · Aviso ${suminEsc(a.cod_aviso)}<br>Cliente N.° <b>${suminEsc(a.numero_cliente || '—')}</b><br>${suminEsc(a.direccion || '')}${a.reposicion ? '<br><small>Reposición est.: ' + suminEsc(a.reposicion) + '</small>' : ''}</div>`).join('');
  const h = abrirHoja(`<h2>Avisos de clientes (${suminAvisos.length})</h2><div class="hint">La Florida · uso interno para pedir priorización a Enel.</div>
    <div class="acciones"><button type="button" id="sumCopiar" class="btn btn-secundario">Copiar listado</button></div>
    <div class="sum-av-l">${filas || '<div class="hint">Sin avisos.</div>'}</div>`);
  const b = $('#sumCopiar', h); if (b) b.addEventListener('click', () => suminCopiarAvisos(b));
}

function pintarTrafosSuministro(){
  if(!map) return;
  if(!suminLayer) suminLayer = L.layerGroup();
  suminLayer.clearLayers();
  if(!suminVer || !suminDato){ if(map.hasLayer(suminLayer)) map.removeLayer(suminLayer); return; }
  suminTrafos.forEach((t) => {
    const ic = L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="sum-tr"><b>⚡</b></div>' });
    L.marker([t.lat, t.lon], { icon: ic, zIndexOffset: -500 }).bindPopup(
      `<b>⚡ Transformador ${suminEsc(t.numpos)}</b><br>Clientes sin suministro: <b>${suminEsc(t.clientes ?? '—')}</b>${t.avisos ? '<br>Cantidad de avisos: <b>' + suminEsc(t.avisos) + '</b>' : ''}` +
      `${t.inicio ? '<br>Corte desde: ' + suminEsc(t.inicio) : ''}${t.reposicion ? '<br>Reposición estimada: ' + suminEsc(t.reposicion) : ''}` +
      `${t.incidencia ? '<br>Incidencia: ' + suminEsc(t.incidencia) : ''}<br><small>Fuente: Enel</small>`).addTo(suminLayer);
  });
  if(!map.hasLayer(suminLayer)) suminLayer.addTo(map);
}
let suminAvisos = [], suminAvisosVer = true, suminAvisosLayer = null;
const suminPuedeAvisos = () => ['admin', 'ito', 'ito2'].includes(rol());   // datos de clientes: solo admin e ITO (la base también lo exige)
let suminActivo = true;   // interruptor del admin (si la tabla aún no existe, se considera encendido)
async function cargarSuministro(){
  try{ const c = await select('suministro_config', 'select=activo&id=eq.1'); suminActivo = !(c && c[0] && c[0].activo === false); }catch(err){ suminActivo = true; }
  if(!suminActivo){ suminDato = null; suminTrafos = []; pintarSuministro(); return; }
  try{
    const [e, t] = await Promise.all([ select('suministro_enel', 'select=*&id=eq.1'), select('suministro_trafos', 'select=numpos,incidencia,clientes,avisos,inicio,reposicion,lat,lon') ]);
    suminDato = (e && e[0]) || null; suminTrafos = t || [];
  }catch(err){ suminDato = null; suminTrafos = []; }
  suminAvisos = [];
  if(suminDato && suminPuedeAvisos()){
    try{ suminAvisos = (await select('suministro_avisos', 'select=cod_aviso,incidencia,direccion,numero_cliente,falla,inicio,reposicion,lat,lon&order=incidencia.asc,cod_aviso.asc&limit=2000')) || []; }catch(err){ suminAvisos = []; }
  }
  pintarSuministro();
}
function iniciarSuministro(){
  if(suminCtl || !map) return;
  try{ suminVer = localStorage.getItem('fa_sum_trafos') !== '0'; suminAvisosVer = localStorage.getItem('fa_sum_avisos') !== '0'; }catch(e){}
  const Ctl = L.Control.extend({ options: { position: 'bottomleft' }, onAdd(){ const d = L.DomUtil.create('div', 'sum-ctl'); d.style.display = 'none'; L.DomEvent.disableClickPropagation(d); return d; } });
  suminCtl = new Ctl().addTo(map);
  cargarSuministro();
}


/* ---- Reparadas: solo se buscan desde el buscador de Activas (admin), hasta 10 días atrás ---- */
const REP_BUSQ_HORAS = 240;
const repBusq = { ts: 0, features: [], cargando: false };
async function cargarRepBusq() {
  if (rol() !== 'admin' || repBusq.cargando || Date.now() - repBusq.ts < 5 * 60e3) return;
  repBusq.cargando = true;
  try {
    const rep = await rpc('fallas_geojson_reparadas', { p_horas: REP_BUSQ_HORAS });
    repBusq.features = ((rep && rep.features) || []).map((f) => { f._c = centroGeom(f.geometry); return f; });
    repBusq.ts = Date.now();
  } catch (e) {
    if (e.name === 'SesionExpirada') { salir(e.message); return; }
    toast('No se pudieron cargar las reparadas.', 'error');
  } finally { repBusq.cargando = false; }
  if (S.vista === 'lista' && S.busqueda.trim()) renderLista();
}

async function cargarFallas(manual) {
  cargarSuministro();
  if (!Object.keys(CONTR).length) cargarContratosEtiqueta();
  const btn = $('#btnActualizar');
  if (manual) btn.classList.add('girando');
  try {
    const geo = await rpc('fallas_geojson', {});
    S.features = ((geo && geo.features) || []).map((f) => { f._c = centroGeom(f.geometry); return f; });
    S.activas = S.features.filter((f) => f.properties.estado !== 'reparada');
    actualizarFiltrosOtrosUI();
    dibujarFallas();
    const n = S.activas.filter((f) => !f.properties.cascada).length;
    const c = $('#navCuenta');
    c.hidden = n === 0; c.textContent = n > 99 ? '99+' : String(n);
    if (S.vista === 'lista') renderLista();
  } catch (e) {
    if (e.name === 'SesionExpirada') { salir(e.message); return; }
    if (manual) toast(e.message, 'error');
  } finally { btn.classList.remove('girando'); }
}
$('#btnActualizar').addEventListener('click', () => {
  const btn = $('#btnActualizar');
  cacheEmp = null; cacheBbox = null;
  cargarFallas(true);
  btn.classList.add('girando');
  Promise.resolve(cargarArea(true)).finally(() => setTimeout(() => btn.classList.remove('girando'), 400));
  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
});

/* ----------------------- hojas: punto y circuito ----------------------- */
function infoSoloLectura() {
  if (puedeReportar()) return '';
  return `<div class="aviso">Con tu perfil (${esc(rolVisible())}) puedes ver el mapa${puedeCerrar() ? ' y registrar reparaciones desde las fallas activas' : ''}. Reportar fallas lo hacen los ITO.</div>`;
}
function modoTexto() {
  if (S.modo.tipo !== 'inspeccion') return 'Se guardará como falla informada <b>ahora</b>.';
  return `Se guardará dentro de tu <b>inspección del ${esc(fmtFechaCorta(S.modo.fecha))}</b>, con la fecha y hora exactas de este momento.`;
}
// Datos extra del reporte según el modo. En inspección la falla lleva la hora real del reporte
// (no se envía fecha: la base usa "ahora"); la inspección conserva la fecha en que se inició.
async function contextoReporte() {
  if (S.modo.tipo !== 'inspeccion' || !S.modo.fecha) return {};
  if (!S.modo.inspId || S.modo.inspFecha !== S.modo.fecha) {
    S.modo.inspId = await rpc('obtener_o_crear_inspeccion', { p_fecha: S.modo.fecha, p_ito: null });
    S.modo.inspFecha = S.modo.fecha;
  }
  return { p_inspeccion_id: S.modo.inspId };
}

function abrirPunto(p) {
  const h = abrirHoja(`
    <h2>Punto lumínico</h2>
    <dl class="kv">
      <dt>N.° de llave</dt><dd>${esc(p.llave ?? '—')}</dd>
      <dt>N.° municipal</dt><dd>${esc(p.nro_mun ?? '—')}</dd>
      <dt>Dirección</dt><dd>${esc([p.calle_1, p.direccion].filter((x) => x != null && x !== '').join(' ') || '—')}</dd>
      <dt>Poste</dt><dd>${esc(p.simb_poste || '—')}</dd>
    </dl>
    ${infoSoloLectura()}
    ${puedeReportar() ? `<div class="acciones"><button id="bReportar" class="btn btn-primario">Reportar falla</button></div>` : ''}`);
  const b = $('#bReportar', h);
  if (b) b.addEventListener('click', ocupar(b, async () => {
    b.textContent = 'Revisando…';
    const dup = await hayFallaActiva('ref_punto_gid', p.gid);
    if (dup) return avisoDuplicado(dup);
    formReportePunto(p);
  }));
}
function abrirCircuito(p) {
  const h = abrirHoja(`
    <h2>Circuito ${esc(p.id ?? '')}</h2>
    <dl class="kv">
      <dt>Luminarias</dt><dd>${esc(p.cantidad_luminarias_cliente ?? '—')}</dd>
      <dt>N.° de cliente</dt><dd>${esc(p.n_cliente ?? '—')}</dd>
    </dl>
    ${infoSoloLectura()}
    ${puedeReportar() ? `<div class="acciones"><button id="bReportar" class="btn btn-primario">Reportar falla de circuito</button></div>` : ''}`);
  const b = $('#bReportar', h);
  if (b) b.addEventListener('click', ocupar(b, async () => {
    b.textContent = 'Revisando…';
    const dup = await hayFallaActiva('ref_circuito_gid', p.gid);
    if (dup) return avisoDuplicado(dup);
    formReporteCircuito(p);
  }));
}
async function hayFallaActiva(campo, gid) {
  // No se confía solo en "estado": también se revisa si ya existe una reparación registrada.
  const ex = await select('fallas', `${campo}=eq.${gid}&select=id,tipo_falla,estado,reparaciones(id)`);
  return (ex || []).find((f) => f.estado !== 'reparada' && !(f.reparaciones && f.reparaciones.length));
}
function avisoDuplicado(f) {
  abrirHoja(`
    <h2>Ya existe una falla activa aquí</h2>
    <div class="aviso peligro">Código ${esc(f.tipo_falla)} · estado: ${esc(ETIQUETA_ESTADO[f.estado] || f.estado)}.<br>No se puede duplicar el reporte. Si crees que es un error, avisa al administrador.</div>
    <div class="acciones"><button class="btn btn-secundario" id="bOk">Entendido</button></div>`);
  $('#bOk').addEventListener('click', () => cerrarHoja());
}

function htmlCodigos(cat) {
  return `<div class="codigos">${cat.map((x) => `<button type="button" class="codigo" data-c="${esc(x.c)}"><b>${esc(x.c)}</b><span>${esc(x.d)}</span></button>`).join('')}</div>`;
}
function htmlOrdenExterna() {
  return `<div class="fila">
    <select id="fOeEmp" class="campo" aria-label="Empresa"><option value="">Sin orden</option><option value="S">Sinec</option><option value="E">Elecnor</option></select>
    <input id="fOeNum" class="campo" inputmode="numeric" placeholder="N.° de orden" autocomplete="off">
  </div>`;
}
function leerOrdenExterna(h) {
  const emp = $('#fOeEmp', h).value;
  const num = $('#fOeNum', h).value.trim().replace(/\s+/g, '');
  if (!emp && !num) return { valor: null };
  if (num && !emp) return { error: 'Elige la empresa de la orden externa (Sinec o Elecnor).' };
  if (emp && !num) return { error: 'Escribe el número de la orden externa, o deja "Sin orden".' };
  if (num.length > 38) return { error: 'El número de la orden externa es demasiado largo.' };
  return { valor: `${emp}-${num}` };
}

function formReportePunto(p) {
  const mono = String(p.simb_poste || '').toUpperCase().trim() === 'MONOPOSTE';
  const cat = mono ? CAT_MONOPOSTE : CAT_PUNTO;
  let codigo = null, card = null;
  const h = abrirHoja(`
    ${htmlBotonMasivo()}
    <h2>Reportar falla</h2>
    <div class="hint">Punto lumínico · llave ${esc(p.llave ?? '—')} · N.° municipal ${esc(p.nro_mun ?? '—')}${mono ? ' · monoposte' : ''}</div>
    <h3>Código de falla</h3>${htmlCodigos(cat)}
    <h3>Cardinalidad (opcional)</h3>
    <div class="rosca" id="fCard">
      <button type="button" data-r="N">N</button><button type="button" data-r="S">S</button>
      <button type="button" data-r="O">O</button><button type="button" data-r="P">P</button>
    </div>
    <h3>Comentario</h3>
    <textarea id="fDesc" class="campo" placeholder="Opcional (obligatorio si eliges OTRO)"></textarea>
    <h3>Orden externa (opcional)</h3>${htmlOrdenExterna()}
    <div style="margin-top:12px">${modoTexto()}</div>
    <div class="acciones fija"><button id="fEnviar" class="btn btn-primario">Confirmar reporte</button></div>`);
  $$('.codigo', h).forEach((b) => b.addEventListener('click', () => {
    $$('.codigo', h).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); codigo = b.dataset.c;
  }));
  $$('#fCard button', h).forEach((b) => b.addEventListener('click', () => {
    const ya = b.classList.contains('sel');
    $$('#fCard button', h).forEach((x) => x.classList.remove('sel'));
    if (!ya) { b.classList.add('sel'); card = b.dataset.r; } else card = null;
  }));
  activarBotonMasivo(h);
  const env = $('#fEnviar', h);
  env.addEventListener('click', ocupar(env, async () => {
    if (!codigo) { toast('Selecciona un código de falla.', 'error'); return; }
    const desc = $('#fDesc', h).value.trim();
    if (codigo === 'OTRO' && !desc) { toast('Describe la falla.', 'error'); return; }
    const oe = leerOrdenExterna(h);
    if (oe.error) { toast(oe.error, 'error'); return; }
    env.textContent = 'Enviando…';
    const ctx = await contextoReporte();
    if (leerMasivo(h)) ctx.p_masivo = true;
    const r = await rpc('crear_falla_punto', { p_punto_gid: p.gid, p_tipo_falla: codigo, p_cardinalidad: card, p_descripcion: desc || null, p_orden_externa: oe.valor, ...ctx });
    cerrarHoja();
    toast(`Falla registrada · OS ${r.ot}${r.estado === 'reiterada' ? ' (reiterada)' : ''}`, 'ok');
    cargarFallas();
  }));
}

function formReporteCircuito(p) {
  let codigo = null;
  const h = abrirHoja(`
    ${htmlBotonMasivo()}
    <h2>Reportar falla de circuito</h2>
    <div class="hint">Circuito ${esc(p.id ?? '')} · ${esc(p.cantidad_luminarias_cliente ?? '—')} luminarias</div>
    <div class="aviso">Se crea una falla por cada punto del circuito. Al reparar el circuito se cierran todas juntas.</div>
    <h3>Código de falla</h3>${htmlCodigos(CAT_CIRCUITO)}
    <h3>Comentario</h3>
    <textarea id="fDesc" class="campo" placeholder="Opcional (obligatorio si eliges OTRO)"></textarea>
    <h3>Orden externa (opcional)</h3>${htmlOrdenExterna()}
    <div style="margin-top:12px">${modoTexto()}</div>
    <div class="acciones fija"><button id="fEnviar" class="btn btn-primario">Confirmar reporte</button></div>`);
  $$('.codigo', h).forEach((b) => b.addEventListener('click', () => {
    $$('.codigo', h).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); codigo = b.dataset.c;
  }));
  activarBotonMasivo(h);
  const env = $('#fEnviar', h);
  env.addEventListener('click', ocupar(env, async () => {
    if (!codigo) { toast('Selecciona un código de falla.', 'error'); return; }
    const desc = $('#fDesc', h).value.trim();
    if (codigo === 'OTRO' && !desc) { toast('Describe la falla.', 'error'); return; }
    const oe = leerOrdenExterna(h);
    if (oe.error) { toast(oe.error, 'error'); return; }
    env.textContent = 'Enviando…';
    const ctx = await contextoReporte();
    if (leerMasivo(h)) ctx.p_masivo = true;
    const r = await rpc('crear_falla_circuito', { p_circuito_gid: p.gid, p_tipo_falla: codigo, p_descripcion: desc || null, p_orden_externa: oe.valor, ...ctx });
    cerrarHoja();
    toast(`Falla registrada · OS ${r.ot} · ${r.puntos_afectados} puntos afectados`, 'ok');
    cargarFallas();
  }));
}

/* ------------------------ hoja: detalle de falla ------------------------ */
function tipoLabel(p) { return p.tipo === 'punto' ? (p.cascada ? 'Punto (por circuito)' : 'Punto lumínico') : 'Circuito'; }
function urlComoLlegar(c) { return `https://www.google.com/maps/dir/?api=1&destination=${c[0]},${c[1]}&travelmode=driving`; }

// Desde la ventana de una falla ya reparada: ofrecer reportar una falla nueva en el mismo punto o circuito.
async function reportarNuevaSobre(p) {
  if (p.tipo === 'linea') {
    const gid = p.ref_circuito_gid;
    const dup = await hayFallaActiva('ref_circuito_gid', gid);
    if (dup) return avisoDuplicado(dup);
    const capa = capaCircuitos.getLayers().find((l) => l.feature && l.feature.properties.gid === gid);
    return formReporteCircuito(capa ? capa.feature.properties : { gid, id: '', cantidad_luminarias_cliente: '—' });
  }
  const gid = p.ref_punto_gid;
  const dup = await hayFallaActiva('ref_punto_gid', gid);
  if (dup) return avisoDuplicado(dup);
  formReportePunto({ gid, llave: p.llave, nro_mun: p.nro_mun, simb_poste: p.simb_poste });
}

// Edita una falla recién ingresada (dentro de 15 min) o cualquiera si eres admin. La base valida el permiso (editar_falla).
// Se puede cambiar código, comentario, orden externa y masivo. La ubicación no: si está mal, se elimina y se vuelve a informar.
async function editarFallaApp(p) {
  let fila;
  try { const r = await select('fallas', `id=eq.${p.id}&select=tipo,tipo_falla,descripcion_otro,orden_externa,masivo`); fila = r && r[0]; }
  catch (e) { toast('No se pudo cargar la falla: ' + e.message, 'error'); return; }
  if (!fila) { toast('No se encontró la falla.', 'error'); return; }
  const esCircuito = fila.tipo === 'linea';
  const cat = esCircuito ? CAT_CIRCUITO : (['F02', 'F03'].includes(fila.tipo_falla) ? CAT_MONOPOSTE : CAT_PUNTO);
  let codigo = fila.tipo_falla;
  const h = abrirHoja(`
    ${htmlBotonMasivo()}
    <h2>Editar falla · OS ${esc(p.ot || '—')}</h2>
    <div class="hint">${esc(tipoLabel(p))}${p.tipo === 'punto' ? ` · llave ${esc(p.llave ?? '—')}` : ''}. La ubicación no se puede cambiar: si está mal, elimina la falla y vuelve a informarla.${esCircuito ? ' Los cambios también se aplican a sus puntos afectados.' : ''}</div>
    <h3>Código de falla</h3>${htmlCodigos(cat)}
    <h3>Comentario</h3>
    <textarea id="fDesc" class="campo" placeholder="Opcional (obligatorio si eliges OTRO)"></textarea>
    <h3>Orden externa (opcional)</h3>${htmlOrdenExterna()}
    <div class="acciones fija"><button id="fGuardar" class="btn btn-primario">Guardar cambios</button></div>`);
  $$('.codigo', h).forEach((b) => {
    if (b.dataset.c === codigo) b.classList.add('sel');
    b.addEventListener('click', () => { $$('.codigo', h).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); codigo = b.dataset.c; });
  });
  $('#fDesc', h).value = fila.descripcion_otro || '';
  const m = /^([SE])-(.*)$/.exec(fila.orden_externa || '');
  if (m) { $('#fOeEmp', h).value = m[1]; $('#fOeNum', h).value = m[2]; }
  const bm = $('#fMasivo', h);
  if (fila.masivo) { bm.classList.add('on'); bm.setAttribute('aria-pressed', 'true'); }
  activarBotonMasivo(h);
  const gu = $('#fGuardar', h);
  gu.addEventListener('click', ocupar(gu, async () => {
    if (!codigo) { toast('Selecciona un código de falla.', 'error'); return; }
    const desc = $('#fDesc', h).value.trim();
    if (codigo === 'OTRO' && !desc) { toast('Describe la falla.', 'error'); return; }
    const oe = leerOrdenExterna(h);
    if (oe.error) { toast(oe.error, 'error'); return; }
    gu.textContent = 'Guardando…';
    await rpc('editar_falla', { p_id: p.id, p_cambios: { tipo_falla: codigo, descripcion_otro: desc || null, orden_externa: oe.valor, masivo: leerMasivo(h) } });
    cerrarHoja();
    toast('Falla actualizada', 'ok');
    cargarFallas();
  }));
}

// Elimina una falla recién ingresada (dentro de 15 min) o cualquiera si eres admin. La base vuelve a validar el permiso.
async function eliminarFallaApp(p) {
  if (!confirm('¿Eliminar esta falla? Esta acción no se puede deshacer.')) return;
  let inspId = null;
  try { const r = await select('fallas', `id=eq.${p.id}&select=inspeccion_id`); inspId = (r && r[0]) ? r[0].inspeccion_id : null; } catch (e) { /* sin inspección conocida */ }
  const borradas = await api(`/rest/v1/fallas?id=eq.${p.id}`, { method: 'DELETE', prefer: 'return=representation' });
  if (!borradas || !borradas.length) throw new Error('No se eliminó la falla: ya pasaron los 15 minutos o no tienes permiso.');
  cerrarHoja();
  toast('Falla eliminada', 'ok');
  cargarFallas();
  if (!inspId) return;
  // Si era la última falla de su inspección, se pregunta si se deja registrada «sin fallas» (misma regla de la web)
  try {
    const info = await rpc('inspeccion_info', { p_id: inspId });
    if (!info || info.fallas !== 0) return;
    const dejarla = confirm(`Eliminaste la última falla de la inspección del ${String(info.fecha).slice(0, 10).split('-').reverse().join('-')} de ${info.ito_nombre}.\n\nACEPTAR = dejarla registrada como inspección SIN fallas.\nCANCELAR = quitar la inspección (como si no se hubiera hecho).`);
    if (dejarla) return;
    await rpc('eliminar_inspeccion_vacia', { p_id: inspId });
    if (S.modo && S.modo.inspId === inspId) S.modo.inspId = null;
  } catch (e) { console.error('No se pudo revisar la inspección vacía:', e); }
}
async function abrirFalla(p, geom) {
  const c = centroGeom(geom);
  const desc = DESC_CODIGO[p.tipo_falla];
  const kv = [
    ['OS', p.ot || '—'],
    p.orden_externa ? ['Orden externa', p.orden_externa] : null,
    ['Tipo', tipoLabel(p)],
    p.tipo === 'punto' ? ['Llave / N.° mun.', `${p.llave ?? '—'} / ${p.nro_mun ?? '—'}`] : null,
    p.cardinalidad ? ['Cardinalidad', p.cardinalidad] : null,
    ['Informada', fmtFecha(p.fecha_falla)],
    ['Inspector', p.nombre_creador || p.nombre_real_creador || '—'],
    ['Duración de la falla', fmtDuracion(p.fecha_falla)],
    p.tipo !== 'punto' ? ['Puntos afectados', p.puntos_afectados ?? '—'] : null,
    p.asignado_camion_nombre ? ['Asignado por', `${p.asignado_por_nombre || '—'}${p.fecha_asignacion ? ' · ' + fmtFechaHoraCorta(p.fecha_asignacion) : ''}`] : null,
    // "Asignado a" solo en fallas activas; en reparadas/pendientes la zona de respuesta lleva "Responde"
    p.asignado_camion_nombre && p.estado !== 'reparada' && p.estado !== 'pendiente' ? ['Asignado a', p.asignado_camion_nombre] : null,
  ].filter(Boolean);
  const kvRespuesta = p.estado === 'reparada'
    ? [['Responde', p.reparado_por_nombre || '—'], ['Fecha respuesta', fmtFecha(p.fecha_reparacion)]]
    : p.estado === 'pendiente'
      ? [['Responde', p.pendiente_por_nombre || '—'], ['Fecha respuesta', fmtFecha(p.fecha_pendiente)]]
      : [];
  const puedeCerrarEsta = puedeCerrar() && !p.cascada && p.estado !== 'reparada';
  const puedeNuevaAqui = puedeReportar() && p.estado === 'reparada';
  const puedeAsignarEsta = puedeAsignar() && !p.cascada && p.estado !== 'reparada';
  // Eliminar: el creador su propia falla (no reparada) dentro de 15 min desde que la ingresó; el admin cualquiera (la base lo exige igual)
  const minDesdeIngreso = p.fecha_falla_real ? (Date.now() - new Date(p.fecha_falla_real).getTime()) / 60000 : Infinity;
  const puedeEliminarEsta = !p.cascada && !!S.perfil && (rol() === 'admin' || (p.creado_por === S.perfil.id && p.estado !== 'reparada' && minDesdeIngreso <= 15));
  const puedeEditarEsta = puedeEliminarEsta && p.estado !== 'reparada';
  const minRestantes = Math.max(1, Math.ceil(15 - minDesdeIngreso));
  const h = abrirHoja(`
    <h2>${esc(p.tipo_falla)}${desc ? ' · ' + esc(desc) : ''}</h2>
    <div style="margin-top:6px"><span class="insignia ${esc(p.estado)}">${esc(ETIQUETA_ESTADO[p.estado] || p.estado)}</span></div>
    <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${p.estado === 'reparada' ? `<div style="border-top:1px solid var(--linea);margin-top:12px;padding-top:4px">
      <dl class="kv">${kvRespuesta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${p.descripcion_reparacion ? `<h3>Trabajo realizado</h3><pre class="texto">${esc(p.descripcion_reparacion)}</pre>` : ''}
      <div id="fotosFalla"></div>
    </div>` : ''}
    ${p.estado === 'pendiente' ? `<div style="border-top:1px solid var(--linea);margin-top:12px;padding-top:4px">
      <dl class="kv">${kvRespuesta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <h3>Motivo</h3><pre class="texto">${esc(p.motivo_pendiente || '')}</pre>
    </div>` : ''}
    ${p.cascada ? `<div class="aviso" id="avCascada">Este punto se cierra automáticamente al reparar su circuito.</div>` : ''}
    <div class="acciones" id="accFalla">
      ${puedeEditarEsta ? `<button id="bEditar" class="btn ${puedeCerrarEsta ? 'btn-secundario' : 'btn-primario'}">Editar falla${rol() === 'admin' ? '' : ` (quedan ${minRestantes} min)`}</button>` : ''}
      ${puedeCerrarEsta ? `<button id="bCerrar" class="btn btn-primario">Registrar reparación</button>` : ''}
      ${puedeNuevaAqui ? `<button id="bNueva" class="btn btn-secundario">Reportar falla nueva en ${p.tipo === 'linea' ? 'este circuito' : 'este punto'}</button>` : ''}
      ${puedeAsignarEsta ? `<button id="bAsignar" class="btn btn-secundario">${p.asignado_camion_id ? 'Cambiar camión asignado' : 'Asignar a camión'}</button>` : ''}
      <a class="btn btn-secundario" style="display:flex;align-items:center;justify-content:center;text-decoration:none" target="_blank" rel="noopener" href="${esc(urlComoLlegar(c))}">Cómo llegar</a>
    </div>
    ${puedeEliminarEsta ? `<div style="text-align:center;margin-top:2px"><button id="bEliminar" class="btn-link" style="color:var(--rojo);font-weight:600">Eliminar falla${rol() === 'admin' ? '' : ` (quedan ${minRestantes} min)`}</button></div>` : ''}
    <h3>Historial</h3>
    <ul class="linea-tiempo" id="histFalla"><li class="hint">Cargando…</li></ul>`);
  const bc = $('#bCerrar', h);
  if (bc) bc.addEventListener('click', () => formCierre(p));
  const bed = $('#bEditar', h);
  if (bed) bed.addEventListener('click', () => editarFallaApp(p));
  const bn = $('#bNueva', h);
  if (bn) bn.addEventListener('click', ocupar(bn, () => reportarNuevaSobre(p)));
  const ba = $('#bAsignar', h);
  if (ba) ba.addEventListener('click', () => formAsignar(p));
  const be = $('#bEliminar', h);
  if (be) be.addEventListener('click', ocupar(be, () => eliminarFallaApp(p)));
  if (p.estado === 'reparada') {
    select('fallas_fotos', `falla_id=eq.${p.id}&select=ruta,archivada_en,respaldo&order=creado_en.asc`).then(async (fs) => {
      const box = $('#fotosFalla'); if (!box || !document.body.contains(box) || !fs || !fs.length) return;
      const vivas = fs.filter((f) => !f.archivada_en), arch = fs.filter((f) => f.archivada_en);
      const urls = await Promise.all(vivas.map((f) => urlFoto(f.ruta).catch(() => null)));
      if (!document.body.contains(box)) return;
      const ok = urls.filter(Boolean);
      box.innerHTML = `<h3>Fotografías</h3>${ok.length ? `<div class="fotos">${ok.map((u, i) => `<button type="button" class="foto" data-i="${i}" aria-label="Ampliar foto ${i + 1}"><img src="${esc(u)}" alt="Foto ${i + 1}"></button>`).join('')}</div><div class="hint">Toca una foto para verla en grande.</div>` : ''}${arch.length ? `<div class="hint">${arch.length} foto(s) archivada(s) en el respaldo ${esc(arch[0].respaldo || '')}.</div>` : ''}`;
      $$('.foto', box).forEach((b) => b.addEventListener('click', () => abrirFotoGrande(ok, +b.dataset.i)));
    }).catch(() => {});
  }
  // Historial de comentarios
  select('fallas_comentarios', `falla_id=eq.${p.id}&select=tipo,comentario,autor_nombre,creado_en&order=creado_en.asc`).then((rows) => {
    const ul = $('#histFalla');
    if (!ul || !document.body.contains(ul)) return;
    ul.innerHTML = rows && rows.length
      ? rows.map((r) => `<li class="t-${esc(r.tipo)}"><div class="quien">${esc(r.tipo)} · ${esc(r.autor_nombre || '—')} · ${esc(fmtFecha(r.creado_en))}</div><pre class="texto">${esc(r.comentario)}</pre></li>`).join('')
      : '<li class="hint">Sin comentarios registrados.</li>';
  }).catch(() => { const ul = $('#histFalla'); if (ul) ul.innerHTML = '<li class="hint">No se pudo cargar el historial.</li>'; });
  // Falla en cascada: ofrecer ir a la falla del circuito
  if (p.cascada) {
    select('fallas', `id=eq.${p.id}&select=circuito_origen_id`).then((r) => {
      const padre = r && r[0] && r[0].circuito_origen_id;
      const f = padre && S.features.find((x) => x.properties.id === padre);
      const av = $('#avCascada');
      if (f && av && document.body.contains(av)) {
        av.insertAdjacentHTML('beforeend', '<div style="margin-top:8px"><button class="btn btn-secundario" id="bPadre" style="height:42px">Ver falla del circuito</button></div>');
        $('#bPadre').addEventListener('click', () => abrirFalla(f.properties, f.geometry));
      }
    }).catch(() => {});
  }
}

async function formAsignar(p) {
  const h = abrirHoja(`
    <h2>Asignar a camión</h2>
    <div class="hint">${esc(p.tipo_falla)} · OS ${esc(p.ot || '—')} · ${esc(tipoLabel(p))}${p.tipo === 'linea' ? ' · se asignarán también sus puntos' : ''}</div>
    <h3>Camión</h3>
    <select id="aCam" class="campo"><option value="">Cargando camiones…</option></select>
    <h3>Comentario (opcional)</h3>
    <textarea id="aCom" class="campo" placeholder="Lo verá el camión."></textarea>
    <div class="acciones fija"><button id="aOk" class="btn btn-primario">Guardar asignación</button></div>`);
  const sel = $('#aCam', h), ok = $('#aOk', h);
  ok.disabled = true;
  try {
    const cams = await rpc('listar_camiones', {});
    if (!document.body.contains(sel)) return;
    sel.innerHTML = '<option value="">Sin asignar</option>' + (cams || []).map((c) => `<option value="${esc(c.id)}" ${c.id === p.asignado_camion_id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
    ok.disabled = false;
  } catch (e) { sel.innerHTML = '<option value="">No se pudo cargar</option>'; toast('No se pudo cargar la lista de camiones.', 'error'); return; }
  ok.addEventListener('click', ocupar(ok, async () => {
    const camionId = sel.value || null;
    const com = $('#aCom', h).value.trim();
    ok.textContent = 'Guardando…';
    const filas = await api(`/rest/v1/fallas?id=eq.${p.id}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { asignado_camion_id: camionId, asignado_por_id: camionId ? S.perfil.id : null },
    });
    if (!filas || !filas.length) throw new Error('No tienes permiso para asignar esta falla.');
    if (com) {
      await api('/rest/v1/fallas_comentarios', {
        method: 'POST',
        body: { falla_id: p.id, tipo: 'asignacion', comentario: com, autor_id: S.perfil.id, autor_nombre: S.perfil.nombre },
      }).catch(() => {});
    }
    cerrarHoja();
    toast(camionId ? 'Camión asignado' : 'Asignación quitada', 'ok');
    cargarFallas();
  }));
}

function formCierre(p, borr) {
  let sel = [];
  const exigeFoto = !!(S.perfil && S.perfil.foto_obligatoria);
  const fotos = [];   // { blob, url, subida }
  if (borr) { sel = (borr.sel || []).slice(); (borr.fotos || []).forEach((b) => fotos.push({ blob: b, url: URL.createObjectURL(b), subida: false })); }
  const h = abrirHoja(`
    <h2>Registrar reparación</h2>
    <div class="hint">${esc(p.tipo_falla)} · OS ${esc(p.ot || '—')} · ${esc(tipoLabel(p))}${p.tipo === 'linea' ? ' · se cerrarán también sus ' + esc(p.puntos_afectados ?? '') + ' puntos' : ''}</div>
    <h3>Trabajo realizado</h3>
    <div class="codigos">${CAT_CIERRES.map((x) => `<button type="button" class="codigo" data-t="${esc(x.c + ' ' + x.d)}"><b>${esc(x.c)}</b><span>${esc(x.d)}</span></button>`).join('')}</div>
    <h3>Información adicional</h3>
    <textarea id="cDesc" class="campo" placeholder="Ej: detalle de lo realizado. Obligatorio si dejas la falla pendiente."></textarea>
    <h3>Fotografías ${exigeFoto ? '<span class="req">obligatoria</span>' : '<span class="hint" style="font-weight:400;">(opcional)</span>'}</h3>
    <div class="hint">${exigeFoto ? 'Sube al menos 1 foto de la reparación' : 'Puedes subir fotos de la reparación'} (máximo ${MAX_FOTOS}). Se reducen solas para ocupar poco espacio.</div>
    <div id="cFotos" class="fotos"></div>
    <div class="fila-btns">
      <button type="button" id="cBtnCam" class="btn btn-secundario">📷 Tomar foto</button>
      <button type="button" id="cBtnGal" class="btn btn-secundario">🖼 Galería</button>
    </div>
    <input id="cInCam" type="file" accept="image/*" capture="environment" hidden>
    <input id="cInGal" type="file" accept="image/*" multiple hidden>
    <div class="acciones fija">
      <button id="cOk" class="btn btn-primario">Registrar reparación y cerrar falla</button>
      <button id="cPend" class="btn btn-ambar">Dejar pendiente</button>
    </div>`);
  $$('.codigo', h).forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.t, i = sel.indexOf(t);
    if (i >= 0) { sel.splice(i, 1); b.classList.remove('sel'); } else { sel.push(t); b.classList.add('sel'); }
  }));
  S.borradorId = p.id;
  const guardarBorrador = () => bdSet('cierre', { id: p.id, ts: Date.now(), sel: sel.slice(), desc: $('#cDesc', h).value, fotos: fotos.map((f) => f.blob) });
  if (borr) {
    $('#cDesc', h).value = borr.desc || '';
    $$('.codigo', h).forEach((b) => { if (sel.includes(b.dataset.t)) b.classList.add('sel'); });
  }
  $$('.codigo', h).forEach((b) => b.addEventListener('click', guardarBorrador));
  $('#cDesc', h).addEventListener('input', guardarBorrador);
  const texto = () => { const libre = $('#cDesc', h).value.trim(); return [...sel, ...(libre ? [libre] : [])].join('\n'); };
  const ok = $('#cOk', h), pend = $('#cPend', h);
  const pintarFotos = () => {
    const c = $('#cFotos', h); if (!c) return;
    c.innerHTML = fotos.map((f, i) => `<div class="foto"><img src="${f.url}" alt="Foto ${i + 1}" data-v="${i}"><button type="button" data-i="${i}" aria-label="Quitar foto">✕</button></div>`).join('');
    $$('img', c).forEach((im) => im.addEventListener('click', () => abrirFotoGrande(fotos.map((x) => x.url), +im.dataset.v)));
    $$('button', c).forEach((b) => b.addEventListener('click', () => { const f = fotos.splice(+b.dataset.i, 1)[0]; URL.revokeObjectURL(f.url); pintarFotos(); }));
    $('#cBtnCam', h).disabled = $('#cBtnGal', h).disabled = fotos.length >= MAX_FOTOS;
    if (S.borradorId === p.id) guardarBorrador();
  };
  {
    const agregar = async (files) => {
      const libres = MAX_FOTOS - fotos.length;
      const lista = Array.from(files || []).slice(0, libres);
      if (files && files.length > libres) toast(`Máximo ${MAX_FOTOS} fotos.`, 'error');
      for (const f of lista) {
        try { const blob = await comprimirFoto(f); fotos.push({ blob, url: URL.createObjectURL(blob), subida: false }); }
        catch (e) { toast(e.message, 'error'); }
      }
      pintarFotos();
    };
    $('#cBtnCam', h).addEventListener('click', async () => {
      guardarBorrador();
      const r = await abrirCamara();
      if (r === undefined) $('#cInCam', h).click();
      else if (r) agregar([r]);
    });
    $('#cBtnGal', h).addEventListener('click', () => $('#cInGal', h).click());
    ['cInCam', 'cInGal'].forEach((id) => $('#' + id, h).addEventListener('change', (e) => { agregar(e.target.files); e.target.value = ''; }));
    pintarFotos();
  }
  ok.addEventListener('click', ocupar(ok, async () => {
    const d = texto();
    if (!d) { toast('Elige el trabajo realizado o describe la reparación.', 'error'); return; }
    if (exigeFoto && !fotos.length) { toast('Esta reparación exige al menos una fotografía.', 'error'); return; }
    {
      const pend_ = fotos.filter((f) => !f.subida);
      for (let i = 0; i < pend_.length; i++) {
        ok.textContent = `Subiendo foto ${i + 1} de ${pend_.length}…`;
        await subirFoto(p.id, pend_[i].blob);
        pend_[i].subida = true;
      }
    }
    ok.textContent = 'Guardando…';
    const r = await rpc('registrar_reparacion', { p_falla_id: p.id, p_descripcion: d });
    cerrarHoja();
    toast(r && r.puntos_cerrados ? `Reparación registrada · ${r.puntos_cerrados} puntos cerrados` : 'Reparación registrada', 'ok');
    cargarFallas();
  }));
  pend.addEventListener('click', ocupar(pend, async () => {
    const libre = $('#cDesc', h).value.trim();
    const d = texto();
    if (!libre && !d) { toast('Escribe el motivo antes de dejarla pendiente.', 'error'); return; }
    pend.textContent = 'Guardando…';
    const filas = await api(`/rest/v1/fallas?id=eq.${p.id}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { estado: 'pendiente', pendiente_por: S.perfil.id, fecha_pendiente: new Date().toISOString(), motivo_pendiente: d },
    });
    if (!filas || !filas.length) throw new Error('No tienes permiso para dejar esta falla pendiente.');
    await api('/rest/v1/fallas_comentarios', {
      method: 'POST',
      body: { falla_id: p.id, tipo: 'pendiente', comentario: d, autor_id: S.perfil.id, autor_nombre: S.perfil.nombre },
    }).catch(() => {});
    cerrarHoja();
    toast('Falla dejada como pendiente', 'ok');
    cargarFallas();
  }));
}

/* ---------------------------- lista de fallas ---------------------------- */
function renderLista() {
  const q = S.busqueda.trim().toLowerCase();
  actualizarFiltrosOtrosUI();
  let items = S.activas.filter((f) => !f.properties.cascada);
  items = items.filter((f) => pasaFiltrosOtros(!!f.properties.masivo, f.properties.asignado_camion_id));
  const total = items.length;
  items = items.filter((f) => !S.estadosOff[f.properties.estado]);
  actualizarFiltrosListaUI();
  if (q) {
    items = items.filter((f) => {
      const p = f.properties;
      return [p.ot, p.orden_externa, p.tipo_falla, DESC_CODIGO[p.tipo_falla], p.llave, p.nro_mun, p.nombre_creador].some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }
  // Admin: al buscar, se suman las reparadas de los últimos 10 días (sin búsqueda no aparecen)
  let nRep = 0;
  if (q && rol() === 'admin') {
    cargarRepBusq();
    const idsMostradas = new Set(items.map((f) => f.properties.id));
    const rep = repBusq.features.filter((f) => {
      const p = f.properties;
      if (p.cascada || idsMostradas.has(p.id)) return false;
      if (asigActiva() !== 'todas') return false;
      if (FO.sub === 'masivo' && !p.masivo) return false;
      if (FO.sub === 'normal' && p.masivo) return false;
      return [p.ot, p.orden_externa, p.tipo_falla, DESC_CODIGO[p.tipo_falla], p.llave, p.nro_mun, p.nombre_creador].some((v) => String(v ?? '').toLowerCase().includes(q));
    });
    nRep = rep.length;
    items = items.concat(rep);
  }
  items = items.map((f) => ({ f, d: S.pos ? distanciaM([S.pos.lat, S.pos.lng], f._c) : null }));
  // Todos los usuarios eligen el orden (por defecto cercanía; sin GPS cae a recientes).
  const orden = ordenLista();
  const porCerca = orden === 'cerca' && !!S.pos;
  if (porCerca) items.sort((a, b) => a.d - b.d);
  else items.sort((a, b) => (Date.parse(b.f.properties.fecha_falla) || 0) - (Date.parse(a.f.properties.fecha_falla) || 0) || String(b.f.properties.ot).localeCompare(String(a.f.properties.ot)));
  asegurarOrdenUI();
  $('#listaOrdenGrupo').hidden = false;
  $$('#listaOrden .fchip').forEach((c) => c.classList.toggle('on', c.dataset.orden === orden));
  $('#listaResumen').textContent = `${items.length - nRep} de ${total} fallas activas${nRep ? ` + ${nRep} reparada${nRep > 1 ? 's' : ''} (últimos 10 días)` : ''} · ${porCerca ? 'ordenadas por cercanía' : (orden === 'cerca' ? 'más recientes primero (activa el GPS para ordenar por cercanía)' : 'más recientes primero')}`;
  $('#listaItems').innerHTML = items.length ? items.map(({ f, d }, i) => {
    const p = f.properties;
    return `<button class="tarjeta est-${esc(p.estado)}" data-i="${i}">
      <div class="tarjeta-top"><b>${esc(p.tipo_falla)} · ${esc(DESC_CODIGO[p.tipo_falla] || '')}</b>${d != null ? `<span class="dist">${esc(fmtDist(d))}</span>` : ''}</div>
      <div class="sub">OS ${esc(p.ot || '—')} · ${p.tipo === 'punto' ? 'Llave ' + esc(p.llave ?? '—') : esc(p.puntos_afectados ?? '') + ' puntos (circuito)'} · <span class="insignia ${esc(p.estado)}">${esc(ETIQUETA_ESTADO[p.estado] || p.estado)}</span></div>
      <div class="sub">${esc(p.nombre_creador || '—')} · ${esc(hace(p.fecha_falla))}${tagContrato(p.contrato_id)}</div>
    </button>`;
  }).join('') : '<div class="vacio">No hay fallas activas con este filtro.</div>';
  $$('#listaItems .tarjeta').forEach((b) => b.addEventListener('click', () => {
    const { f } = items[Number(b.dataset.i)];
    cambiarVista('mapa');
    map.setView(f._c, Math.max(map.getZoom(), 18));
    abrirFalla(f.properties, f.geometry);
  }));
}
$$('#listaAsig .fchip').forEach((c) => c.addEventListener('click', () => fijarFiltroOtros('asig', c.dataset.asig)));
$$('#listaSub .fchip').forEach((c) => c.addEventListener('click', () => fijarFiltroOtros('sub', c.dataset.sub)));
$('#badgeSinAsignar').addEventListener('click', () => { FO.asig = 'todas'; FO.sub = 'todas'; actualizarFiltrosOtrosUI(); dibujarFallas(); if (S.vista === 'lista') renderLista(); });
$('#listaBuscar').addEventListener('input', (e) => { S.busqueda = e.target.value; renderLista(); });
/* Panel de filtros (estado, sin asignar, masivo): afecta a la lista y al mapa */
function cuentaFiltrosLista() { return Object.values(S.estadosOff).filter(Boolean).length + cuentaFiltrosOtros(); }
function actualizarFiltrosListaUI() {
  const n = cuentaFiltrosLista(), num = $('#filtrosListaNum'), btn = $('#btnFiltrosLista');
  if (!num) return;
  num.textContent = n; num.hidden = n === 0; btn.classList.toggle('on', n > 0);
  $$('#listaChips .fchip').forEach((c) => c.classList.toggle('off', !!S.estadosOff[c.dataset.e]));
}
$('#btnFiltrosLista').addEventListener('click', () => {
  const p = $('#filtrosListaPanel'); p.hidden = !p.hidden; $('#btnFiltrosLista').setAttribute('aria-expanded', String(!p.hidden));
});
$$('#listaChips .fchip').forEach((b) => b.addEventListener('click', () => {
  S.estadosOff[b.dataset.e] = !S.estadosOff[b.dataset.e]; dibujarFallas(); renderLista();
}));
$('#filtrosListaLimpiar').addEventListener('click', () => {
  S.estadosOff = {};
  FO.asig = 'todas'; FO.sub = 'todas';
  actualizarFiltrosOtrosUI(); dibujarFallas(); renderLista();
});

function cambiarVista(v) {
  S.vista = v;
  $('#vistaMapa').hidden = v !== 'mapa';
  $('#vistaLista').hidden = v !== 'lista';
  $('#vistaInsp').hidden = v !== 'insp';
  $$('.nav-btn[data-vista]').forEach((b) => b.classList.toggle('sel', b.dataset.vista === v));
  if (v === 'mapa' && map) { setTimeout(() => { map.invalidateSize(); cargarArea(); }, 50); }
  if (v === 'lista') renderLista();
  if (v === 'insp') cargarInspC3();
  $('#zoomAviso').hidden = v !== 'mapa' || (map && map.getZoom() >= ZOOM_DATOS);
}
$$('.nav-btn[data-vista]').forEach((b) => b.addEventListener('click', () => cambiarVista(b.dataset.vista)));

/* ------------------- Contratista3: inspecciones de todos los ITOs + asignación rápida ------------------- */
const hoyISO = () => new Date().toISOString().slice(0, 10);
async function cargarInspC3() {
  const cont = $('#inspC3Items');
  cont.innerHTML = '<div class="vacio">Cargando…</div>';
  try {
    const ini = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    const filas = await rpc('inspecciones_listado', { p_inicio: ini, p_fin: hoyISO(), p_ito: null });
    $('#inspC3Resumen').textContent = `Inspecciones de los últimos 7 días (todos los ITOs). Las cifras consideran solo tu contrato.`;
    if (!filas || !filas.length) { cont.innerHTML = '<div class="vacio">No hay inspecciones en los últimos 7 días.</div>'; return; }
    cont.innerHTML = filas.map((i) => `<div class="tarjeta insp-c3" data-id="${esc(i.inspeccion_id)}">
      <div class="tarjeta-top"><b>${esc(i.ito_nombre)}</b><span class="dist">${esc(fmtFechaCorta(i.fecha))}</span></div>
      <div class="sub">${i.fallas ? `${i.fallas} falla${i.fallas > 1 ? 's' : ''} · ${i.puntos_afectados} punto${i.puntos_afectados === 1 ? '' : 's'} afectado${i.puntos_afectados === 1 ? '' : 's'}` : 'Sin fallas de tu contrato'}</div>
      <div class="sub">${[['reportada', i.reportadas], ['pendiente', i.pendientes], ['reiterada', i.reiteradas], ['reparada', i.reparadas]].filter((x) => x[1]).map((x) => `<span class="insignia ${x[0]}">${x[1]} ${ETIQUETA_ESTADO[x[0]] || x[0]}</span>`).join(' ')}</div>
      <div class="acciones" style="margin-top:8px;"><button class="btn btn-secundario" data-det="${esc(i.inspeccion_id)}">Ver detalle</button>${(i.fallas - i.reparadas) > 0 ? `<button class="btn btn-primario" data-asig="${esc(i.inspeccion_id)}">🚚 Asignar a camión</button>` : ''}</div>
    </div>`).join('');
    cont.querySelectorAll('[data-det]').forEach((b) => b.addEventListener('click', () => detalleInspC3(b.dataset.det)));
    cont.querySelectorAll('[data-asig]').forEach((b) => b.addEventListener('click', () => asignarInspC3(b.dataset.asig)));
  } catch (e) { cont.innerHTML = `<div class="vacio">No se pudo cargar: ${esc(e.message)}</div>`; }
}
async function detalleInspC3(id) {
  const h = abrirHoja('<div class="vacio">Cargando…</div>');
  try {
    const det = await rpc('inspeccion_detalle', { p_inspeccion: id });
    if (!det) { h.innerHTML = '<div class="vacio">No se encontró la inspección.</div>'; return; }
    const fs = det.fallas || [];
    h.innerHTML = `<h2>${esc(det.inspeccion.ito_nombre)} · ${esc(fmtFechaCorta(det.inspeccion.fecha))}</h2>
      <div class="hint">${fs.length} falla${fs.length === 1 ? '' : 's'} en total. Las de otros contratos se ven en gris.</div>
      ${fs.map((f) => `<div class="tarjeta est-${esc(f.estado)}" style="margin-top:8px;${f.mi_contrato ? '' : ' opacity:.45; filter:grayscale(1);'}">
        <div class="tarjeta-top"><b>${esc(f.tipo_falla)} · ${esc(DESC_CODIGO[f.tipo_falla] || '')}</b></div>
        <div class="sub">OS ${esc(f.ot || '—')} · ${f.tipo === 'linea' ? 'Circuito ' + esc(f.circuito_id ?? '—') : 'Llave ' + esc(f.llave ?? '—')} · <span class="insignia ${esc(f.estado)}">${esc(ETIQUETA_ESTADO[f.estado] || f.estado)}</span></div>
        ${f.contrato_nombre ? `<div class="sub">${esc(f.contrato_nombre)}${f.asignado_camion ? ' · Asignada a ' + esc(f.asignado_camion) : ''}</div>` : ''}
      </div>`).join('')}`;
  } catch (e) { h.innerHTML = `<div class="vacio">Error: ${esc(e.message)}</div>`; }
}
async function asignarInspC3(id) {
  const h = abrirHoja('<div class="vacio">Cargando…</div>');
  try {
    const [det, camiones] = await Promise.all([rpc('inspeccion_detalle', { p_inspeccion: id }), rpc('listar_camiones_contrato', {})]);
    const propias = ((det && det.fallas) || []).filter((f) => f.mi_contrato && f.estado !== 'reparada');
    const sin = propias.filter((f) => !f.asignado_camion_id).length, ya = propias.length - sin;
    if (!propias.length) { h.innerHTML = '<div class="vacio">No hay fallas de tu contrato por asignar en esta inspección.</div>'; return; }
    if (!camiones || !camiones.length) { h.innerHTML = '<div class="vacio">No hay camiones asociados a tu contrato.</div>'; return; }
    h.innerHTML = `<h2>🚚 Asignar a camión</h2>
      <div class="hint">${esc(det.inspeccion.ito_nombre)} · ${esc(fmtFechaCorta(det.inspeccion.fecha))}<br>${propias.length} falla${propias.length === 1 ? '' : 's'} de tu contrato sin reparar: ${sin} sin asignar, ${ya} ya asignada${ya === 1 ? '' : 's'}.</div>
      <label class="hint" for="icCamion">Camión</label>
      <select id="icCamion" style="width:100%; padding:10px; margin-bottom:10px;">${camiones.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}</select>
      ${ya ? `<div class="hint"><b>${ya} ya ${ya === 1 ? 'tiene' : 'tienen'} camión. ¿Volver a asignar?</b></div>
        <label style="display:flex; gap:6px; margin:6px 0;"><input type="radio" name="icModo" value="vacias" checked> No, solo las que están sin camión (${sin})</label>
        <label style="display:flex; gap:6px; margin:6px 0;"><input type="radio" name="icModo" value="todas"> Sí, reasignar todas (${propias.length})</label>` : ''}
      <div class="acciones"><button class="btn btn-primario" id="icOk">Asignar</button></div>`;
    $('#icOk').addEventListener('click', async () => {
      const btn = $('#icOk'); btn.disabled = true;
      const r = h.querySelector('input[name="icModo"]:checked');
      try {
        const n = await rpc('asignar_camion_inspeccion', { p_inspeccion: id, p_camion: $('#icCamion').value, p_sobrescribir: !!r && r.value === 'todas' });
        cerrarHoja(); toast(`${n} falla${n === 1 ? '' : 's'} asignada${n === 1 ? '' : 's'}`);
        if (typeof cargarArea === 'function') cargarArea();
      } catch (e) { btn.disabled = false; toast('No se pudo asignar: ' + e.message, 'error'); }
    });
  } catch (e) { h.innerHTML = `<div class="vacio">Error: ${esc(e.message)}</div>`; }
}
$('#navInspC3').addEventListener('click', () => cambiarVista('insp'));

/* ------------------------- notificaciones push ------------------------- */
const LS_PUSH_NO = 'fm_push_no_v1';
const pushSoportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function b64aBytes(b64) {
  const p = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function suscripcionActual() {
  if (!pushSoportado()) return null;
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 3000))]);
  return reg ? reg.pushManager.getSubscription() : null;
}
async function registrarSuscripcion(sub) {
  const j = sub.toJSON();
  await rpc('registrar_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent });
}
async function activarPush() {
  if (!pushSoportado()) throw new Error('Este navegador no permite notificaciones.');
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error('No diste permiso. Puedes activarlo en los ajustes del navegador (permisos del sitio).');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const clave = await rpc('clave_publica_push', {});
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(clave) });
  }
  await registrarSuscripcion(sub);
  try { localStorage.removeItem(LS_PUSH_NO); } catch (e) { /* */ }
}
async function desactivarPush() {
  const sub = await suscripcionActual();
  if (!sub) return;
  const ep = sub.endpoint;
  await rpc('quitar_push', { p_endpoint: ep }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
// Al entrar: si ya hay permiso, se vuelve a registrar el teléfono para este usuario; si no, se ofrece activarlo una vez.
async function iniciarPush() {
  if (!pushSoportado() || !S.perfil) return;
  try {
    if (Notification.permission === 'granted') {
      let sub = await suscripcionActual();
      if (!sub) {
        // El permiso sigue dado pero el teléfono perdió la suscripción: se vuelve a crear sin molestar al usuario.
        const reg = await navigator.serviceWorker.ready;
        const clave = await rpc('clave_publica_push', {});
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(clave) });
      }
      await registrarSuscripcion(sub);
      return;
    }
    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(LS_PUSH_NO)) return;
    setTimeout(() => {
      if (hojaAbierta || !S.perfil) return;
      const h = abrirHoja(`<h2>¿Activar avisos?</h2>
        <p class="hint" style="font-size:15px;margin-top:8px">Te avisaremos en este teléfono cuando corresponda a tu perfil (fallas nuevas, asignaciones o reparaciones), incluso con la app cerrada.</p>
        <div class="acciones"><button id="pOk" class="btn btn-primario">Activar avisos</button><button id="pNo" class="btn btn-secundario">Ahora no</button></div>`);
      $('#pOk', h).addEventListener('click', ocupar($('#pOk', h), async () => { await activarPush(); cerrarHoja(); toast('Avisos activados', 'ok'); }));
      $('#pNo', h).addEventListener('click', () => { try { localStorage.setItem(LS_PUSH_NO, '1'); } catch (e) { /* */ } cerrarHoja(); });
    }, 1500);
  } catch (e) { /* los avisos son opcionales */ }
}

/* ------------------------- gestión de usuarios (solo admin) ------------------------- */
// Pantalla completa con 3 pestañas (Usuarios · Contratos · Notificadores). Se edita en una hoja inferior.
const ROLES_LISTA = ['admin', 'ito', 'ito2', 'contratista', 'contratista2', 'contratista3', 'camion', 'observador'];
const ROL_ETQ = { admin: 'Admin', ito: 'ITO', ito2: 'ITO 2', contratista: 'Contratista', contratista2: 'Contratista 2', contratista3: 'Contratista 3', camion: 'Camión', observador: 'Observador' };
const ROL_CLASE = { admin: 'u-r-adm', ito: 'u-r-ito', ito2: 'u-r-ito', contratista: 'u-r-con', contratista2: 'u-r-con', contratista3: 'u-r-con', camion: 'u-r-cam', observador: 'u-r-obs' };
const ROLES_CON_NOTIF = ['admin', 'ito', 'ito2', 'contratista2', 'contratista3'];
const ROLES_CON_FOTO = ['contratista', 'contratista2', 'contratista3', 'camion'];
const ROLES_CON_CONTRATO = ['contratista', 'contratista2', 'contratista3', 'camion'];
const COLORES_AV = ['#2b6a55', '#c77a1a', '#6a5acd', '#1d4f91', '#a23b72', '#3a7d8c', '#8a5a2b'];
const colorAv = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORES_AV[h % COLORES_AV.length]; };
const FILTROS_USR = [
  ['todos', 'Todos', () => true],
  ['contratistas', 'Contratistas', (u) => u.rol === 'contratista' || u.rol === 'contratista2' || u.rol === 'contratista3'],
  ['camiones', 'Camiones', (u) => u.rol === 'camion'],
  ['ito', 'ITO', (u) => u.rol === 'ito' || u.rol === 'ito2'],
  ['otros', 'Otros', (u) => u.rol === 'admin' || u.rol === 'observador'],
];
const U = { tab: 'usuarios', usuarios: [], rel: {}, contratos: [], notifs: [], conteo: null, q: '', filtro: 'todos' };
let usrHist = false, usrVolviendo = false;
const normTxt = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const sinContratoU = (u) => ROLES_CON_CONTRATO.includes(u.rol) && u.rol !== 'camion' && !(U.rel[u.id] || []).length;
const msgNotif = (e) => {
  const m = String((e && e.message) || e);
  if (/duplicate key|notificadores_nombre_norm_uq/i.test(m)) return 'Ya existe un notificador con ese nombre. Si es la misma persona, usa «Fusionar».';
  if (/foreign key|fallas_notificador_id_fkey/i.test(m)) return 'No se puede eliminar: tiene fallas asociadas. Desactívalo o fusiónalo.';
  if (/notificadores_nombre_largo/i.test(m)) return 'El nombre debe tener entre 2 y 60 caracteres.';
  return m;
};
const msgContrato = (e) => (/duplicate|unique|contratos_nombre/i.test(e.message) ? 'Ya existe un contrato con ese nombre.' : e.message);

async function cargarUsuariosAdmin() {
  const [us, cs, rel, ns] = await Promise.all([
    select('usuarios', 'select=id,nombre,rol,email,notificador_externo_habilitado,foto_obligatoria&order=nombre.asc'),
    select('contratos', 'select=id,nombre,activo,defecto_para&order=nombre.asc').catch(() => []),
    select('usuario_contratos', 'select=usuario_id,contrato_id').catch(() => []),
    select('notificadores', 'select=id,nombre,validado,activo,usuario_id,fallas(count)&order=nombre.asc').catch(() => []),
  ]);
  U.usuarios = us; U.contratos = cs; U.rel = {};
  rel.forEach((r) => { (U.rel[r.usuario_id] = U.rel[r.usuario_id] || []).push(r.contrato_id); });
  U.notifs = ns.map((n) => ({ ...n, nFallas: (n.fallas && n.fallas[0] && n.fallas[0].count) || 0 }));
  U.notifs.sort((a, b) => (a.validado - b.validado) || a.nombre.localeCompare(b.nombre, 'es'));
}
async function cargarConteoContratos() {
  const m = {};
  for (let d = 0; d < 30000; d += 1000) {
    const f = await select('fallas', `select=contrato_id,estado&cascada=eq.false&order=id&limit=1000&offset=${d}`);
    f.forEach((x) => { const k = x.contrato_id || 'sin'; const c = m[k] || (m[k] = { t: 0, a: 0 }); c.t++; if (x.estado !== 'reparada') c.a++; });
    if (f.length < 1000) break;
  }
  U.conteo = m;
}

function abrirUsuarios() {
  if (rol() !== 'admin') return;
  cerrarHoja(true);                      // el menú ya dejó una entrada en el historial: la reutiliza esta pantalla
  usrHist = true;
  U.tab = 'usuarios'; U.q = ''; U.filtro = 'todos'; U.conteo = null;
  $('#pantallaUsuarios').hidden = false;
  $('#uCuerpo').innerHTML = '<div class="u-vacio">Cargando…</div>';
  pintarTabsU();
  cargarUsuariosAdmin().then(() => pintarU()).catch((e) => { $('#uCuerpo').innerHTML = `<div class="u-vacio">No se pudo cargar: ${esc(e.message)}</div>`; });
}
function cerrarUsuarios(desdePop) {
  if ($('#pantallaUsuarios').hidden) return;
  $('#pantallaUsuarios').hidden = true;
  if (!desdePop && usrHist) { usrVolviendo = true; try { history.back(); } catch (e) { usrVolviendo = false; } }
  usrHist = false;
}
window._usrPop = () => { if (usrVolviendo) { usrVolviendo = false; return; } if (!$('#pantallaUsuarios').hidden) cerrarUsuarios(true); };
const formUsuarios = abrirUsuarios;

function pintarTabsU() {
  const pend = U.notifs.filter((n) => !n.validado).length;
  $('#uTabs').innerHTML = [['usuarios', 'Usuarios'], ['contratos', 'Contratos'], ['notificadores', 'Notificadores'], ['ajustes', 'Ajustes']]
    .map(([k, t]) => `<button type="button" data-tab="${k}" class="${U.tab === k ? 'on' : ''}">${t}${k === 'notificadores' && pend ? `<b>${pend}</b>` : ''}</button>`).join('');
}
function pintarU() {
  pintarTabsU();
  if (U.tab === 'usuarios') pintarListaU();
  else if (U.tab === 'contratos') pintarContratosU();
  else if (U.tab === 'ajustes') pintarAjustesU();
  else pintarNotifsU();
}


/* --- Ajustes: interruptor del suministro eléctrico (Enel) --- */
const horaU = (iso) => { try { return new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } };
async function pintarAjustesU() {
  const cuerpo = $('#uCuerpo');
  cuerpo.innerHTML = '<div class="u-vacio">Cargando…</div>';
  let est;
  try { est = await rpc('suministro_estado', {}); }
  catch (e) { if (U.tab === 'ajustes') cuerpo.innerHTML = '<div class="u-nota">⚡ Suministro eléctrico (Enel): no disponible. Falta ejecutar sql/2026-10-suministro-interruptor.sql en Supabase.</div>'; return; }
  if (U.tab !== 'ajustes') return;
  const verDist = suminVer || (suminPuedeAvisos() && suminAvisosVer);
  cuerpo.innerHTML = `<div class="u-card-s"><h4>🗺️ En mi mapa</h4>
      <button type="button" class="u-tog ${verDist ? 'on' : ''}" data-a="sumver"><span class="u-tx"><b>Fallas de distribución (Enel)</b><span>${verDist ? 'Visibles: transformadores y avisos' : 'Ocultas en este teléfono'}</span></span><span class="u-sw ${verDist ? 'on' : ''}"></span></button>
      <div class="u-nota" style="margin:6px 0 0">Solo afecta a este teléfono. No apaga la lectura de Enel para los demás.</div></div>
    <div class="u-nota">Muestra el indicador y los transformadores sin suministro en el mapa, para todos los usuarios. Apagado: no se consulta a Enel y el indicador se oculta para todos.</div>
    <div class="u-card-s"><h4>⚡ Suministro eléctrico (Enel)</h4>
      <button type="button" class="u-tog ${est.activo ? 'on' : ''}" data-a="sumtog"><span class="u-tx"><b>Lectura de datos de Enel</b><span>${est.activo ? 'Activo' : 'Apagado'}</span></span><span class="u-sw ${est.activo ? 'on' : ''}"></span></button>
      <div class="u-kv"><span>Última lectura</span><b>${est.ultima_lectura ? esc(horaU(est.ultima_lectura)) : '—'}</b></div>
      <button type="button" class="u-btn" data-a="sumact">↻ Actualizar datos ahora</button>
      <div class="u-kv"><span>Se consulta cada</span><b>${esc(est.cada_min)} min</b></div>
      <div class="u-kv"><span>Transformadores en La Florida</span><b>${esc(est.trafos)}</b></div>
      <div class="u-kv"><span>Avisos de clientes en La Florida</span><b>${esc(est.avisos ?? 0)}</b></div>
      <div class="u-kv"><span>Último error</span><b>${est.error ? esc(est.error) : 'Ninguno'}</b></div></div>`;
}

/* --- Usuarios --- */
function tarjetaUsuarioU(u) {
  const cs = (U.rel[u.id] || []).map((id) => U.contratos.find((c) => c.id === id)).filter(Boolean);
  const aplica = ROLES_CON_CONTRATO.includes(u.rol);
  let cont;
  if (!aplica) cont = '<span class="u-em">Ve todos los contratos</span>';
  else if (!cs.length) cont = u.rol === 'camion' ? '<span class="u-em">Sin contrato asignado</span>' : '<span class="u-tg u-t-sin">⚠ Sin contrato</span>';
  else cont = cs.map((c) => `<span class="u-tg ${c.defecto_para === 'masivo' ? 'u-t-ele' : 'u-t-enel'}">${esc(c.nombre)}</span>`).join('');
  const ic = [ROLES_CON_NOTIF.includes(u.rol) && u.notificador_externo_habilitado ? '🔔' : '', ROLES_CON_FOTO.includes(u.rol) && u.foto_obligatoria ? '📷' : ''].filter(Boolean).join(' ');
  return `<button type="button" class="u-card" data-uid="${esc(u.id)}"><span class="u-ini" style="background:${colorAv(u.nombre)}">${esc(iniciales(u.nombre))}</span>
    <span class="u-mid"><span class="u-nm">${esc(u.nombre || '—')} <span class="u-rol ${ROL_CLASE[u.rol] || ''}">${esc(ROL_ETQ[u.rol] || u.rol)}</span></span>
    <span class="u-em">${esc(u.email || '—')}</span><span>${cont}${ic ? `<span class="u-ic">${ic}</span>` : ''}</span></span><span class="u-chev">›</span></button>`;
}
function pintarListaU() {
  const nSin = U.usuarios.filter(sinContratoU).length;
  const q = normTxt(U.q);
  const f = FILTROS_USR.find((x) => x[0] === U.filtro);
  const lista = U.usuarios.filter((u) => (U.filtro === 'sin' ? sinContratoU(u) : f[2](u)) && (!q || normTxt(u.nombre + ' ' + (u.email || '')).includes(q)));
  const chips = FILTROS_USR.map(([k, t, fn]) => `<button type="button" class="u-chip ${U.filtro === k ? 'on' : ''}" data-f="${k}">${t} ${U.usuarios.filter(fn).length}</button>`).join('')
    + (nSin ? `<button type="button" class="u-chip ${U.filtro === 'sin' ? 'on' : ''}" data-f="sin">Sin contrato ${nSin}</button>` : '');
  $('#uCuerpo').innerHTML = `${nSin && U.filtro !== 'sin' ? `<div class="u-alerta"><span>⚠️</span><span><b>${nSin} contratista${nSin > 1 ? 's' : ''} sin contrato</b>: hoy no ve${nSin > 1 ? 'n' : ''} ninguna falla.</span><button type="button" data-f="sin">Ver ›</button></div>` : ''}
    <input id="uBuscar" class="u-buscar" type="search" placeholder="Buscar nombre o correo" autocomplete="off" value="${esc(U.q)}">
    <div class="u-chips">${chips}</div><div id="uLista">${lista.map(tarjetaUsuarioU).join('') || '<div class="u-vacio">Sin resultados.</div>'}</div>`;
  const b = $('#uBuscar');
  b.addEventListener('input', () => { U.q = b.value; const q2 = normTxt(U.q); const fx = FILTROS_USR.find((x) => x[0] === U.filtro);
    const l2 = U.usuarios.filter((u) => (U.filtro === 'sin' ? sinContratoU(u) : fx[2](u)) && (!q2 || normTxt(u.nombre + ' ' + (u.email || '')).includes(q2)));
    $('#uLista').innerHTML = l2.map(tarjetaUsuarioU).join('') || '<div class="u-vacio">Sin resultados.</div>'; });
}

function editarUsuarioU(id) {
  const u = U.usuarios.find((x) => x.id === id); if (!u) return;
  const orig = { nombre: u.nombre || '', rol: u.rol, notif: !!u.notificador_externo_habilitado, foto: !!u.foto_obligatoria, contr: (U.rel[id] || []).slice().sort() };
  const ed = { ...orig, contr: new Set(orig.contr) };
  const estado = () => ({ nombre: ed.nombre.trim(), rol: ed.rol, notif: ROLES_CON_NOTIF.includes(ed.rol) && ed.notif, foto: ROLES_CON_FOTO.includes(ed.rol) && ed.foto, contr: ROLES_CON_CONTRATO.includes(ed.rol) ? [...ed.contr].sort() : [] });
  const h = abrirHoja(`<div class="u-sh"><span class="u-ini" style="background:${colorAv(u.nombre)};width:46px;height:46px">${esc(iniciales(u.nombre))}</span><div><div class="u-nm" style="font-size:17px">${esc(u.nombre || '—')}</div><div class="u-em">${esc(u.email || '—')}</div></div></div>
    <div class="u-lbl" style="margin-top:2px">Nombre</div><input id="eNom" class="campo" value="${esc(orig.nombre)}" maxlength="80" autocomplete="off">
    <div id="eDin"></div>
    <button type="button" id="eReset" class="btn btn-ambar" style="width:100%;margin-top:12px" ${u.email ? '' : 'disabled'}>Enviar reseteo de contraseña</button>
    <div class="acciones fija" style="display:flex;gap:8px"><button type="button" id="eCancel" class="btn btn-secundario" style="flex:1">Cancelar</button><button type="button" id="eOk" class="btn btn-primario" style="flex:1;margin-top:0" disabled>Guardar cambios</button></div>`);
  const pintarDin = () => {
    const act = U.contratos.filter((c) => c.activo || ed.contr.has(c.id));
    const aplicaC = ROLES_CON_CONTRATO.includes(ed.rol);
    $('#eDin', h).innerHTML = `<div class="u-lbl">Rol</div><div class="u-seg">${ROLES_LISTA.map((r) => `<button type="button" data-r="${r}" class="${ed.rol === r ? 'on' : ''}">${esc(ROL_ETQ[r])}</button>`).join('')}</div>
      ${aplicaC ? `<div class="u-lbl">Contratos <span style="text-transform:none;font-weight:500">· solo verá fallas de estos</span></div>
        ${act.map((c) => `<button type="button" class="u-tog ${ed.contr.has(c.id) ? 'on' : ''}" data-c="${c.id}"><span class="u-cb ${ed.contr.has(c.id) ? 'on' : ''}">✓</span><span class="u-tx"><b>${esc(c.nombre)}</b><span>${c.defecto_para === 'masivo' ? 'Fallas Masivo' : c.defecto_para === 'normal' ? 'Fallas normales' : 'Sin tipo por defecto'}${c.activo ? '' : ' · inactivo'}</span></span></button>`).join('') || '<div class="u-em">Aún no hay contratos creados.</div>'}
        ${ed.rol !== 'camion' && act.length && !ed.contr.size ? '<div class="u-aviso">Sin contratos no verá ninguna falla.</div>' : ''}` : '<div class="u-em" style="margin-top:12px">Este rol ve todos los contratos.</div>'}
      ${ROLES_CON_NOTIF.includes(ed.rol) ? `<button type="button" class="u-tog ${ed.notif ? 'on' : ''}" data-s="notif" style="margin-top:10px"><span class="u-tx"><b>🔔 Notificador externo y fecha</b><span>Puede informar fallas a nombre de otras personas</span></span><span class="u-sw ${ed.notif ? 'on' : ''}"></span></button>` : ''}
      ${ROLES_CON_FOTO.includes(ed.rol) ? `<button type="button" class="u-tog ${ed.foto ? 'on' : ''}" data-s="foto" style="margin-top:10px"><span class="u-tx"><b>📷 Foto obligatoria al reparar</b></span><span class="u-sw ${ed.foto ? 'on' : ''}"></span></button>` : ''}`;
    const ok = $('#eOk', h), cambios = JSON.stringify(estado()) !== JSON.stringify({ nombre: orig.nombre.trim(), rol: orig.rol, notif: ROLES_CON_NOTIF.includes(orig.rol) && orig.notif, foto: ROLES_CON_FOTO.includes(orig.rol) && orig.foto, contr: ROLES_CON_CONTRATO.includes(orig.rol) ? orig.contr : [] });
    ok.disabled = !cambios;
  };
  pintarDin();
  $('#eNom', h).addEventListener('input', (e) => { ed.nombre = e.target.value; pintarDin(); });
  ed.nombre = orig.nombre;
  $('#eDin', h).addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.r) ed.rol = b.dataset.r;
    else if (b.dataset.c) { if (ed.contr.has(b.dataset.c)) ed.contr.delete(b.dataset.c); else ed.contr.add(b.dataset.c); }
    else if (b.dataset.s) ed[b.dataset.s] = !ed[b.dataset.s];
    pintarDin();
  });
  $('#eCancel', h).addEventListener('click', () => cerrarHoja());
  const rs = $('#eReset', h);
  rs.addEventListener('click', ocupar(rs, async () => {
    if (!confirm(`¿Enviar un correo de recuperación de clave a ${u.email}?`)) return;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, { method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email }) });
    if (!r.ok) throw new Error('No se pudo enviar el reseteo.');
    toast('Correo de recuperación enviado', 'ok');
  }));
  const ok = $('#eOk', h);
  ok.addEventListener('click', ocupar(ok, async () => {
    const e = estado();
    if (!e.nombre) { toast('El nombre no puede quedar vacío.', 'error'); return; }
    ok.textContent = 'Guardando…';
    const r = await api(`/rest/v1/usuarios?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: { nombre: e.nombre, rol: e.rol, notificador_externo_habilitado: e.notif, foto_obligatoria: e.foto } });
    if (!r || !r.length) throw new Error('No se guardó (¿sin permiso?)');
    Object.assign(u, { nombre: e.nombre, rol: e.rol, notificador_externo_habilitado: e.notif, foto_obligatoria: e.foto });
    const antes = ROLES_CON_CONTRATO.includes(orig.rol) ? orig.contr : [];
    if (JSON.stringify(antes) !== JSON.stringify(e.contr)) { await rpc('set_contratos_usuario', { p_usuario: id, p_contratos: e.contr }); U.rel[id] = e.contr; }
    if (id === S.perfil.id) { S.perfil.nombre = e.nombre; S.perfil.rol = e.rol; S.perfil.foto_obligatoria = e.foto; $('#barraNombre').textContent = e.nombre; $('#barraAvatar').textContent = iniciales(e.nombre); $('#barraRol').textContent = rolVisible(); }
    cerrarHoja(); pintarU(); toast('Usuario guardado', 'ok');
  }));
}

/* --- Contratos --- */
function pintarContratosU() {
  const cn = U.conteo;
  const usrDe = (id) => U.usuarios.filter((u) => (U.rel[u.id] || []).includes(id)).length;
  $('#uCuerpo').innerHTML = `<div class="u-nota">El contrato «por defecto» se asigna solo a las fallas nuevas. Uno para Masivo y otro para las normales. Un contrato inactivo deja de ofrecerse al asignar.</div>
    ${U.contratos.map((c) => { const k = cn && (cn[c.id] || { t: 0, a: 0 }); return `<div class="u-ctr" data-id="${c.id}">
      <h4>${esc(c.nombre)} ${c.defecto_para ? `<span class="u-tg ${c.defecto_para === 'masivo' ? 'u-t-ele' : 'u-t-enel'}" style="margin:0">${c.defecto_para === 'masivo' ? 'Masivo' : 'Normales'}</span>` : ''}<button type="button" class="u-mini" data-a="ren" style="margin-left:auto">Renombrar</button></h4>
      <div class="u-kpis"><div><b>${usrDe(c.id)}</b>usuarios</div><div><b>${k ? k.t : '…'}</b>fallas</div><div><b>${k ? k.a : '…'}</b>abiertas</div></div>
      <label class="u-sel"><span>Por defecto para:</span><select data-a="def"><option value="" ${!c.defecto_para ? 'selected' : ''}>Ninguno</option><option value="masivo" ${c.defecto_para === 'masivo' ? 'selected' : ''}>Fallas Masivo</option><option value="normal" ${c.defecto_para === 'normal' ? 'selected' : ''}>Fallas normales</option></select></label>
      <button type="button" class="u-tog ${c.activo ? 'on' : ''}" data-a="act" style="margin:10px 0 0"><span class="u-tx"><b>Activo</b></span><span class="u-sw ${c.activo ? 'on' : ''}"></span></button></div>`; }).join('') || '<div class="u-vacio">Todavía no hay contratos.</div>'}
    <button type="button" class="u-fab" data-a="nuevo">＋ Nuevo contrato</button>`;
  if (!cn) cargarConteoContratos().then(() => { if (U.tab === 'contratos' && !$('#pantallaUsuarios').hidden) pintarContratosU(); }).catch(() => { U.conteo = {}; });
}
function hojaTextoU(titulo, valor, boton, ph, fn) {
  const h = abrirHoja(`<h2>${esc(titulo)}</h2><input id="tTxt" class="campo" style="margin-top:12px" value="${esc(valor)}" placeholder="${esc(ph)}" maxlength="60" autocomplete="off">
    <div class="acciones fija"><button type="button" id="tOk" class="btn btn-primario" style="width:100%;margin-top:0">${esc(boton)}</button></div>`);
  const ok = $('#tOk', h);
  ok.addEventListener('click', ocupar(ok, async () => { const v = $('#tTxt', h).value.trim().replace(/\s+/g, ' '); if (v.length < 2) { toast('Escribe al menos 2 letras.', 'error'); return; } await fn(v); }));
  setTimeout(() => { const t = $('#tTxt', h); if (t) t.focus(); }, 250);
}
async function cambiarContratoU(c, cambios) {
  const r = await api(`/rest/v1/contratos?id=eq.${c.id}`, { method: 'PATCH', prefer: 'return=representation', body: cambios });
  if (!r || !r.length) throw new Error('No se guardó (¿sin permiso?)');
  Object.assign(c, cambios);
}
function nuevoContratoU() {
  hojaTextoU('Nuevo contrato', '', 'Crear contrato', 'Nombre del contrato', async (nombre) => {
    try {
      const r = await api('/rest/v1/contratos', { method: 'POST', prefer: 'return=representation', body: { nombre } });
      U.contratos.push(r[0]); U.contratos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      cerrarHoja(); pintarU(); toast('Contrato creado', 'ok');
    } catch (e) { throw new Error(msgContrato(e)); }
  });
}

/* --- Notificadores --- */
function pintarNotifsU() {
  const nomU = Object.fromEntries(U.usuarios.map((u) => [u.id, u.nombre]));
  $('#uCuerpo').innerHTML = `<div class="u-sh" style="gap:6px;margin-bottom:10px"><input id="nNuevo" class="u-buscar" style="margin:0;flex:1" maxlength="60" placeholder="Nombre y apellido…" autocomplete="off"><button type="button" class="u-mini g" data-a="add" style="padding:0 14px">Agregar</button></div>
    ${U.notifs.map((n) => `<div class="u-nrow ${n.validado ? '' : 'sin'}" data-id="${n.id}"><div class="u-top"><b>${esc(n.nombre)}</b>
      ${n.usuario_id ? `<span class="u-tg u-t-ok">Vinculada · ${esc(nomU[n.usuario_id] || 'usuario')}</span>` : n.validado ? '<span class="u-tg u-t-ok">Validado</span>' : '<span class="u-tg u-t-sin">Sin validar</span>'}${n.activo ? '' : '<span class="u-tg u-t-off">Desactivado</span>'}
      <span class="u-n">${n.nFallas} falla${n.nFallas === 1 ? '' : 's'}</span></div>
      <div class="u-acts">${n.validado ? '' : '<button type="button" class="u-mini g" data-a="val">Validar</button>'}
      ${n.usuario_id ? '' : '<button type="button" class="u-mini" data-a="vinc">Vincular a usuario</button>'}
      ${U.notifs.length > 1 ? '<button type="button" class="u-mini" data-a="fus">Fusionar</button>' : ''}
      <button type="button" class="u-mini" data-a="ren">Renombrar</button>
      <button type="button" class="u-mini a" data-a="act">${n.activo ? 'Desactivar' : 'Reactivar'}</button>
      <button type="button" class="u-mini r" data-a="del" ${n.nFallas ? 'disabled' : ''}>Eliminar</button></div></div>`).join('') || '<div class="u-vacio">Aún no hay notificadores. Agrega el primero arriba.</div>'}`;
}
async function accionNotifU(fn, ok) {
  try { await fn(); } catch (e) { toast(msgNotif(e), 'error'); return; }
  try { await cargarUsuariosAdmin(); } catch (e) { /* */ }
  cerrarHojaSiAbierta(); pintarU(); if (ok) toast(ok, 'ok');
}
function cerrarHojaSiAbierta() { if (hojaAbierta) cerrarHoja(); }
function hojaSelectU(titulo, texto, opciones, boton, fn) {
  const h = abrirHoja(`<h2>${esc(titulo)}</h2><div class="hint" style="margin:4px 0 10px">${esc(texto)}</div>
    <select id="sSel" class="campo"><option value="">Elige…</option>${opciones.map((o) => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select>
    <div class="acciones fija"><button type="button" id="sOk" class="btn btn-primario" style="width:100%;margin-top:0">${esc(boton)}</button></div>`);
  const ok = $('#sOk', h);
  ok.addEventListener('click', ocupar(ok, async () => { const v = $('#sSel', h).value; if (!v) { toast('Elige una opción.', 'error'); return; } await fn(v, $('#sSel', h).selectedOptions[0].textContent); }));
}

/* --- eventos de la pantalla --- */
$('#uAtras').addEventListener('click', () => cerrarUsuarios());
$('#uMas').addEventListener('click', () => {
  if (U.tab === 'contratos') nuevoContratoU();
  else if (U.tab === 'notificadores') { const i = $('#nNuevo'); if (i) i.focus(); }
  else toast('Los usuarios nuevos se crean en Supabase (Authentication → Add user).', '');
});
$('#uTabs').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-tab]'); if (!b) return; U.tab = b.dataset.tab; pintarU(); $('#uCuerpo').scrollTop = 0; });
$('#uCuerpo').addEventListener('click', async (ev) => {
  const t = ev.target;
  const f = t.closest('[data-f]'); if (f) { U.filtro = f.dataset.f; pintarListaU(); return; }
  const card = t.closest('.u-card'); if (card) { editarUsuarioU(card.dataset.uid); return; }
  const b = t.closest('[data-a]'); if (!b || b.tagName === 'SELECT') return;
  const fila = b.closest('[data-id]'); const id = fila ? fila.dataset.id : null;
  const a = b.dataset.a;
  if (a === 'nuevo') return nuevoContratoU();
  if (a === 'sumver') {
    const nuevo = !b.classList.contains('on');
    suminVer = nuevo; if (suminPuedeAvisos()) suminAvisosVer = nuevo;
    try { localStorage.setItem('fa_sum_trafos', suminVer ? '1' : '0'); if (suminPuedeAvisos()) localStorage.setItem('fa_sum_avisos', suminAvisosVer ? '1' : '0'); } catch (e) {}
    pintarTrafosSuministro(); pintarAvisosSuministro();
    b.classList.toggle('on', nuevo); const sw = b.querySelector('.u-sw'); if (sw) sw.classList.toggle('on', nuevo);
    const tx = b.querySelector('.u-tx span'); if (tx) tx.textContent = nuevo ? 'Visibles: transformadores y avisos' : 'Ocultas en este teléfono';
    return;
  }
  if (a === 'sumact') {
    b.disabled = true; b.textContent = 'Solicitando…';
    try { const r = await rpc('suministro_actualizar_ahora', {}); toast(r && r.ok === false ? 'La lectura de Enel está apagada' : 'Pedido a Enel: llegan en ~1 minuto', r && r.ok === false ? 'error' : 'ok'); setTimeout(() => { if (U.tab === 'ajustes') pintarAjustesU(); }, 70000); }
    catch (e) { toast(e.message, 'error'); }
    b.disabled = false; b.textContent = '↻ Actualizar datos ahora';
    return;
  }
  if (a === 'sumtog') {
    const quiere = !b.classList.contains('on');
    if (!quiere && !confirm('¿Apagar la lectura de Enel? El indicador y los transformadores se ocultarán para todos los usuarios.')) return;
    try { await rpc('suministro_set_activo', { p_activo: quiere }); await cargarSuministro(); toast(quiere ? 'Lectura de Enel activada' : 'Lectura de Enel apagada', 'ok'); pintarAjustesU(); }
    catch (e) { toast(e.message, 'error'); }
    return;
  }
  if (U.tab === 'contratos') {
    const c = U.contratos.find((x) => x.id === id); if (!c) return;
    if (a === 'act') { try { await cambiarContratoU(c, { activo: !c.activo }); pintarU(); } catch (e) { toast(msgContrato(e), 'error'); } }
    if (a === 'ren') hojaTextoU('Renombrar contrato', c.nombre, 'Guardar nombre', 'Nombre del contrato', async (v) => { try { await cambiarContratoU(c, { nombre: v }); cerrarHoja(); pintarU(); toast('Nombre guardado', 'ok'); } catch (e) { throw new Error(msgContrato(e)); } });
    return;
  }
  if (U.tab === 'notificadores') {
    if (a === 'add') {
      const inp = $('#nNuevo'); const nombre = inp.value.trim().replace(/\s+/g, ' ');
      if (nombre.length < 2) { toast('Escribe el nombre (mínimo 2 letras).', 'error'); return; }
      return accionNotifU(() => api('/rest/v1/notificadores', { method: 'POST', body: { nombre, validado: true, creado_por: S.perfil.id } }), 'Notificador agregado');
    }
    const n = U.notifs.find((x) => x.id === id); if (!n) return;
    if (a === 'val') return accionNotifU(() => api(`/rest/v1/notificadores?id=eq.${id}`, { method: 'PATCH', body: { validado: true } }), 'Validado');
    if (a === 'act') return accionNotifU(() => api(`/rest/v1/notificadores?id=eq.${id}`, { method: 'PATCH', body: { activo: !n.activo } }), n.activo ? 'Desactivado' : 'Reactivado');
    if (a === 'del') { if (!confirm(`¿Eliminar al notificador «${n.nombre}»?`)) return; return accionNotifU(() => api(`/rest/v1/notificadores?id=eq.${id}`, { method: 'DELETE' }), 'Eliminado'); }
    if (a === 'ren') return hojaTextoU('Renombrar notificador', n.nombre, 'Guardar nombre', 'Nombre y apellido', (v) => accionNotifU(() => api(`/rest/v1/notificadores?id=eq.${id}`, { method: 'PATCH', body: { nombre: v } }), 'Nombre guardado'));
    if (a === 'vinc') return hojaSelectU('Vincular a usuario', `«${n.nombre}» pasará a figurar como ese usuario y quedará validado.`,
      U.usuarios.filter((u) => ['ito', 'ito2', 'contratista', 'contratista2', 'contratista3', 'admin'].includes(u.rol)).map((u) => [u.id, u.nombre]), 'Vincular',
      (uid, nom) => { if (!confirm(`¿Vincular «${n.nombre}» con «${nom}»?`)) return; return accionNotifU(() => rpc('vincular_notificador_usuario', { p_notif: id, p_usuario: uid }), 'Vinculado'); });
    if (a === 'fus') return hojaSelectU('Fusionar con…', `Las ${n.nFallas} falla(s) de «${n.nombre}» pasarán al notificador que elijas y «${n.nombre}» se eliminará.`,
      U.notifs.filter((o) => o.id !== id).map((o) => [o.id, o.nombre]), 'Fusionar',
      (did, nom) => { if (!confirm(`¿Fusionar «${n.nombre}» en «${nom}»?`)) return; return accionNotifU(() => rpc('fusionar_notificadores', { p_origen: id, p_destino: did }), 'Fusionados'); });
  }
});
$('#uCuerpo').addEventListener('change', async (ev) => {
  const s = ev.target; if (!(s.tagName === 'SELECT' && s.dataset.a === 'def')) return;
  const c = U.contratos.find((x) => x.id === s.closest('[data-id]').dataset.id); if (!c) return;
  const nuevo = s.value || null;
  try {
    if (nuevo) await api(`/rest/v1/contratos?defecto_para=eq.${nuevo}&id=neq.${c.id}`, { method: 'PATCH', body: { defecto_para: null } });   // cada tipo tiene un solo contrato por defecto
    await cambiarContratoU(c, { defecto_para: nuevo });
    U.contratos.forEach((x) => { if (nuevo && x.id !== c.id && x.defecto_para === nuevo) x.defecto_para = null; });
    pintarU(); toast('Guardado', 'ok');
  } catch (e) { toast(msgContrato(e), 'error'); pintarU(); }
});

/* ------------------------- inspección (ITO, ITO2, admin) ------------------------- */
function pintarModo() {
  $('#navInspC3').hidden = rol() !== 'contratista3';
  const puede = PUEDE_MODO_INSPECCION.includes(rol());
  const c = $('#chipModo'), n = $('#navInsp');
  n.hidden = !puede;
  if (!puede) { c.hidden = true; return; }
  const on = S.modo.tipo === 'inspeccion';
  n.classList.toggle('sel', on);
  c.hidden = !on;
  c.textContent = on ? `📋 Inspección del ${fmtFechaCorta(S.modo.fecha)} activa · toca para terminar` : '';
}
function guardarModo() {
  try {
    if (S.modo.tipo === 'inspeccion') localStorage.setItem(LS_MODO, JSON.stringify({ uid: S.perfil.id, fecha: S.modo.fecha, guardado: Date.now() }));
    else localStorage.removeItem(LS_MODO);
  } catch (e) { /* */ }
}
function restaurarModo() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_MODO) || 'null');
    if (!s || s.uid !== S.perfil.id || !PUEDE_MODO_INSPECCION.includes(rol())) return;
    const dias = Math.round((fechaChileLocal(hoyChileStr(), 12) - fechaChileLocal(s.fecha, 12)) / 86400000);
    const vencida = Date.now() - (s.guardado || 0) > 36 * 3600 * 1000 || s.fecha > hoyChileStr() || (rol() !== 'admin' && dias > DIAS_MAX_INSPECCION);
    if (vencida) { localStorage.removeItem(LS_MODO); return; }
    S.modo = { tipo: 'inspeccion', fecha: s.fecha, inspId: null };
  } catch (e) { /* */ }
}
function abrirInspeccion() {
  const on = S.modo.tipo === 'inspeccion';
  const h = abrirHoja(`
    <h2>Inspección</h2>
    <p class="hint" style="font-size:14px;margin-top:6px">Con la inspección activa, todas las fallas que reportes quedan dentro de ella (para la estadística), cada una con la fecha y hora exactas en que la registras. Si la inspección es nocturna y pasa de medianoche, conserva la fecha en que la iniciaste. Cualquier otro ajuste se hace en la página de escritorio.</p>
    ${on ? `<div class="aviso"><b>Inspección activa</b> iniciada el ${esc(fmtFechaCorta(S.modo.fecha))}</div>` : ''}
    <div class="acciones">
      ${on ? '<button id="mTerminar" class="btn btn-primario">Terminar inspección</button>' : '<button id="mInsp" class="btn btn-primario">Comenzar inspección</button>'}
    </div>`);
  const mi = $('#mInsp', h);
  if (mi) mi.addEventListener('click', ocupar(mi, async () => {
    const f = hoyChileStr();
    S.modo = { tipo: 'inspeccion', fecha: f, inspId: null };
    guardarModo(); pintarModo(); cerrarHoja();
    cambiarVista('mapa');
    toast(`Inspección del ${fmtFechaCorta(f)} activa. Toca un punto o circuito para reportar.`, 'ok');
  }));
  const mt = $('#mTerminar', h);
  if (mt) mt.addEventListener('click', () => {
    S.modo = { tipo: 'agregar', fecha: null, inspId: null }; guardarModo(); pintarModo(); cerrarHoja(); toast('Inspección terminada');
  });
}
$('#navInsp').addEventListener('click', abrirInspeccion);
$('#chipModo').addEventListener('click', abrirInspeccion);

/* ------------------------- abrir una falla desde un aviso ------------------------- */
async function abrirFallaPorId(id) {
  // Siempre se pide la falla actualizada: la copia en memoria puede estar vieja (p. ej. una falla recién reparada
  // aún figura como activa) y el aviso justamente llega cuando algo cambió. Si no hay red, se usa la copia local.
  let f = S.features.find((x) => x.properties.id === id);
  try {
    const geo = await rpc('fallas_geojson', { p_id: id });
    const fresca = geo && geo.features && geo.features[0];
    if (fresca) {
      fresca._c = centroGeom(fresca.geometry);
      const i = S.features.findIndex((x) => x.properties.id === id);
      if (i >= 0) S.features[i] = fresca; else S.features.push(fresca);
      S.activas = S.features.filter((x) => x.properties.estado !== 'reparada');
      f = fresca;
      cargarFallas(); // deja el mapa y la lista al día en segundo plano
    }
  } catch (e) {
    if (e.name === 'SesionExpirada') throw e;
  }
  if (!f) { toast('No se encontró la falla del aviso (puede haber sido eliminada).', 'error'); return; }
  cambiarVista('mapa');
  if (map && f._c) map.setView(f._c, Math.max(map.getZoom(), 18));
  abrirFalla(f.properties, f.geometry);
}
async function avisoPendienteSW(consumir) {
  try {
    if (!window.caches) return null;
    const c = await caches.open('fm-aviso');
    const r = await c.match('pendiente');
    if (!r) return null;
    if (consumir) await c.delete('pendiente');
    const d = await r.json();
    return d && d.id && /^[\w-]{1,64}$/.test(d.id) && Date.now() - (d.t || 0) < 120000 ? d.id : null;
  } catch (e) { return null; }
}
async function recogerAvisoPendiente() {
  if (!S.perfil) return;
  const id = await avisoPendienteSW(true);
  if (!id) return;
  S.fallaPendiente = id; cerrarHoja(); abrirPendienteDeAviso();
}
function fallaDeUrl() {
  try {
    const u = new URL(location.href), id = u.searchParams.get('falla');
    if (id) { u.searchParams.delete('falla'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); }
    return id && /^[\w-]{1,64}$/.test(id) ? id : null;
  } catch (e) { return null; }
}
async function abrirPendienteDeAviso() {
  const id = S.fallaPendiente; S.fallaPendiente = null;
  if (id) { try { await abrirFallaPorId(id); } catch (e) { toast('No se pudo abrir la falla del aviso.', 'error'); } }
}

/* ------------------------- actualización de la app ------------------------- */
// Borra copias guardadas y service worker, y recarga: deja la app idéntica a la publicada.
async function forzarActualizacion() {
  // Importante: NO se desinstala el service worker, porque eso borraría la suscripción a los avisos.
  try {
    if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); }
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        const nuevo = reg.installing || reg.waiting;
        if (nuevo && nuevo.state !== 'activated') await new Promise((res) => { nuevo.addEventListener('statechange', () => { if (nuevo.state === 'activated') res(); }); setTimeout(res, 8000); });
      }
    }
  } catch (e) { /* */ }
  location.reload();
}
// Compara la versión que corre con la publicada (sin usar copias guardadas) y avisa si hay una nueva.
async function revisarVersion() {
  try {
    const r = await fetch('app.js?v=' + Date.now(), { cache: 'no-store' });
    const m = (await r.text()).match(/const VERSION_APP = '([^']+)'/);
    if (!m || m[1] === VERSION_APP || S.avisoVersion) return;
    S.avisoVersion = true;
    const b = $('#avisoVersion');
    b.hidden = false;
    b.textContent = `Hay una versión nueva (${m[1]}). Toca aquí para actualizar.`;
    b.onclick = () => { b.textContent = 'Actualizando…'; forzarActualizacion(); };
  } catch (e) { /* sin conexión: se revisa después */ }
}

/* ------------------------------ menú ------------------------------ */
const iniciales = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const esStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
$('#btnMenu').addEventListener('click', () => {
  const ini = iniciales(S.perfil.nombre);
  const ico = (d) => `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const chev = '<svg class="m-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const h = abrirHoja(`
    <div class="m-cab">
      <div class="m-avatar">${esc(ini)}</div>
      <div><div class="m-nombre">${esc(S.perfil.nombre)}</div><span class="m-pastilla">${esc(rolVisible())} · v${VERSION_APP}</span></div>
    </div>
    <div class="m-lista">
      ${S.instalar ? '<button id="mInstalar" class="btn btn-primario" style="margin:10px 0 6px;width:100%">Instalar la app en este teléfono</button>' : ''}
      ${!S.instalar && esIOS() && !esStandalone() ? '<div class="aviso">Para instalarla en iPhone: toca el botón <b>Compartir</b> de Safari y luego <b>Añadir a pantalla de inicio</b>.</div>' : ''}
      <button id="mPush" class="m-fila" hidden><span class="m-ico m-ambar">${ico('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21h4"/>')}</span><span class="t">Avisos</span>${chev}</button>
      ${rol() === 'admin' ? `<button id="mUsuarios" class="m-fila"><span class="m-ico m-azul">${ico('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6"/><path d="M17 11h5M19.5 8.5v5"/>')}</span><span class="t">Gestionar usuarios</span>${chev}</button>` : ''}
      <button id="mActualizar" class="m-fila"><span class="m-ico m-verde">${ico('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')}</span><span class="t">Actualizar la app</span></button>
      <button id="mSalir" class="m-fila m-rojo"><span class="m-ico m-rojo-ico">${ico('<path d="M9 4H5v16h4"/><path d="M16 8l4 4-4 4M20 12H9"/>')}</span><span class="t">Cerrar sesión</span></button>
    </div>`);
  $('#hoja').classList.add('hoja-menu');
  const i = $('#mInstalar', h);
  if (i) i.addEventListener('click', async () => { S.instalar.prompt(); await S.instalar.userChoice; S.instalar = null; cerrarHoja(); });
  const mp = $('#mPush', h);
  if (pushSoportado()) {
    suscripcionActual().then((sub) => {
      if (!document.body.contains(mp)) return;
      const on = Notification.permission === 'granted' && !!sub;
      mp.hidden = false; $('.t', mp).textContent = on ? 'Desactivar avisos' : 'Activar avisos';
      mp.addEventListener('click', ocupar(mp, async () => {
        if (on) { await desactivarPush(); toast('Avisos desactivados', 'ok'); } else { await activarPush(); toast('Avisos activados', 'ok'); }
        cerrarHoja();
      }));
    }).catch(() => {});
  } else if (esIOS() && !esStandalone()) {
    mp.insertAdjacentHTML('afterend', '<div class="aviso">Para recibir avisos en iPhone, primero instala la app con <b>Añadir a pantalla de inicio</b>.</div>');
  }
  const mu = $('#mUsuarios', h);
  if (mu) mu.addEventListener('click', () => abrirUsuarios());
  $('#mActualizar', h).addEventListener('click', () => { $('#mActualizar', h).querySelector('.t').textContent = 'Actualizando…'; forzarActualizacion(); });
  $('#mSalir', h).addEventListener('click', async () => { try { await desactivarPush(); } catch (e) { /* */ } salir(); });
});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.instalar = e; });

/* ------------------------------ arranque ------------------------------ */
async function entrarApp() {
  if (typeof L === 'undefined') throw new Error('No se pudo cargar el mapa. Revisa tu conexión y recarga la página.');
  await cargarPerfil();
  $('#pantallaLogin').hidden = true;
  $('#pantallaApp').hidden = false;
  $('#barraNombre').textContent = S.perfil.nombre;
  $('#barraAvatar').textContent = iniciales(S.perfil.nombre);
  $('#barraRol').textContent = rolVisible();
  restaurarModo();
  pintarModo();
  S.vista = 'mapa';
  cambiarVista('mapa');
  iniciarMapa();
  iniciarSuministro();
  setTimeout(() => map.invalidateSize(), 80);
  cacheBbox = null;
  await cargarFallas();
  const habiaAviso = !!S.fallaPendiente;
  abrirPendienteDeAviso();
  if (!habiaAviso) restaurarBorrador();
  cargarArea(true);
  S.centrarAlFijar = true;
  iniciarGPS();
  iniciarPush();
  revisarVersion();
  clearInterval(S.timer);
  S.timer = setInterval(() => { if (!document.hidden && !hojaAbierta) cargarFallas(); }, REFRESCO_MS);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.perfil) { cargarFallas(); revisarVersion(); setTimeout(recogerAvisoPendiente, 400); } });
window.addEventListener('focus', () => setTimeout(recogerAvisoPendiente, 400));

(async function iniciar() {
  if ('serviceWorker' in navigator && navigator.serviceWorker.addEventListener) {
    const habiaControlador = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!habiaControlador || S.recargando) return;
      S.recargando = true;
      const recargar = () => { if (!hojaAbierta) location.reload(); else setTimeout(recargar, 3000); };
      toast('Nueva versión instalada. Actualizando…', 'ok'); setTimeout(recargar, 1200);
    });
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* sin SW: la app funciona igual */ });
  S.fallaPendiente = fallaDeUrl();
  if ('serviceWorker' in navigator && navigator.serviceWorker.addEventListener) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      const id = ev.data && ev.data.tipo === 'abrir-falla' && ev.data.id;
      if (!id || !/^[\w-]{1,64}$/.test(id)) return;
      S.fallaPendiente = id;
      avisoPendienteSW(true); // ya llegó el mensaje directo: se descarta la copia anotada
      if (S.perfil) { cerrarHoja(); abrirPendienteDeAviso(); }
    });
  }
  cargarSesion();
  if (!sesion) { mostrarLogin(); return; }
  try { await entrarApp(); } catch (e) {
    if (e.name === 'SesionExpirada') mostrarLogin(e.message); else mostrarLogin(e.message);
  }
})();
