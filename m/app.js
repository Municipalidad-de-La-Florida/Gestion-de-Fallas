'use strict';
/* =========================================================================
   Fallas Alumbrado — La Florida · App móvil (PWA)
   - Misma base de datos y mismos permisos (RLS) que la página web.
   - Solo reporta fallas (punto / circuito) y registra reparaciones.
   - Estadísticas y análisis siguen en la web. La gestión de usuarios (solo admin) también está aquí.
   ========================================================================= */

const SUPABASE_URL = 'https://rcwtqvhssgtufgypnobn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7DTKNsCtPUlaQVDhiwVtoA_o5A_dIcu';
const VERSION_APP = '1.47.3';

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
// ---- Librería de códigos (tablas codigos_falla / codigos_cierre), con las listas fijas de arriba como respaldo ----
const LIBRERIA = { falla: { punto: null, monoposte: null, circuito: null }, cierre: null, desc: { punto: {}, monoposte: {}, circuito: {}, cierre: {} }, frec: null };
const LS_LIBRERIA = 'fm_libreria_v1';
function libreriaAplicar(d) {
  ['punto', 'monoposte', 'circuito'].forEach((cat) => {
    const filas = (d.falla || []).filter((f) => f.categoria === cat);
    LIBRERIA.desc[cat] = Object.fromEntries(filas.map((f) => [f.codigo, f.descripcion]));
    LIBRERIA.falla[cat] = filas.filter((f) => f.activo).sort((a, b) => (a.orden - b.orden) || a.codigo.localeCompare(b.codigo)).map((f) => ({ c: f.codigo, d: f.descripcion }));
    filas.forEach((f) => { DESC_CODIGO[f.codigo] = f.descripcion; });
  });
  const ci = d.cierre || [];
  LIBRERIA.desc.cierre = Object.fromEntries(ci.map((f) => [f.codigo, f.descripcion]));
  LIBRERIA.cierre = ci.filter((f) => f.activo).sort((a, b) => (a.orden - b.orden) || a.codigo.localeCompare(b.codigo)).map((f) => ({ c: f.codigo, d: f.descripcion }));
  LIBRERIA.frec = d.frec || null;
}
async function cargarLibreria() {
  try {
    const [falla, cierre] = await Promise.all([select('codigos_falla', 'select=categoria,codigo,descripcion,orden,activo'), select('codigos_cierre', 'select=codigo,descripcion,orden,activo')]);
    let frec = null; try { frec = await rpc('codigos_frecuentes', { p_dias: 90 }); } catch (e) { /* sin frecuentes */ }
    const d = { falla, cierre, frec };
    libreriaAplicar(d);
    try { localStorage.setItem(LS_LIBRERIA, JSON.stringify(d)); } catch (e) { /* sin almacenamiento */ }
  } catch (e) {
    try { const c = localStorage.getItem(LS_LIBRERIA); if (c) libreriaAplicar(JSON.parse(c)); } catch (e2) { /* se usan las listas fijas */ }
  }
}
// Códigos activos de una lista (punto, monoposte, circuito o cierre). Con "incluir", ese código aparece aunque esté desactivado.
function catalogoActivo(cat, incluir) {
  const lib = cat === 'cierre' ? LIBRERIA.cierre : LIBRERIA.falla[cat];
  const fijo = cat === 'cierre' ? CAT_CIERRES : cat === 'circuito' ? CAT_CIRCUITO : cat === 'monoposte' ? CAT_MONOPOSTE : CAT_PUNTO;
  const lista = (lib && lib.length ? lib : fijo).slice();
  if (incluir && !lista.some((x) => x.c === incluir)) {
    const d = LIBRERIA.desc[cat] && LIBRERIA.desc[cat][incluir];
    if (d) lista.push({ c: incluir, d });
  }
  return lista;
}
// Con más de 6 códigos: los 6 más usados primero y luego el resto (OTRO / 999 al final)
function htmlCodigosGrupo(cat, items, fila) {
  const esOtro = (x) => x.c === 'OTRO' || (cat === 'cierre' && x.c === '999');
  const norm = items.filter((x) => !esOtro(x)), otros = items.filter(esOtro);
  const frec = (LIBRERIA.frec && LIBRERIA.frec[cat]) || [];
  const top = frec.map((c) => norm.find((x) => x.c === c)).filter(Boolean).slice(0, 6).sort((x, y) => x.c.localeCompare(y.c, 'es', { numeric: true }));
  if (norm.length <= 6 || top.length < 3) return items.map(fila).join('');
  const resto = norm.filter((x) => !top.includes(x)).concat(otros);
  const sec = (t) => `<div class="codigos-sec">${t}</div>`;
  return sec('Más frecuentes') + top.map(fila).join('') + sec('Otros códigos') + resto.map(fila).join('');
}
const filaCierre = (x) => `<button type="button" class="codigo" data-t="${esc(x.c + ' ' + x.d)}"><b>${esc(x.c)}</b><span>${esc(x.d)}</span></button>`;
const htmlCierres = () => `<div class="codigos">${htmlCodigosGrupo('cierre', catalogoActivo('cierre'), filaCierre)}</div>`;
const ETIQUETA_ESTADO = { reportada: 'Reportada', pendiente: 'Pendiente', reiterada: 'Reiterada', reparada: 'Reparada' };
const COLOR_ESTADO = { reportada: '#f2b705', pendiente: '#2fa8d8', reiterada: '#7b3fe4', reparada: '#2e9e57', vencida: '#d33a2c' };
// Amarillo reportada, morado reiterada, celeste pendiente; pasan a rojo con más de 48 h (reportada/reiterada,
// desde que se informó) o más de 7 días (pendiente, también desde que se informó).
function claveColor(p) {
  if (p.estado === 'reparada') return 'reparada';
  const ms = (d) => { const t = d ? Date.parse(d) : NaN; return isNaN(t) ? null : Date.now() - t; };
  if (p.estado === 'pendiente') { const t = ms(p.fecha_falla_real || p.fecha_falla || p.fecha_pendiente); return t !== null && t > 7 * 86400000 ? 'vencida' : 'pendiente'; }
  const t = ms(p.fecha_falla_real || p.fecha_falla);
  if (t !== null && t > 48 * 3600000) return 'vencida';
  return p.estado === 'reiterada' ? 'reiterada' : 'reportada';
}

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
// Duración desde que se informó la falla (mismo criterio que la web de escritorio); si ya se reparó, se detiene en la fecha de reparación.
function fmtDuracion(iso, finIso) {
  if (!iso) return '—';
  const ms = (finIso ? new Date(finIso).getTime() : Date.now()) - new Date(iso).getTime();
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
// La ficha de la falla tapa la parte baja del mapa: se corre el mapa para que el punto quede visible,
// en el centro de lo que se ve sobre la ficha (antes quedaba justo detrás y parecía que no se centraba).
function verSobreFicha(ll) {
  if (!map || !ll) return;
  let aplicado = 0;   // cuánto se corrió ya (la ficha puede crecer cuando termina de cargar y hay que corregir)
  const ajustar = () => {
    if (!hojaAbierta) return;
    const m = $('#map').getBoundingClientRect();
    // la ficha sube desde abajo con una animación: se usa su alto final, no su posición del momento
    const tapado = Math.min(Math.max(0, $('#hoja').offsetHeight - (window.innerHeight - m.bottom)), m.height * 0.7) / 2;
    if (Math.abs(tapado - aplicado) > 1) { map.panBy([0, tapado - aplicado], { animate: false }); aplicado = tapado; }
  };
  setTimeout(ajustar, 150); setTimeout(ajustar, 900);
}
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
async function subirFoto(fallaId, blob, soloSubir) {
  const ruta = `${fallaId}/${(crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2))}.jpg`;
  const token = await tokenVigente();
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/storage/v1/object/fotos-reparacion/${ruta}`, {
      method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body: blob,
    });
  } catch (e) { throw new Error('Sin conexión al subir la foto. Intenta de nuevo.'); }
  if (!res.ok) throw new Error('No se pudo subir la foto (' + res.status + ').');
  if (soloSubir) return ruta;   // aporte: la falla aún no existe; la foto se registra dentro de registrar_aporte
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
window.addEventListener('popstate', () => { if (hojaVolviendo) { hojaVolviendo = false; return; } if (hojaAbierta) { cerrarHoja(true); return; } if (window._cuPop && !$('#pantallaCuad').hidden) { window._cuPop(); return; } if (window._usrPop) window._usrPop(); });
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
  S.modoHist = false;
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
    // Permiso para ver Cuadrillas (el admin siempre; los demás solo si el admin se lo habilitó)
    S.perfil.ver_cuadrillas = false; S.perfil.ver_ubicacion = false; S.perfil.ubic_col = false;
    try { const w = await select('usuarios', `id=eq.${sesion.user_id}&select=ver_ubicacion`); if (w && w[0]) { S.perfil.ver_ubicacion = !!w[0].ver_ubicacion; S.perfil.ubic_col = true; } } catch (e) { /* sin columna: sigue a Cuadrillas */ }
    try { const v = await select('usuarios', `id=eq.${sesion.user_id}&select=ver_cuadrillas`); if (v && v[0]) S.perfil.ver_cuadrillas = !!v[0].ver_cuadrillas; } catch (e) { /* sin columna */ }
    // Pauta de días de inspección (solo rol ito). Si la columna aún no existe, queda sin restricción.
    S.perfil.dias_inspeccion = null;
    if (S.perfil.rol === 'ito') {
      try { const d = await select('usuarios', `id=eq.${sesion.user_id}&select=dias_inspeccion`); if (d && d[0] && Array.isArray(d[0].dias_inspeccion)) S.perfil.dias_inspeccion = d[0].dias_inspeccion; } catch (e) { /* sin columna */ }
    }
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
  map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 21 }).setView([-33.52, -70.58], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  rend = L.canvas({ padding: 0.5, tolerance: 12 });
  rendSvg = L.svg({ padding: 0.5 });
  capaCircuitos = L.geoJSON(null, { renderer: rend });
  capaPuntos = L.geoJSON(null, { renderer: rend });
  capaFallas = L.geoJSON(null, { renderer: rend });
  capaEmpalmes = L.geoJSON(null, { renderer: rend });
  // Espera a que el mapa se quede quieto antes de pedir datos (menos llamadas a la base mientras se arrastra)
  let _areaTimer = null;
  map.on('moveend', () => { clearTimeout(_areaTimer); _areaTimer = setTimeout(cargarArea, 300); });
  map.on('dragstart', () => { if (S.seguir) { detenerSeguir(); } });
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
        onEachFeature: (f, l) => l.on('click', (e) => { L.DomEvent.stopPropagation(e); abrirCircuito(f.properties, f.geometry); }),
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
const FO = { asig: 'todas', sub: 'todas', cod: new Set() };   // asig: todas | sin | asignadas · sub: todas | masivo | normal · cod: códigos de falla marcados (vacío = todos)
const asigActiva = () => (puedeFiltrarSinAsignar() ? FO.asig : 'todas');
const cuentaFiltrosOtros = () => (asigActiva() !== 'todas' ? 1 : 0) + (FO.sub !== 'todas' ? 1 : 0) + (FO.cod.size ? 1 : 0);
function pasaFiltrosOtros(masivo, asignadoId, tipoFalla) {
  const a = asigActiva();
  if (FO.cod.size && !FO.cod.has(tipoFalla)) return false;
  if (a === 'sin' && asignadoId) return false;
  if (a === 'asignadas' && !asignadoId) return false;
  if (FO.sub === 'masivo' && !masivo) return false;
  if (FO.sub === 'normal' && masivo) return false;
  return true;
}
/* Filtro por código de falla (varios a la vez). Solo aparecen los códigos presentes, con su cantidad.
   El grupo se crea aquí, así funciona aunque el teléfono tenga un index.html antiguo en caché. */
function pintarChipsCodigo(base) {
  let g = $('#listaCodGrupo');
  if (!g) {
    const pie = $('#filtrosListaPanel .lf-pie'); if (!pie) return;
    g = document.createElement('div'); g.id = 'listaCodGrupo';
    g.innerHTML = '<div class="lf-t" style="margin-top:12px">Código de falla</div><div class="lf-chips" id="listaCod"></div>';
    pie.parentNode.insertBefore(g, pie);
    g.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cod]'); if (!b) return;
      if (b.dataset.cod === '__todos') FO.cod.clear(); else if (FO.cod.has(b.dataset.cod)) FO.cod.delete(b.dataset.cod); else FO.cod.add(b.dataset.cod);
      actualizarFiltrosOtrosUI(); dibujarFallas(); if (S.vista === 'lista') renderLista();
    });
  }
  const cuenta = {};
  base.forEach((f) => { const c = f.properties.tipo_falla; if (c) cuenta[c] = (cuenta[c] || 0) + 1; });
  FO.cod.forEach((c) => { if (!(c in cuenta)) cuenta[c] = 0; });
  const codigos = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a] || a.localeCompare(b));
  g.hidden = !codigos.length;
  $('#listaCod').innerHTML = `<button type="button" class="fchip fchip-sel${FO.cod.size ? '' : ' on'}" data-cod="__todos">Todos</button>` +
    codigos.map((c) => `<button type="button" class="fchip fchip-sel${FO.cod.has(c) ? ' on' : ''}" data-cod="${esc(c)}"><b>${esc(c)}</b> <span class="n">(${cuenta[c]})</span></button>`).join('');
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
  pintarChipsCodigo(base);
  // Aviso sobre el mapa mientras haya filtros de Asignación o Subcontrato puestos
  const partes = [];
  if (asigActiva() === 'sin') partes.push('sin asignar'); else if (asigActiva() === 'asignadas') partes.push('asignadas');
  if (FO.sub === 'masivo') partes.push('masivo'); else if (FO.sub === 'normal') partes.push('normal');
  if (FO.cod.size) partes.push([...FO.cod].join(', '));
  const b = $('#badgeSinAsignar');
  b.hidden = !partes.length;
  b.textContent = 'Solo ' + partes.join(' · ') + ' ✕';
}
function ordenLista() { try { const o = localStorage.getItem('fm_orden_lista'); return (o === 'recientes' || o === 'antiguas') ? o : 'cerca'; } catch (e) { return 'cerca'; } }
// Si el teléfono tiene un index.html antiguo en caché, el selector se crea aquí (así la lista nunca se rompe).
function asegurarOrdenUI() {
  if ($('#listaOrdenGrupo')) return;
  const g = document.createElement('div');
  g.id = 'listaOrdenGrupo'; g.hidden = true;
  g.innerHTML = '<div class="lf-t">Ordenar por</div><div class="lf-chips" id="listaOrden">'
    + '<button type="button" class="fchip fchip-sel on" data-orden="cerca">Cercanía</button>'
    + '<button type="button" class="fchip fchip-sel" data-orden="recientes">Más recientes</button>'
    + '<button type="button" class="fchip fchip-sel" data-orden="antiguas">Más antiguas</button></div>';
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

// Parpadeo de los puntos reiterados (puntos y circuitos): se alterna la opacidad por JS cada 0,55 s, sin depender de animaciones CSS
let _parpadeoTimer = null, _parpadeoOn = true;
function iniciarParpadeo() {
  if (_parpadeoTimer) return;
  _parpadeoTimer = setInterval(() => {
    if (document.hidden || !S.parpadeo || !S.parpadeo.length) return;
    _parpadeoOn = !_parpadeoOn;
    S.parpadeo.forEach((l) => l.setStyle(l.options.forma !== undefined ? { fillOpacity: _parpadeoOn ? 0.95 : 0.25, opacity: _parpadeoOn ? 1 : 0.35 } : { opacity: _parpadeoOn ? 0.9 : 0.2 }));
  }, 550);
}

function dibujarFallas() {
  iniciarParpadeo();
  if (!map || !capaFallas) return;
  const z = map.getZoom();
  capaFallas.clearLayers();
  S.parpadeo = [];
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
    // Código de falla: igual que Subcontrato, manda el circuito
    if (FO.cod.size) { if (p.cascada) return; if (!FO.cod.has(p.tipo_falla)) return; }
    // Asignación: solo fallas activas (los puntos de cascada se ocultan; manda el circuito)
    if (asigF !== 'todas') { if (p.estado === 'reparada' || p.cascada) return; if (asigF === 'sin' ? p.asignado_camion_id : !p.asignado_camion_id) return; }
    if (S.estadosOff[p.estado]) return;
    const reparada = p.estado === 'reparada';
    if (p.cascada && z < ZOOM_DATOS) return;
    const color = COLOR_ESTADO[claveColor(p)] || '#d33a2c';
    let capa;
    if (f.geometry.type === 'Point') {
      const [lng, lat] = f.geometry.coordinates;
      const r = p.cascada ? (z >= 18 ? 7 : 5) : (z >= 18 ? 13 : z >= 16 ? 11 : 8);
      capa = new MarcadorForma([lat, lng], { renderer: rend, forma: formaPoste(p.simb_poste), radius: r, weight: 3, color: '#fff', fillColor: color, fillOpacity: reparada ? 0.55 : 0.95, interactive: true });
      if (p.estado === 'reiterada' && !p.cascada) S.parpadeo.push(capa); // punto reiterado: parpadea como los circuitos
    } else {
      if (p.estado === 'reportada' || p.estado === 'reiterada') {
        // Circuito reportado o reiterado: parpadea (como en el escritorio). El parpadeo es CSS sobre SVG;
        // debajo va una línea ancha invisible para que sea fácil tocarla con el dedo.
        const base = L.geoJSON(f.geometry, { renderer: rendSvg, style: { color, weight: 7, opacity: 0.9, className: 'falla-reportada' }, interactive: false });
        S.parpadeo.push(base); // el parpadeo se hace por JS (en iPhone la animación CSS sobre SVG no siempre corre)
        capaFallas.addLayer(base);
        capa = L.geoJSON(f.geometry, { renderer: rendSvg, style: { color: '#000', weight: 20, opacity: 0, className: 'falla-toque' }, interactive: true });
      } else {
        capa = L.geoJSON(f.geometry, { renderer: rend, style: { color, weight: 7, opacity: reparada ? 0.45 : 0.9 }, interactive: true });
      }
    }
    capa.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (S.modoHist && p.ref_punto_gid != null) return abrirHistorial('punto', p.ref_punto_gid, 'Punto lumínico', f.geometry);
      if (S.modoHist && p.ref_circuito_gid != null) return abrirHistorial('linea', p.ref_circuito_gid, 'Circuito', f.geometry);
      abrirFalla(p, f.geometry);
    });
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
/* Seguimiento: el mapa acompaña al GPS; si lo mueves para mirar algo, a los pocos segundos vuelve a centrarse solo. */
let movProg = false;
// Estilo Google Maps: al tocar el botón se centra y el mapa te sigue; si mueves el mapa, el seguimiento se apaga hasta volver a tocar el botón.
function puedeAutoCentrar() { return S.seguir && !!map && !!S.pos && S.vista === 'mapa' && !hojaAbierta; }
function centrarSeguir(zoomMin) {
  if (!map || !S.pos) return;
  movProg = true;
  map.setView([S.pos.lat, S.pos.lng], Math.max(map.getZoom(), zoomMin || 17), { animate: true });
  setTimeout(() => { movProg = false; }, 800);
}
function marcarSeguir() { $('#btnUbicacion').classList.toggle('sigue', !!S.seguir); }
function activarSeguir() { S.sinAutoSeguir = false; S.seguir = true; marcarSeguir(); centrarSeguir(18); }
function detenerSeguir() { S.seguir = false; marcarSeguir(); }
function detenerGPS() {
  detenerSeguir();
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
    // Primer GPS tras abrir: centra y sigue, salvo que ya haya una falla abierta o se venga de un aviso (ahí el mapa se queda en la falla)
    if (S.centrarAlFijar) { S.centrarAlFijar = false; if (!hojaAbierta && !S.sinAutoSeguir) activarSeguir(); }
    else if (puedeAutoCentrar()) { movProg = true; map.panTo(ll, { animate: true }); setTimeout(() => { movProg = false; }, 800); }
  }
  if (S.vista === 'lista') renderLista();
}
function onPosError(e) {
  S.centrarAlFijar = false;
  if (e.code === 1) { toast('Permiso de ubicación denegado. Actívalo en la configuración del navegador.', 'error'); S.watchId = null; }
  else toast('No se pudo obtener tu ubicación. ¿GPS activado?', 'error');
}
$('#btnUbicacion').addEventListener('click', () => {
  if (S.pos && map) {
    // Cada toque centra en tu ubicación y reactiva el seguimiento (se apaga solo al mover el mapa)
    activarSeguir();
    return;
  }
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
  if (vencioModo()) { cerrarPorTiempo(); throw new Error('La inspección se cerró por superar las 4 horas.'); }
  if (!S.modo.inspId || S.modo.inspFecha !== S.modo.fecha) {
    S.modo.inspId = await rpc('obtener_o_crear_inspeccion', { p_fecha: S.modo.fecha, p_ito: null });
    S.modo.inspFecha = S.modo.fecha;
  }
  return { p_inspeccion_id: S.modo.inspId };
}

// Acciones de la ventana de un punto o circuito: reportar (solo quien puede) + «Cómo llegar» para todos
function accionesReporte(textoReportar, geom) {
  const c = geom ? centroGeom(geom) : null;
  return `<div class="acciones acc-fila" id="accFalla">
    ${puedeReportar() ? `<button id="bReportar" class="btn btn-primario" style="margin-top:0">${ICO_ACC.alerta}${esc(textoReportar)}</button>` : ''}
    ${rol() === 'camion' ? `<button id="bAporte" class="btn btn-primario" style="margin-top:0">${ICO_ACC.alerta}Registrar aporte</button>` : ''}
    ${c ? `<a class="acc-t" target="_blank" rel="noopener" href="${esc(urlComoLlegar(c))}">${ICO_ACC.ir}<span>Cómo llegar</span></a>` : ''}
  </div>`;
}
function abrirPunto(p, geom) {
  if (S.modoHist) return abrirHistorial('punto', p.gid, 'Punto lumínico ' + (p.llave ?? ''), geom);
  const h = abrirHoja(`
    <h2>Punto lumínico</h2>
    <dl class="kv">
      <dt>N.° de llave</dt><dd>${esc(p.llave ?? '—')}</dd>
      <dt>N.° municipal</dt><dd>${esc(p.nro_mun ?? '—')}</dd>
      <dt>Dirección</dt><dd>${esc([p.calle_1, p.direccion].filter((x) => x != null && x !== '').join(' ') || '—')}</dd>
      <dt>Poste</dt><dd>${esc(p.simb_poste || '—')}</dd>
    </dl>
    ${infoSoloLectura()}
    ${accionesReporte('Reportar falla', geom)}`);
  const b = $('#bReportar', h);
  if (b) b.addEventListener('click', ocupar(b, async () => {
    b.textContent = 'Revisando…';
    const dup = await hayFallaActiva('ref_punto_gid', p.gid);
    if (dup) return avisoDuplicado(dup);
    formReportePunto(p);
  }));
  const ba = $('#bAporte', h);
  if (ba) ba.addEventListener('click', ocupar(ba, async () => {
    ba.textContent = 'Revisando…';
    const dup = await hayFallaActiva('ref_punto_gid', p.gid);
    if (dup) return avisoDuplicado(dup);
    await formAporte('punto', p);
  }));
}
function abrirCircuito(p, geom) {
  if (S.modoHist) return abrirHistorial('linea', p.gid, 'Circuito ' + (p.id ?? ''), geom);
  const h = abrirHoja(`
    <h2>Circuito ${esc(p.id ?? '')}</h2>
    <dl class="kv">
      <dt>Luminarias</dt><dd>${esc(p.cantidad_luminarias_cliente ?? '—')}</dd>
      <dt>N.° de cliente</dt><dd>${esc(p.n_cliente ?? '—')}</dd>
    </dl>
    ${infoSoloLectura()}
    ${accionesReporte('Reportar falla de circuito', geom)}`);
  const b = $('#bReportar', h);
  if (b) b.addEventListener('click', ocupar(b, async () => {
    b.textContent = 'Revisando…';
    const dup = await hayFallaActiva('ref_circuito_gid', p.gid);
    if (dup) return avisoDuplicado(dup);
    formReporteCircuito(p);
  }));
  const ba = $('#bAporte', h);
  if (ba) ba.addEventListener('click', ocupar(ba, async () => {
    ba.textContent = 'Revisando…';
    const dup = await hayFallaActiva('ref_circuito_gid', p.gid);
    if (dup) return avisoDuplicado(dup);
    await formAporte('circuito', p);
  }));
}

/* ------------------------- modo historial (admin) ------------------------- */
// Con el modo activo, tocar un punto, un circuito o una falla muestra su historial en vez de la ficha normal.
async function abrirHistorial(tipo, gid, titulo, geom) {
  const h = abrirHoja(`<h2>Historial · ${esc(titulo)}</h2><div id="histEnt" class="hint">Cargando…</div>
    <div class="acciones"><button id="bHistSalir" class="btn" style="margin-top:0">Salir del modo historial</button></div>`);
  $('#bHistSalir', h).addEventListener('click', () => { cerrarHoja(); alternarModoHist(false); });
  const caja = $('#histEnt', h);
  try {
    const filas = await rpc('historial_entidad', { tipo_entidad: tipo, entidad_gid: gid });
    if (!filas || !filas.length) { caja.innerHTML = 'Sin fallas registradas para este elemento todavía.'; return; }
    const ids = filas.map((f) => f.falla_id).filter((x) => x != null);
    let coms = [], desc = [];
    try { coms = await select('fallas_comentarios', `falla_id=in.(${ids.join(',')})&tipo=eq.asignacion&select=falla_id,comentario,autor_nombre,creado_en&order=creado_en.asc`) || []; } catch (e) { /* sin comentarios */ }
    try { desc = await select('fallas', `id=in.(${ids.join(',')})&select=id,descripcion_otro`) || []; } catch (e) { /* sin descripción */ }
    const dRep = {}; desc.forEach((r) => { if (r.descripcion_otro) dRep[r.id] = r.descripcion_otro; });
    const ev = [];
    filas.forEach((f) => {
      const cod = esc(f.tipo_falla || '') + (f.cascada ? ' (por cascada de circuito)' : '');
      ev.push({ t: f.fecha_falla, ot: f.ot, k: 'Reportada', c: 'rep', cod, q: f.nombre_creador, d: dRep[f.falla_id] });
      if (f.pendiente_por_nombre) ev.push({ t: f.fecha_pendiente, ot: f.ot, k: 'Dejada pendiente', c: 'pen', cod: esc(f.tipo_falla || ''), q: f.pendiente_por_nombre, d: f.motivo_pendiente });
      if (f.reparado_por_nombre) ev.push({ t: f.fecha_reparacion, ot: f.ot, k: 'Reparada', c: 'ok', cod: esc(f.tipo_falla || ''), q: f.reparado_por_nombre, d: f.descripcion_reparacion });
      coms.filter((c) => c.falla_id === f.falla_id).forEach((c) => ev.push({ t: c.creado_en, ot: f.ot, k: 'Comentario de asignación', c: 'asi', cod: esc(f.tipo_falla || ''), q: c.autor_nombre, d: c.comentario }));
    });
    ev.sort((a, b) => new Date(b.t) - new Date(a.t));
    const col = { rep: '#c1443c', pen: '#8a5200', ok: '#1f7a4d', asi: '#2563a8' };
    caja.outerHTML = `<div class="m-lista">${ev.map((e) => `<div class="m-fila" style="display:block">
      <div style="display:flex;justify-content:space-between;gap:8px"><b style="color:${col[e.c]}">${esc(e.k)}</b><span class="hint">${esc(fmtFechaHoraCorta(e.t))}</span></div>
      <div class="hint">${e.ot ? 'OS ' + esc(e.ot) + ' · ' : ''}${e.cod}${e.q ? ' · ' + esc(e.q) : ''}</div>
      ${e.d ? `<div style="margin-top:4px">${esc(e.d)}</div>` : ''}</div>`).join('')}</div>`;
  } catch (e) { caja.textContent = 'No se pudo cargar el historial: ' + e.message; }
}
function alternarModoHist(on) {
  S.modoHist = typeof on === 'boolean' ? on : !S.modoHist;
  $('#navHist').classList.toggle('sel', !!S.modoHist);
  if (S.modoHist) toast('Modo historial: toca un punto, circuito o falla para ver su historial.');
}
$('#navHist').addEventListener('click', () => { if (hojaAbierta) cerrarHoja(); alternarModoHist(); });
async function hayFallaActiva(campo, gid) {
  // No se confía solo en "estado": también se revisa si ya existe una reparación registrada.
  const ex = await select('fallas', `${campo}=eq.${gid}&select=id,tipo_falla,estado,reparaciones(id)`);
  return (ex || []).find((f) => f.estado !== 'reparada' && !(f.reparaciones && f.reparaciones.length));
}

/* ------------------------------ aportes ------------------------------ */
// El camión marca un punto o circuito, indica la falla y registra de inmediato la reparación (antes + después + maestro).
async function cargarMisContratos() {
  const uc = await select('usuario_contratos', `usuario_id=eq.${sesion.user_id}&select=contrato_id`);
  const ids = (uc || []).map((x) => x.contrato_id);
  if (!ids.length) return [];
  const cs = await select('contratos', `id=in.(${ids.join(',')})&activo=eq.true&select=id,nombre&order=nombre.asc`);
  return cs || [];
}
async function formAporte(tipo, p) {
  let contratos = [], maestros = [];
  try { contratos = await cargarMisContratos(); maestros = await select('maestros', 'activo=eq.true&select=id,nombre,contrato_id&order=nombre.asc'); }
  catch (e) { toast('No se pudo cargar tu contrato o los maestros.', 'error'); return; }
  if (!contratos.length) { toast('Tu usuario no tiene un contrato asignado. Avisa al administrador.', 'error'); return; }
  const mono = tipo === 'punto' && String(p.simb_poste || '').toUpperCase().trim() === 'MONOPOSTE';
  const nomCat = tipo === 'circuito' ? 'circuito' : (mono ? 'monoposte' : 'punto');
  const cat = catalogoActivo(nomCat);
  const fallaId = crypto.randomUUID();
  let codigo = null, card = null, trabajos = [];
  const fotos = { antes: null, despues: null };   // { blob, url, ruta }
  const h = abrirHoja(`
    <h2>Registrar aporte</h2>
    <div class="hint">${tipo === 'punto' ? `Punto lumínico · llave ${esc(p.llave ?? '—')} · N.° municipal ${esc(p.nro_mun ?? '—')}` : `Circuito ${esc(p.id ?? '')} · ${esc(p.cantidad_luminarias_cliente ?? '—')} luminarias`}</div>
    <div class="aviso">Se registra la falla y su reparación juntas. Quedará como aporte de tu cuadrilla y del maestro que elijas.</div>
    ${contratos.length > 1 ? `<h3>Contrato</h3><select id="aContrato" class="campo">${contratos.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}</select>` : ''}
    <h3>Maestro</h3>
    <select id="aMaestro" class="campo"></select>
    <div id="aSinMaestro" class="hint" hidden>No hay maestros en este contrato. Pide a tu contratista que los agregue desde el menú.</div>
    <h3>Código de falla</h3>${htmlCodigos(cat, nomCat)}
    ${tipo === 'punto' ? `<h3>Cardinalidad (opcional)</h3>
    <div class="rosca" id="aCard"><button type="button" data-r="N">N</button><button type="button" data-r="S">S</button><button type="button" data-r="O">O</button><button type="button" data-r="P">P</button></div>` : ''}
    <h3>Comentario de la falla</h3>
    <textarea id="aDesc" class="campo" placeholder="Opcional (obligatorio si eliges OTRO)"></textarea>
    <h3>Trabajo realizado</h3>
    ${htmlCierres()}
    <textarea id="aRep" class="campo" placeholder="Detalle de lo realizado (opcional si marcaste un trabajo)"></textarea>
    <h3>Fotografías <span class="req">obligatorias</span></h3>
    <div class="fotos" id="aFotos">
      ${['antes', 'despues'].map((m) => `<div class="foto-slot" data-m="${m}"><div class="hint" style="font-weight:600">${m === 'antes' ? 'ANTES' : 'DESPUÉS'}</div><div class="vista"></div><div class="fila-btns"><button type="button" class="btn btn-secundario" data-cam="${m}">📷 Tomar</button><button type="button" class="btn btn-secundario" data-gal="${m}">🖼 Galería</button></div><input type="file" accept="image/*" hidden data-in="${m}"></div>`).join('')}
    </div>
    <div class="acciones fija"><button id="aOk" class="btn btn-primario">Registrar aporte</button></div>`);
  const selM = $('#aMaestro', h);
  const pintarMaestros = () => {
    const cid = contratos.length > 1 ? $('#aContrato', h).value : contratos[0].id;
    const ms = maestros.filter((m) => m.contrato_id === cid);
    selM.innerHTML = ms.length ? `<option value="">Elige el maestro…</option>` + ms.map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('') : '<option value="">—</option>';
    $('#aSinMaestro', h).hidden = !!ms.length;
  };
  pintarMaestros();
  if (contratos.length > 1) $('#aContrato', h).addEventListener('change', pintarMaestros);
  const codigosFalla = $$('.codigos', h)[0], codigosTrab = $$('.codigos', h)[1];
  $$('.codigo', codigosFalla).forEach((b) => b.addEventListener('click', () => {
    $$('.codigo', codigosFalla).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); codigo = b.dataset.c;
  }));
  $$('.codigo', codigosTrab).forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.t, i = trabajos.indexOf(t);
    if (i >= 0) { trabajos.splice(i, 1); b.classList.remove('sel'); } else { trabajos.push(t); b.classList.add('sel'); }
  }));
  $$('#aCard button', h).forEach((b) => b.addEventListener('click', () => {
    const on = b.classList.contains('sel');
    $$('#aCard button', h).forEach((x) => x.classList.remove('sel'));
    card = on ? null : b.dataset.r; if (!on) b.classList.add('sel');
  }));
  const pintarSlot = (m) => {
    const sl = $(`.foto-slot[data-m="${m}"]`, h), f = fotos[m];
    $('.vista', sl).innerHTML = f ? `<div class="foto"><img src="${f.url}" alt="Foto ${m}"><button type="button" aria-label="Quitar foto">✕</button></div>` : '<div class="hint">Sin foto</div>';
    const q = $('.vista button', sl);
    if (q) q.addEventListener('click', () => { URL.revokeObjectURL(f.url); fotos[m] = null; pintarSlot(m); });
  };
  const poner = async (m, file) => {
    try { const blob = await comprimirFoto(file); if (fotos[m]) URL.revokeObjectURL(fotos[m].url); fotos[m] = { blob, url: URL.createObjectURL(blob), ruta: null }; pintarSlot(m); }
    catch (e) { toast(e.message, 'error'); }
  };
  ['antes', 'despues'].forEach((m) => {
    pintarSlot(m);
    const inp = $(`input[data-in="${m}"]`, h);
    $(`[data-cam="${m}"]`, h).addEventListener('click', async () => {
      const r = await abrirCamara();
      if (r === undefined) { inp.setAttribute('capture', 'environment'); inp.click(); } else if (r) poner(m, r);
    });
    $(`[data-gal="${m}"]`, h).addEventListener('click', () => { inp.removeAttribute('capture'); inp.click(); });
    inp.addEventListener('change', (e) => { if (e.target.files[0]) poner(m, e.target.files[0]); e.target.value = ''; });
  });
  const ok = $('#aOk', h);
  ok.addEventListener('click', ocupar(ok, async () => {
    const cid = contratos.length > 1 ? $('#aContrato', h).value : contratos[0].id;
    const maestro = selM.value;
    const desc = $('#aDesc', h).value.trim();
    const libre = $('#aRep', h).value.trim();
    const rep = [...trabajos, ...(libre ? [libre] : [])].join('\n');
    if (!maestro) { toast('Elige el maestro que realizó el trabajo.', 'error'); return; }
    if (!codigo) { toast('Selecciona un código de falla.', 'error'); return; }
    if (codigo === 'OTRO' && !desc) { toast('Describe la falla.', 'error'); return; }
    if (!rep) { toast('Elige o describe el trabajo realizado.', 'error'); return; }
    if (!fotos.antes || !fotos.despues) { toast('Faltan las fotos de antes y de después.', 'error'); return; }
    const lista = [];
    for (const m of ['antes', 'despues']) {
      ok.textContent = `Subiendo foto ${m === 'antes' ? 'de antes' : 'de después'}…`;
      if (!fotos[m].ruta) fotos[m].ruta = await subirFoto(fallaId, fotos[m].blob, true);
      lista.push({ ruta: fotos[m].ruta, bytes: fotos[m].blob.size, momento: m });
    }
    ok.textContent = 'Guardando…';
    const r = await rpc('registrar_aporte', {
      p_falla_id: fallaId, p_contrato_id: cid, p_tipo: tipo, p_gid: p.gid, p_tipo_falla: codigo,
      p_cardinalidad: card, p_comentario: desc || null, p_maestro_id: maestro, p_reparacion: rep, p_fotos: lista,
    });
    cerrarHoja();
    toast(`Aporte registrado · OS ${r.ot}`, 'ok');
    cargarFallas();
  }));
}

// Maestros del contrato (los mantiene el contratista; el admin ve todos). No se borran: se desactivan.
async function abrirMaestros() {
  const h = abrirHoja('<h2>Maestros</h2><div class="hint">Cargando…</div>');
  let contratos = [], ms = [];
  try {
    contratos = rol() === 'admin' ? await select('contratos', 'activo=eq.true&select=id,nombre&order=nombre.asc') : await cargarMisContratos();
    ms = await select('maestros', 'select=id,nombre,contrato_id,activo&order=nombre.asc');
  } catch (e) { h.innerHTML = '<h2>Maestros</h2><div class="aviso peligro">No se pudo cargar. ¿Ya se ejecutó el SQL de aportes?</div>'; return; }
  const pintar = () => {
    h.innerHTML = `<h2>Maestros</h2><div class="hint">Personal que realiza las reparaciones. Los camiones eligen de esta lista al registrar un aporte.</div>
      ${contratos.map((c) => `<h3>${esc(c.nombre)}</h3>
        ${ms.filter((m) => m.contrato_id === c.id).map((m) => `<div class="tarjeta" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;${m.activo ? '' : 'opacity:.55'}"><b>${esc(m.nombre)}</b><button type="button" class="btn btn-secundario" data-t="${esc(m.id)}" style="width:auto;margin:0">${m.activo ? 'Desactivar' : 'Activar'}</button></div>`).join('') || '<div class="hint">Sin maestros.</div>'}
        <div class="fila" style="margin-top:8px"><input class="campo" data-n="${esc(c.id)}" placeholder="Nombre del maestro" maxlength="60"><button type="button" class="btn btn-primario" data-a="${esc(c.id)}" style="width:auto;margin:0">Agregar</button></div>`).join('')}`;
    $$('[data-t]', h).forEach((b) => b.addEventListener('click', ocupar(b, async () => {
      const m = ms.find((x) => x.id === b.dataset.t);
      await api(`/rest/v1/maestros?id=eq.${m.id}`, { method: 'PATCH', body: { activo: !m.activo } });
      m.activo = !m.activo; pintar();
    })));
    $$('[data-a]', h).forEach((b) => b.addEventListener('click', ocupar(b, async () => {
      const cid = b.dataset.a, inp = $(`[data-n="${cid}"]`, h), nombre = inp.value.trim().replace(/\s+/g, ' ');
      if (nombre.length < 2) { toast('Escribe el nombre del maestro.', 'error'); return; }
      try {
        const r = await api('/rest/v1/maestros', { method: 'POST', body: { contrato_id: cid, nombre }, prefer: 'return=representation' });
        ms.push(r[0]); ms.sort((a, b2) => a.nombre.localeCompare(b2.nombre)); pintar();
      } catch (e) { toast(/duplicate|unique/i.test(e.message) ? 'Ese maestro ya está en la lista.' : e.message, 'error'); }
    })));
  };
  pintar();
}
function avisoDuplicado(f) {
  abrirHoja(`
    <h2>Ya existe una falla activa aquí</h2>
    <div class="aviso peligro">Código ${esc(f.tipo_falla)} · estado: ${esc(ETIQUETA_ESTADO[f.estado] || f.estado)}.<br>No se puede duplicar el reporte. Si crees que es un error, avisa al administrador.</div>
    <div class="acciones"><button class="btn btn-secundario" id="bOk">Entendido</button></div>`);
  $('#bOk').addEventListener('click', () => cerrarHoja());
}

function htmlCodigos(cat, nombreCat) {
  const fila = (x) => `<button type="button" class="codigo" data-c="${esc(x.c)}"><b>${esc(x.c)}</b><span>${esc(x.d)}</span></button>`;
  return `<div class="codigos">${nombreCat ? htmlCodigosGrupo(nombreCat, cat, fila) : cat.map(fila).join('')}</div>`;
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
  const nomCat = mono ? 'monoposte' : 'punto';
  const cat = catalogoActivo(nomCat);
  let codigo = null, card = null;
  const h = abrirHoja(`
    ${htmlBotonMasivo()}
    <h2>Reportar falla</h2>
    <div class="hint">Punto lumínico · llave ${esc(p.llave ?? '—')} · N.° municipal ${esc(p.nro_mun ?? '—')}${mono ? ' · monoposte' : ''}</div>
    <h3>Código de falla</h3>${htmlCodigos(cat, nomCat)}
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
    <h3>Código de falla</h3>${htmlCodigos(catalogoActivo('circuito'), 'circuito')}
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
  const nomCat = esCircuito ? 'circuito' : (['F02', 'F03'].includes(fila.tipo_falla) ? 'monoposte' : 'punto');
  const cat = catalogoActivo(nomCat, fila.tipo_falla);
  let codigo = fila.tipo_falla;
  const h = abrirHoja(`
    ${htmlBotonMasivo()}
    <h2>Editar falla · OS ${esc(p.ot || '—')}</h2>
    <div class="hint">${esc(tipoLabel(p))}${p.tipo === 'punto' ? ` · llave ${esc(p.llave ?? '—')}` : ''}. La ubicación no se puede cambiar: si está mal, elimina la falla y vuelve a informarla.${esCircuito ? ' Los cambios también se aplican a sus puntos afectados.' : ''}</div>
    <h3>Código de falla</h3>${htmlCodigos(cat, nomCat)}
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
const _ia = (d) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICO_ACC = {
  alerta: _ia('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>'),
  ok: _ia('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  editar: _ia('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  nueva: _ia('<path d="M12 5v14M5 12h14"/>'),
  camion: _ia('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="17" cy="17.5" r="1.7"/>'),
  ir: _ia('<path d="M12 21s-6-5.6-6-10.5a6 6 0 0112 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>'),
  borrar: _ia('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
};
async function abrirFalla(p, geom) {
  detenerSeguir();   // al mirar una falla, el mapa deja de seguirte (tocas el botón de ubicación para volver)
  const c = centroGeom(geom);
  const desc = DESC_CODIGO[p.tipo_falla];
  const kv = [
    ['OS', p.ot || '—'],
    p.orden_externa ? ['Orden externa', p.orden_externa] : null,
    p.contrato_id && CONTR[p.contrato_id] ? ['Contrato', CONTR[p.contrato_id].nombre] : null,
    ['Tipo', tipoLabel(p)],
    p.tipo === 'punto' ? ['Llave / N.° mun.', `${p.llave ?? '—'} / ${p.nro_mun ?? '—'}`] : null,
    p.cardinalidad ? ['Cardinalidad', p.cardinalidad] : null,
    ['Informada', fmtFecha(p.fecha_falla)],
    ['Inspector', p.nombre_creador || p.nombre_real_creador || '—'],
    ['Duración de la falla', fmtDuracion(p.fecha_falla, p.estado === 'reparada' ? p.fecha_reparacion : null)],
    p.tipo !== 'punto' ? ['Puntos afectados', p.puntos_afectados ?? '—'] : null,
    p.asignado_camion_nombre ? ['Asignado por', `${p.asignado_por_nombre || '—'}${p.fecha_asignacion ? ' · ' + fmtFechaHoraCorta(p.fecha_asignacion) : ''}`] : null,
    // "Asignado a" solo en fallas activas; en reparadas/pendientes la zona de respuesta lleva "Responde"
    p.asignado_camion_nombre && p.estado !== 'reparada' && (p.estado !== 'pendiente' || (rol() === 'admin' && !p.cascada)) ? ['Asignado a', p.asignado_camion_nombre] : null,
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
    <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}${k === 'Asignado a' && puedeAsignarEsta && p.asignado_camion_id && rol() === 'admin' ? ' <button id="bQuitarAsig" class="btn-link" style="color:var(--rojo);font-size:12px;font-weight:600;border:1px solid var(--rojo);border-radius:10px;padding:0 8px;margin-left:6px">Quitar</button>' : ''}</dd>`).join('')}</dl>
    ${p.estado === 'reparada' ? `<div style="border-top:1px solid var(--linea);margin-top:6px;padding-top:4px">
      <dl class="kv">${kvRespuesta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${p.descripcion_reparacion ? `<h3>Trabajo realizado</h3><pre class="texto">${esc(p.descripcion_reparacion)}</pre>` : ''}
      <div id="fotosFalla"></div>
    </div>` : ''}
    ${p.estado === 'pendiente' ? `<div style="border-top:1px solid var(--linea);margin-top:6px;padding-top:4px">
      <dl class="kv">${kvRespuesta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <h3>Motivo</h3><pre class="texto">${esc(p.motivo_pendiente || '')}</pre>
    </div>` : ''}
    ${p.cascada ? `<div class="aviso" id="avCascada">Este punto se cierra automáticamente al reparar su circuito.</div>` : ''}
    <div class="acciones" id="accFalla">
      ${puedeCerrarEsta ? `<button id="bCerrar" class="btn btn-primario" style="margin-top:0">${ICO_ACC.ok}Registrar reparación</button>` : ''}
      <div class="acc-mini">
        ${puedeEditarEsta ? `<button id="bEditar" class="acc-t">${ICO_ACC.editar}<span>Editar${rol() === 'admin' ? '' : `<small>${minRestantes} min</small>`}</span></button>` : ''}
        ${puedeNuevaAqui ? `<button id="bNueva" class="acc-t">${ICO_ACC.nueva}<span>Nueva falla<small>${p.tipo === 'linea' ? 'en este circuito' : 'en este punto'}</small></span></button>` : ''}
        ${puedeAsignarEsta ? `<button id="bAsignar" class="acc-t">${ICO_ACC.camion}<span>${p.asignado_camion_id ? 'Cambiar camión' : 'Asignar camión'}</span></button>` : ''}
        <a class="acc-t" target="_blank" rel="noopener" href="${esc(urlComoLlegar(c))}">${ICO_ACC.ir}<span>Cómo llegar</span></a>
        ${puedeEliminarEsta ? `<button id="bEliminar" class="acc-t acc-peligro">${ICO_ACC.borrar}<span>Eliminar${rol() === 'admin' ? '' : `<small>${minRestantes} min</small>`}</span></button>` : ''}
      </div>
    </div>
    <h3>Historial</h3>
    <ul class="linea-tiempo" id="histFalla"><li class="hint">Cargando…</li></ul>`);
  ofrecerEdicionReparacion(p, h);
  const bc = $('#bCerrar', h);
  if (bc) bc.addEventListener('click', () => formCierre(p));
  const bed = $('#bEditar', h);
  if (bed) bed.addEventListener('click', () => editarFallaApp(p));
  const bn = $('#bNueva', h);
  if (bn) bn.addEventListener('click', ocupar(bn, () => reportarNuevaSobre(p)));
  const ba = $('#bAsignar', h);
  if (ba) ba.addEventListener('click', () => formAsignar(p));
  const bq = $('#bQuitarAsig', h);
  if (bq) bq.addEventListener('click', ocupar(bq, async () => {
    if (!confirm('¿Quitar la asignación de esta falla?')) return;
    const filas = await api(`/rest/v1/fallas?id=eq.${p.id}`, { method: 'PATCH', prefer: 'return=representation', body: { asignado_camion_id: null, asignado_por_id: null } });
    if (!filas || !filas.length) throw new Error('No tienes permiso para quitar la asignación.');
    cerrarHoja();
    toast('Asignación quitada', 'ok');
    cargarFallas();
  }));
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

/* Editar / quitar una reparación: quien la registró, dentro de 30 minutos (el admin siempre). La base lo exige igual. */
async function ofrecerEdicionReparacion(p, h) {
  if (!PUEDE_CERRAR.includes(rol()) || p.cascada || p.estado !== 'reparada') return;
  let est;
  try { est = await rpc('reparacion_estado', { p_falla_id: p.id }); } catch (e) { return; }
  const acc = $('#accFalla', h);
  if (!est || !est.puede || !acc || !document.body.contains(acc)) return;
  const min = est.segundos == null ? '' : ` (quedan ${Math.max(1, Math.ceil(est.segundos / 60))} min)`;
  acc.insertAdjacentHTML('afterbegin', `<button id="bEditRep" class="btn btn-secundario">✏️ Editar o quitar la reparación${min}</button>`);
  $('#bEditRep', h).addEventListener('click', () => editarReparacionApp(p, est));
}
async function editarReparacionApp(p, est) {
  const nomCat = est.tipo === 'linea' ? 'circuito' : (['F02', 'F03'].includes(est.tipo_falla) ? 'monoposte' : 'punto');
  const cat = catalogoActivo(nomCat, est.tipo_falla);
  const bloq = !!est.bloqueada_por_otra_falla;
  let codigo = est.tipo_falla;
  const h = abrirHoja(`
    <h2>Editar reparación · OS ${esc(p.ot || '—')}</h2>
    <div class="hint">${esc(est.tipo_falla)}${est.segundos == null ? ' · sin límite de tiempo (admin)' : ''}</div>
    <h3>Trabajo realizado</h3>
    ${htmlCierres()}
    <div class="hint">Lo marcado se agrega aquí abajo (puedes editarlo):</div>
    <textarea id="rDesc" class="campo"></textarea>
    <h3>Código de falla</h3>${htmlCodigos(cat, nomCat)}
    <textarea id="rOtro" class="campo" placeholder="Describe la falla (obligatorio si eliges OTRO)" ${codigo === 'OTRO' ? '' : 'hidden'}></textarea>
    <h3>Orden externa (opcional)</h3>${htmlOrdenExterna()}
    <h3>Fotografías</h3>
    <div id="rFotos" class="fotos"></div>
    <div class="fila-btns">
      <button type="button" id="rBtnCam" class="btn btn-secundario">📷 Tomar foto</button>
      <button type="button" id="rBtnGal" class="btn btn-secundario">🖼 Galería</button>
    </div>
    <input id="rInCam" type="file" accept="image/*" capture="environment" hidden>
    <input id="rInGal" type="file" accept="image/*" multiple hidden>
    <div class="acciones"><button id="rGuardar" class="btn btn-primario">Guardar cambios</button></div>
    <h3>Me equivoqué al cerrar</h3>
    ${bloq ? '<div class="hint">Ya hay otra falla activa en este punto o circuito: no se puede quitar la reparación.</div>' : `
    <div class="hint">Se borra la reparación (con su comentario y fotos) y la falla vuelve a su estado anterior.</div>
    <div class="acciones"><button id="rQuitar" class="btn btn-secundario" style="color:var(--rojo)">↩ Quitar reparación</button></div>
    <div class="hint">O déjala pendiente (motivo obligatorio):</div>
    <textarea id="rMotivo" class="campo" placeholder="Motivo por el que queda pendiente"></textarea>
    <div class="acciones"><button id="rPend" class="btn btn-secundario">Dejar pendiente</button></div>`}`);
  $('#rDesc', h).value = est.descripcion || '';
  $('#rOtro', h).value = est.descripcion_otro || '';
  const m = /^([SE])-(.*)$/.exec(est.orden_externa || '');
  if (m) { $('#fOeEmp', h).value = m[1]; $('#fOeNum', h).value = m[2]; }
  // Los códigos de trabajo se marcan/desmarcan (como al registrar) y reflejan lo escrito en el cuadro
  const lineasRep = () => $('#rDesc', h).value.split('\n').map((x) => x.trim());
  const marcarCodigosRep = () => { const ls = lineasRep(); $$('.codigos .codigo[data-t]', h).forEach((b) => b.classList.toggle('sel', ls.includes(b.dataset.t))); };
  marcarCodigosRep();
  $$('.codigos .codigo[data-t]', h).forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.t, ta = $('#rDesc', h), ls = lineasRep();
    if (ls.includes(t)) ta.value = ta.value.split('\n').filter((x) => x.trim() !== t).join('\n');
    else ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + t;
    marcarCodigosRep();
  }));
  $('#rDesc', h).addEventListener('input', marcarCodigosRep);
  $$('.codigo[data-c]', h).forEach((b) => {
    if (b.dataset.c === codigo) b.classList.add('sel');
    b.addEventListener('click', () => { $$('.codigo[data-c]', h).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); codigo = b.dataset.c; $('#rOtro', h).hidden = codigo !== 'OTRO'; });
  });
  // Fotos: las ya subidas (✕ las quita en el servidor) y las nuevas por subir
  let existentes = []; const nuevas = [];
  const pintar = async () => {
    const c = $('#rFotos', h); if (!c) return;
    const urls = await Promise.all(existentes.map((f) => urlFoto(f.ruta).catch(() => null)));
    c.innerHTML = existentes.map((f, i) => `<div class="foto"><img src="${esc(urls[i] || '')}" alt="Foto"><button type="button" data-q="${esc(f.id)}" aria-label="Quitar foto">✕</button></div>`).join('')
      + nuevas.map((f, i) => `<div class="foto"><img src="${f.url}" alt="Foto nueva"><button type="button" data-n="${i}" aria-label="Quitar foto">✕</button></div>`).join('');
    $$('[data-q]', c).forEach((b) => b.addEventListener('click', async () => {
      try { await rpc('quitar_foto_reparacion', { p_foto_id: b.dataset.q }); existentes = existentes.filter((f) => f.id !== b.dataset.q); pintar(); }
      catch (e) { toast(e.message, 'error'); }
    }));
    $$('[data-n]', c).forEach((b) => b.addEventListener('click', () => { const f = nuevas.splice(+b.dataset.n, 1)[0]; URL.revokeObjectURL(f.url); pintar(); }));
    $('#rBtnCam', h).disabled = $('#rBtnGal', h).disabled = existentes.length + nuevas.length >= MAX_FOTOS;
  };
  try { existentes = (await select('fallas_fotos', `falla_id=eq.${p.id}&archivada_en=is.null&select=id,ruta&order=creado_en.asc`)) || []; } catch (e) { existentes = []; }
  pintar();
  const agregar = async (files) => {
    const libres = MAX_FOTOS - existentes.length - nuevas.length;
    for (const f of Array.from(files || []).slice(0, libres)) {
      try { const blob = await comprimirFoto(f); nuevas.push({ blob, url: URL.createObjectURL(blob) }); } catch (e) { toast(e.message, 'error'); }
    }
    pintar();
  };
  $('#rBtnCam', h).addEventListener('click', () => $('#rInCam', h).click());
  $('#rBtnGal', h).addEventListener('click', () => $('#rInGal', h).click());
  ['rInCam', 'rInGal'].forEach((id) => $('#' + id, h).addEventListener('change', (e) => { agregar(e.target.files); e.target.value = ''; }));
  const fin = (msg) => { cerrarHoja(); toast(msg, 'ok'); cargarFallas(); };
  const gu = $('#rGuardar', h);
  gu.addEventListener('click', ocupar(gu, async () => {
    const d = $('#rDesc', h).value.trim();
    if (!d) { toast('La descripción de la reparación no puede estar vacía.', 'error'); return; }
    const o = $('#rOtro', h).value.trim();
    if (codigo === 'OTRO' && !o) { toast('Describe la falla.', 'error'); return; }
    const oe = leerOrdenExterna(h);
    if (oe.error) { toast(oe.error, 'error'); return; }
    const cambios = {};
    if (d !== (est.descripcion || '').trim()) cambios.descripcion = d;
    if (codigo !== est.tipo_falla) { cambios.tipo_falla = codigo; if (codigo !== 'OTRO') cambios.descripcion_otro = null; }
    if (codigo === 'OTRO' && o !== (est.descripcion_otro || '')) cambios.descripcion_otro = o;
    if ((oe.valor || null) !== (est.orden_externa || null)) cambios.orden_externa = oe.valor || null;
    for (let i = 0; i < nuevas.length; i++) { gu.textContent = `Subiendo foto ${i + 1} de ${nuevas.length}…`; await subirFoto(p.id, nuevas[i].blob); }
    if (Object.keys(cambios).length) { gu.textContent = 'Guardando…'; await rpc('editar_reparacion', { p_falla_id: p.id, p_cambios: cambios }); }
    fin('Reparación actualizada');
  }));
  const q = $('#rQuitar', h);
  if (q) q.addEventListener('click', ocupar(q, async () => {
    if (!confirm('¿Quitar la reparación? La falla volverá a su estado anterior.')) return;
    await rpc('anular_reparacion', { p_falla_id: p.id, p_motivo_pendiente: null });
    fin('Reparación quitada');
  }));
  const pe = $('#rPend', h);
  if (pe) pe.addEventListener('click', ocupar(pe, async () => {
    const mot = $('#rMotivo', h).value.trim();
    if (!mot) { toast('Escribe el motivo por el que queda pendiente.', 'error'); return; }
    await rpc('anular_reparacion', { p_falla_id: p.id, p_motivo_pendiente: mot });
    fin('La falla quedó pendiente');
  }));
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
    ${htmlCierres()}
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
  items = items.filter((f) => pasaFiltrosOtros(!!f.properties.masivo, f.properties.asignado_camion_id, f.properties.tipo_falla));
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
  else if (orden === 'antiguas') items.sort((a, b) => (Date.parse(a.f.properties.fecha_falla) || 0) - (Date.parse(b.f.properties.fecha_falla) || 0) || String(a.f.properties.ot).localeCompare(String(b.f.properties.ot)));
  else items.sort((a, b) => (Date.parse(b.f.properties.fecha_falla) || 0) - (Date.parse(a.f.properties.fecha_falla) || 0) || String(b.f.properties.ot).localeCompare(String(a.f.properties.ot)));
  asegurarOrdenUI();
  $('#listaOrdenGrupo').hidden = false;
  $$('#listaOrden .fchip').forEach((c) => c.classList.toggle('on', c.dataset.orden === orden));
  $('#listaResumen').textContent = `${items.length - nRep} de ${total} fallas activas${nRep ? ` + ${nRep} reparada${nRep > 1 ? 's' : ''} (últimos 10 días)` : ''} · ${porCerca ? 'ordenadas por cercanía' : (orden === 'antiguas' ? 'más antiguas primero' : (orden === 'cerca' ? 'más recientes primero (activa el GPS para ordenar por cercanía)' : 'más recientes primero'))}`;
  $('#listaItems').innerHTML = items.length ? items.map(({ f, d }, i) => {
    const p = f.properties;
    return `<button class="tarjeta est-${esc(claveColor(p))}" data-i="${i}">
      <div class="tarjeta-top"><b>${esc(p.tipo_falla)} · ${esc(DESC_CODIGO[p.tipo_falla] || '')}</b>${d != null ? `<span class="dist">${esc(fmtDist(d))}</span>` : ''}</div>
      <div class="sub">OS ${esc(p.ot || '—')} · ${p.tipo === 'punto' ? 'Llave ' + esc(p.llave ?? '—') : esc(p.puntos_afectados ?? '') + ' puntos (circuito)'} · <span class="insignia ${esc(p.estado)}">${esc(ETIQUETA_ESTADO[p.estado] || p.estado)}</span></div>
      <div class="sub">${esc(p.nombre_creador || '—')} · ${esc(hace(p.fecha_falla))}${tagContrato(p.contrato_id)}</div>
    </button>`;
  }).join('') : '<div class="vacio">No hay fallas activas con este filtro.</div>';
  $$('#listaItems .tarjeta').forEach((b) => b.addEventListener('click', () => {
    const { f } = items[Number(b.dataset.i)];
    cambiarVista('mapa');
    map.setView(f._c, Math.max(map.getZoom(), 18), { animate: false });
    abrirFalla(f.properties, f.geometry);
    verSobreFicha(f._c);
  }));
}
$$('#listaAsig .fchip').forEach((c) => c.addEventListener('click', () => fijarFiltroOtros('asig', c.dataset.asig)));
$$('#listaSub .fchip').forEach((c) => c.addEventListener('click', () => fijarFiltroOtros('sub', c.dataset.sub)));
$('#badgeSinAsignar').addEventListener('click', () => { FO.asig = 'todas'; FO.sub = 'todas'; FO.cod.clear(); actualizarFiltrosOtrosUI(); dibujarFallas(); if (S.vista === 'lista') renderLista(); });
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
  FO.asig = 'todas'; FO.sub = 'todas'; FO.cod.clear();
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
    $('#inspC3Resumen').textContent = `Inspecciones de los últimos 7 días (todos los ITOs). ${rol() === 'admin' ? '' : 'Las cifras consideran solo tu contrato.'}`;
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
      ${fs.map((f) => `<div class="tarjeta est-${esc(claveColor({ estado: f.estado, fecha_falla_real: f.fecha_ingreso }))}"${f.mi_contrato ? ` data-fid="${esc(f.id)}"` : ''} style="margin-top:8px;${f.mi_contrato ? ' cursor:pointer;' : ' opacity:.45; filter:grayscale(1);'}">
        <div class="tarjeta-top"><b>${esc(f.tipo_falla)} · ${esc(DESC_CODIGO[f.tipo_falla] || '')}</b></div>
        <div class="sub">OS ${esc(f.ot || '—')} · ${f.tipo === 'linea' ? 'Circuito ' + esc(f.circuito_id ?? '—') : 'Llave ' + esc(f.llave ?? '—')} · <span class="insignia ${esc(f.estado)}">${esc(ETIQUETA_ESTADO[f.estado] || f.estado)}</span></div>
        ${f.contrato_nombre ? `<div class="sub">${esc(f.contrato_nombre)}${f.asignado_camion ? ' · Asignada a ' + esc(f.asignado_camion) : ''}</div>` : ''}
        ${f.mi_contrato ? '<div class="sub" style="color:#1f7a52; font-weight:600;">Ver en el mapa ›</div>' : ''}
      </div>`).join('')}`;
    // Las fallas de mi contrato (las que no están en gris): al tocarlas se acerca el mapa y se abre la falla
    h.querySelectorAll('[data-fid]').forEach((t) => t.addEventListener('click', () => { cerrarHoja(); abrirFallaPorId(t.dataset.fid); }));
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
$('#navCuad').addEventListener('click', () => abrirCuadrillas());
$('#navMas').addEventListener('click', () => $('#btnMenu').click());

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
    select('usuarios', 'select=id,nombre,rol,email,notificador_externo_habilitado,foto_obligatoria,ver_cuadrillas,ver_ubicacion&order=nombre.asc').catch(() => select('usuarios', 'select=id,nombre,rol,email,notificador_externo_habilitado,foto_obligatoria&order=nombre.asc')),
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

function abrirUsuarios(modo) {
  if (rol() !== 'admin') return;
  if (hojaAbierta) cerrarHoja(true); else { try { history.pushState({ pant: 1 }, ''); } catch (e) { /* */ } }   // el menú ya dejó una entrada en el historial: la reutiliza esta pantalla
  usrHist = true;
  U.modo = modo === 'config' ? 'config' : 'usuarios';
  $('#uTitulo').textContent = U.modo === 'config' ? 'Configuración' : 'Usuarios y permisos';
  U.tab = U.modo === 'config' ? 'contratos' : 'usuarios'; U.q = ''; U.filtro = 'todos'; U.conteo = null;
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
const formUsuarios = () => abrirUsuarios();

/* ------------------ Compartir ubicación (solo camiones, solo con la app abierta) ------------------ */
const ubicActiva = () => true;   // los camiones comparten siempre mientras la app está abierta (el teléfono pide el permiso de GPS)
let ubicTimer = null, ubicUltimo = 0;
function enviarUbicacion() {
  if (rol() !== 'camion' || !ubicActiva() || document.visibilityState !== 'visible' || !navigator.geolocation) return;
  if (Date.now() - ubicUltimo < 45000) return;
  navigator.geolocation.getCurrentPosition((p) => {
    ubicUltimo = Date.now();
    rpc('reportar_ubicacion', { p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_precision: p.coords.accuracy }).catch(() => {});
  }, () => {}, { enableHighAccuracy: true, maximumAge: 20000, timeout: 20000 });
}
function iniciarUbicacion() {
  if (ubicTimer) { clearInterval(ubicTimer); ubicTimer = null; }
  if (rol() !== 'camion' || !ubicActiva()) return;
  enviarUbicacion();
  ubicTimer = setInterval(enviarUbicacion, 60000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') enviarUbicacion(); });
/* ------------------------- Cuadrillas (admin o con permiso) -------------------------
   Misma lógica que la web: por turno, solo cuenta lo que cerró o dejó pendiente un camión. */
const CU_TURNOS = { '0': [0, 8], '1': [8, 16], '2': [16, 24], d: [0, 24] };
const CU_COL = { reparada: '#3a8a5c', pendiente: '#d98e2f', sin: '#c1443c' };
const CU = { datos: null, hist: false, volviendo: false };
const puedeCuadrillas = () => !!S.perfil && (S.perfil.rol === 'admin' || !!S.perfil.ver_cuadrillas);
const puedeUbicacion = () => !!S.perfil && (S.perfil.rol === 'admin' || (S.perfil.ubic_col ? !!S.perfil.ver_ubicacion : !!S.perfil.ver_cuadrillas));
function cuRango() {
  const [y, mo, d] = $('#cuFecha').value.split('-').map(Number);
  const [h0, h1] = CU_TURNOS[$('#cuTurno').value];
  return { desde: new Date(y, mo - 1, d, h0), hasta: new Date(y, mo - 1, d, h1) };
}
const cuHora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—');
function cuDur(ms) { if (ms == null) return '—'; const min = Math.round(ms / 60000); return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`; }
// Atenciones del turno = reparadas + pendientes que dejó la cuadrilla. La píldora usa el mismo relleno que la barra.
function cuPildora(r) {
  const a = r.reparadas + r.pendientes, txt = a + (a === 1 ? ' atención' : ' atenciones');
  const nombres = [...new Set((r.aps || []).map((x) => x.maestro).filter(Boolean))].join(', ');
  const ap = r.aportes ? `<div class="cu-pill cu-ap">🛠 + ${r.aportes} aporte${r.aportes > 1 ? 's' : ''}${nombres ? ' · ' + esc(nombres) : ''}</div>` : '';
  const pr = a ? 100 * r.reparadas / a : 0;
  const base = a ? `<div class="cu-pill" style="background:linear-gradient(90deg,${CU_COL.reparada} ${pr}%,${CU_COL.pendiente} ${pr}%)">${txt}</div>` : `<div class="cu-pill cero">${txt}</div>`;
  return `<div class="cu-pills">${base}${ap}</div>`;
}
function cuCalcular(todasFilas, desde, hasta) {
  // Los aportes son un extra al trabajo normal: no entran en atenciones, cumplimiento ni tiempos
  const aps = todasFilas.filter((r) => r.es_aporte && r.reparada_en && new Date(r.reparada_en) >= desde && new Date(r.reparada_en) < hasta);
  const filas = todasFilas.filter((r) => !r.es_aporte);
  const items = filas.map((r) => {
    const a = new Date(r.asignado_en), rep = r.reparada_en ? new Date(r.reparada_en) : null, fp = r.fecha_pendiente ? new Date(r.fecha_pendiente) : null;
    const repEnTurno = !!(rep && rep >= desde && rep < hasta), pendEnTurno = !!(fp && fp >= a && fp >= desde && fp < hasta);
    const inicioPend = a < desde && !!(fp && fp < desde);
    const reparada = repEnTurno && r.reparado_por_rol === 'camion';
    const porContr = (repEnTurno && r.reparado_por_rol !== 'camion') ? 'reparada' : ((!repEnTurno && pendEnTurno && r.pendiente_por_rol && r.pendiente_por_rol !== 'camion') ? 'pendiente' : null);
    const pendiente = !reparada && !repEnTurno && pendEnTurno && !porContr;
    return { ...r, a, rep, reparada, pendiente, porContr, resultado: reparada ? 'reparada' : (pendiente ? 'pendiente' : 'sin'), inicio: a < desde, inicioPend };
  });
  const reps = items.filter((i) => i.reparada).map((i) => i.rep.getTime()).sort((x, y) => x - y);
  const medio = reps.length > 1 ? (reps[reps.length - 1] - reps[0]) / (reps.length - 1) : null;
  const total = items.length, rep = items.filter((i) => i.reparada).length, pen = items.filter((i) => i.pendiente).length;
  return {
    items, total, inicio: items.filter((i) => i.inicio).length, inicioPend: items.filter((i) => i.inicioPend).length,
    reparadas: rep, pendientes: pen, sin: total - rep - pen,
    aportes: aps.length, aps,
    contrRep: items.filter((i) => i.porContr === 'reparada').length, contrPend: items.filter((i) => i.porContr === 'pendiente').length,
    cumplimiento: total ? Math.round(100 * rep / total) : null, medio,
  };
}
function abrirCuadrillas() {
  if (!puedeCuadrillas()) return;
  if (hojaAbierta) cerrarHoja(true); else { try { history.pushState({ pant: 1 }, ''); } catch (e) { /* */ } }
  $('#cuMapa').hidden = !puedeUbicacion();
  CU.hist = true;
  $('#pantallaCuad').hidden = false;
  if (!$('#cuFecha').value) {
    $('#cuFecha').value = hoyChileStr();
    const h = Number(horaChileStr().slice(0, 2));
    $('#cuTurno').value = h < 8 ? '0' : (h < 16 ? '1' : '2');
  }
  cargarCuadrillas();
}
function cerrarCuadrillas(desdePop) {
  if ($('#pantallaCuad').hidden) return;
  $('#pantallaCuad').hidden = true;
  if (!desdePop && CU.hist) { CU.volviendo = true; try { history.back(); } catch (e) { CU.volviendo = false; } }
  CU.hist = false;
}
window._cuPop = () => { if (CU.volviendo) { CU.volviendo = false; return; } if (!$('#pantallaCuad').hidden) cerrarCuadrillas(true); };
async function cargarCuadrillas() {
  const cont = $('#cuCuerpo');
  if (!$('#cuFecha').value) return;
  cont.innerHTML = '<div class="u-vacio">Cargando…</div>';
  const { desde, hasta } = cuRango();
  const prm = { p_desde: desde.toISOString(), p_hasta: hasta.toISOString() };
  try {
    try { CU.datos = await rpc('rendimiento_cuadrillas_v2', prm); }
    catch (e2) {
      // Sin el SQL nuevo (sql/2026-10-rendimiento-contratos.sql) se usa la función anterior, sin contratos
      CU.datos = await rpc('rendimiento_cuadrillas', prm);
      CU.datos.contratos = []; CU.datos.activas = null;
      CU.datos.cuadrillas.forEach((c) => { c.contratos = []; });
    }
  } catch (e) { cont.innerHTML = `<div class="u-vacio">No se pudo cargar: ${esc(e.message)}</div>`; return; }
  const sel = $('#cuSel'), previo = sel.value;
  const opCuad = (c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`;
  const cts = CU.datos.contratos || [], sinContrato = CU.datos.cuadrillas.filter((c) => !(c.contratos || []).length);
  // Subgrupos por contrato: "Todas las de <contrato>" + cada cuadrilla del contrato (un grupo vacío queda visible)
  sel.innerHTML = '<option value="">Todas</option>' + cts.map((ct) => `<optgroup label="${esc(ct.nombre)}"><option value="c:${esc(ct.id)}">Todas las de ${esc(ct.nombre)}</option>${CU.datos.cuadrillas.filter((c) => (c.contratos || []).includes(ct.id)).map(opCuad).join('')}</optgroup>`).join('')
    + (cts.length ? (sinContrato.length ? `<optgroup label="Sin contrato">${sinContrato.map(opCuad).join('')}</optgroup>` : '') : CU.datos.cuadrillas.map(opCuad).join(''));
  if ([...sel.options].some((o) => o.value === previo)) sel.value = previo;
  pintarCuadrillas();
}
function pintarCuadrillas() {
  if (!CU.datos) return;
  const cont = $('#cuCuerpo'), { desde, hasta } = cuRango(), selId = $('#cuSel').value;
  const ctSel = selId.startsWith('c:') ? selId.slice(2) : null;
  const ctNombre = ctSel ? ((CU.datos.contratos || []).find((x) => x.id === ctSel) || {}).nombre : null;
  const todasLas = CU.datos.cuadrillas.map((c) => ({ c, r: cuCalcular(CU.datos.filas.filter((f) => f.camion_id === c.id), desde, hasta) }));
  const todas = ctSel ? todasLas.filter((x) => (x.c.contratos || []).includes(ctSel)) : todasLas;
  const kpi = (l, v, col, sub) => `<div class="cu-kpi" style="border-top-color:${col}"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="l" style="font-size:10.5px">${sub}</div>` : ''}</div>`;
  let html = '';
  if (!selId || ctSel) {
    const apItems = todas.flatMap((x) => x.r.aps.map((i) => ({ ...i, cuad: x.c.nombre })));
    const G = todas.reduce((g, x) => ({ t: g.t + x.r.total, r: g.r + x.r.reparadas, c: g.c + x.r.contrRep + x.r.contrPend }), { t: 0, r: 0, c: 0 });
    // Fallas activas del contrato (o de todos): abiertas al inicio del turno + ingresadas durante el turno
    const hayAct = Array.isArray(CU.datos.activas);
    const acts = (CU.datos.activas || []).filter((a) => !ctSel || a.contrato_id === ctSel);
    const aIni = acts.reduce((n, a) => n + a.inicio, 0), aIng = acts.reduce((n, a) => n + a.ingresadas, 0), aTot = aIni + aIng;
    if ((CU.datos.contratos || []).length) html += `<div class="cu-sec" style="margin-top:0">${ctNombre ? 'Contrato: ' + esc(ctNombre) : 'Todos los contratos'}</div>`;
    html += `<div class="cu-kpis">${hayAct ? kpi('Fallas activas', aTot, '#1f4d3d', `${aIni} al inicio del turno · ${aIng} ingresadas en el turno`) : ''}${kpi('Asignadas a cuadrillas', G.t, '#9aa5b1', hayAct ? `de ${aTot} activas` : '')}${kpi('Reparadas por camión', G.r, CU_COL.reparada)}${apItems.length ? kpi('Aportes', apItems.length, '#7a5ca8', 'extra al trabajo normal') : ''}${kpi('Cumplimiento de las asignadas', G.t ? Math.round(100 * G.r / G.t) + '%' : '—', '#7a5ca8', G.t ? `${G.r} de ${G.t}` : '')}${kpi('Atendidas por contratista', G.c, '#d98e2f')}</div>`;
    if (!todas.length) html += '<div class="u-vacio">Este contrato aún no tiene cuadrillas.</div>';
    html += todas.map(({ c, r }) => { const t = r.total || 1;
      return `<button class="cu-card" data-c="${esc(c.id)}"><div class="top"><span>${esc(c.nombre)}</span><span style="color:${r.cumplimiento == null ? 'var(--tinta-2)' : (r.cumplimiento >= 60 ? '#1f4d3d' : '#b36b00')}">${r.cumplimiento == null ? '—' : r.cumplimiento + '%'}</span></div>
        ${(r.total || r.aportes) ? `<div class="cu-centro">${cuPildora(r)}</div><div class="cu-barra"><i style="width:${100 * r.reparadas / t}%;background:${CU_COL.reparada}"></i><i style="width:${100 * r.pendientes / t}%;background:${CU_COL.pendiente}"></i><i style="width:${100 * r.sin / t}%;background:${CU_COL.sin}"></i></div>
        <div class="cu-leyenda"><span style="color:${CU_COL.reparada}">● ${r.reparadas} reparadas</span><span style="color:#b36b00">● ${r.pendientes} pend.</span><span style="color:${CU_COL.sin}">● ${r.sin} sin atender</span></div>` : '<div class="s" style="margin-top:6px;color:var(--tinta-2)">Sin fallas en este turno</div>'}
        ${(r.contrRep || r.contrPend) ? `<div class="s" style="margin-top:6px;font-size:12px;color:#8a5200">🔧 ${r.contrRep ? r.contrRep + ' cerrada' + (r.contrRep > 1 ? 's' : '') + ' por contratista' : ''}${r.contrRep && r.contrPend ? ' · ' : ''}${r.contrPend ? r.contrPend + ' pendiente' + (r.contrPend > 1 ? 's' : '') + ' por contratista' : ''}</div>` : ''}</button>`; }).join('') || '<div class="u-vacio">No hay cuadrillas.</div>';
    if (apItems.length) {
      const pm = {};
      apItems.forEach((i) => { const k = i.maestro || 'Sin maestro'; const m = pm[k] || (pm[k] = { n: 0, c: {} }); m.n++; m.c[i.cuad] = (m.c[i.cuad] || 0) + 1; });
      html += `<div class="cu-sec" style="color:#6b4fa0">Aportes por maestro (${apItems.length})</div>` + Object.entries(pm).sort((p, q) => q[1].n - p[1].n).map(([n, m]) =>
        `<div class="cu-fila" style="cursor:default"><b>${esc(n)}</b> · ${m.n} aporte${m.n > 1 ? 's' : ''}<div class="s">${Object.entries(m.c).map(([c, k]) => esc(c) + ' (' + k + ')').join(' · ')}</div></div>`).join('');
    }
  } else {
    const x = todasLas.find((y) => y.c.id === selId); if (!x) { cont.innerHTML = ''; return; }
    const { c, r } = x;
    html += `<h3 style="margin:0 0 8px">${esc(c.nombre)}</h3><div class="cu-kpis">${kpi('Inició con', `${r.inicio}`, '#2563a8')}${kpi('Total', r.total, '#9aa5b1')}${kpi('Atenciones', r.reparadas + r.pendientes, CU_COL.reparada)}${kpi('Reparadas', r.reparadas, CU_COL.reparada)}${kpi('Dejó pendientes', r.pendientes, CU_COL.pendiente)}${kpi('Sin atender', r.sin, CU_COL.sin)}${kpi('Aportes', r.aportes || 0, '#6b4fa0')}${kpi('Cumplimiento', r.cumplimiento == null ? '—' : r.cumplimiento + '%', '#7a5ca8')}</div>
      <div class="s" style="margin:-4px 2px 8px;font-size:12.5px;color:var(--tinta-2)">Tiempo medio entre reparaciones: <b>${cuDur(r.medio)}</b></div>`;
    if (r.aportes) html += `<div class="cu-sec" style="color:#6b4fa0">Aportes del turno (${r.aportes}) · extra al trabajo normal</div>` + r.aps.slice().sort((p, q) => new Date(q.reparada_en) - new Date(p.reparada_en)).map((i) =>
      `<button class="cu-fila" data-f="${esc(i.falla_id)}"><b>${esc(cuHora(i.reparada_en))}</b> · OS ${esc(i.ot || '—')} · ${esc(i.tipo_falla || '')}<div class="s">${esc(i.direccion || '—')}</div><div class="s" style="color:#6b4fa0;font-weight:600">🛠 Aporte · ${esc(i.maestro || 'maestro')}</div></button>`).join('');
    if (!r.total) html += '<div class="u-vacio">Esta cuadrilla no tuvo fallas en este turno.</div>';
    else {
      const hechas = r.items.filter((i) => i.reparada || i.pendiente).sort((p, q) => (q.reparada ? q.rep : new Date(q.fecha_pendiente)) - (p.reparada ? p.rep : new Date(p.fecha_pendiente)));
      const por = r.items.filter((i) => !i.reparada && !i.pendiente).sort((p, q) => p.a - q.a);
      const fila = (i, izq, etq, col) => `<button class="cu-fila" data-f="${esc(i.falla_id)}"><b>${esc(izq)}</b> · OS ${esc(i.ot || '—')} · ${esc(i.tipo_falla || '')}<div class="s">${esc(i.direccion || '—')}</div><div class="s" style="color:${col};font-weight:600">${etq}</div></button>`;
      html += `<div class="cu-sec" style="color:#3a8a5c">Atendidas en el turno (${hechas.length})</div>` + (hechas.length
        ? hechas.map((i) => fila(i, cuHora(i.reparada ? i.reparada_en : i.fecha_pendiente) + (i.es_aporte ? ' · 🛠 aporte de ' + (i.maestro || 'maestro') : ''), '', CU_COL[i.resultado]).replace('<div class="s" style="color:' + CU_COL[i.resultado] + ';font-weight:600"></div>', `<div class="s" style="color:${CU_COL[i.resultado]};font-weight:600">${i.reparada ? '✔ Reparada' : '● Pendiente'}</div>`)).join('')
        : '<div class="s" style="margin:0 2px;color:var(--tinta-2)">Aún no ha atendido ninguna.</div>');
      html += `<div class="cu-sec" style="color:#c1443c">Por atender (${por.length})</div>` + (por.length
        ? por.map((i) => fila(i, i.inicio ? (i.inicioPend ? 'Antes del turno (ya pendiente)' : 'Antes del turno') : 'Asignada ' + cuHora(i.asignado_en), '● Sin atender', CU_COL.sin)).join('')
        : '<div class="s" style="margin:0 2px;color:var(--tinta-2)">No le queda nada por atender.</div>');
    }
  }
  cont.innerHTML = html;
  cont.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { $('#cuSel').value = b.dataset.c; pintarCuadrillas(); cont.scrollTop = 0; }));
  cont.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { cerrarCuadrillas(); abrirFallaPorId(b.dataset.f); }));
}
/* Camiones en el mapa (admin o con permiso de Cuadrillas): se actualizan solos cada minuto */
const CAM = { capa: null, timer: null };
async function cargarCamionesMapa(encuadrar) {
  try {
    const filas = await rpc('ubicaciones_camiones', {});
    if (!CAM.capa) return;
    CAM.capa.clearLayers();
    const pts = [];
    (filas || []).forEach((u) => {
      const min = Math.max(0, Math.round((Date.now() - new Date(u.actualizado_en).getTime()) / 60000));
      const viejo = min > 15, col = viejo ? '#9aa5b1' : '#1f4d3d';
      const icono = L.divIcon({ className: '', iconSize: [0, 0], html: `<div style="transform:translate(-50%,-100%);text-align:center"><div style="background:${col};color:#fff;font-weight:700;font-size:12px;border-radius:12px;padding:3px 9px;white-space:nowrap;border:2px solid #fff;box-shadow:0 1px 4px #0006">🚚 ${esc(u.nombre)}</div><div style="width:0;height:0;margin:0 auto;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${col}"></div></div>` });
      L.marker([u.lat, u.lng], { icon: icono, zIndexOffset: 1000 }).bindTooltip(`${u.nombre} · hace ${min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + (min % 60) + ' min'}`).addTo(CAM.capa);
      pts.push([u.lat, u.lng]);
    });
    $('#badgeCamiones').textContent = `Camiones (${pts.length}) ✕`;
    if (encuadrar) { if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 16 }); else toast('Ningún camión comparte su ubicación ahora', 'error'); }
  } catch (e) { if (encuadrar) toast('No se pudo cargar: ' + e.message, 'error'); }
}
function mostrarCamionesMapa() {
  cerrarCuadrillas();
  cambiarVista('mapa');
  if (!CAM.capa) CAM.capa = L.layerGroup().addTo(map);
  $('#badgeCamiones').hidden = false;
  cargarCamionesMapa(true);
  clearInterval(CAM.timer);
  CAM.timer = setInterval(() => cargarCamionesMapa(false), 60000);
}
function ocultarCamionesMapa() {
  clearInterval(CAM.timer); CAM.timer = null;
  if (CAM.capa) { map.removeLayer(CAM.capa); CAM.capa = null; }
  $('#badgeCamiones').hidden = true;
}
document.addEventListener('DOMContentLoaded', () => {
  $('#cuMapa').addEventListener('click', mostrarCamionesMapa);
  $('#badgeCamiones').addEventListener('click', ocultarCamionesMapa);
  $('#cuAtras').addEventListener('click', () => { if ($('#cuSel').value) { $('#cuSel').value = ''; pintarCuadrillas(); } else cerrarCuadrillas(); });
  ['#cuFecha', '#cuTurno'].forEach((s) => $(s).addEventListener('change', cargarCuadrillas));
  $('#cuSel').addEventListener('change', pintarCuadrillas);
});


function pintarTabsU() {
  const pend = U.notifs.filter((n) => !n.validado).length;
  const tabs = U.modo === 'config' ? [['contratos', 'Contratos'], ['notificadores', 'Notificadores'], ['ajustes', 'Enel y ajustes']] : [['usuarios', 'Usuarios']];
  $('#uTabs').hidden = tabs.length < 2;
  $('#uTabs').innerHTML = tabs
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
    <div id="eHerr"></div>
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
  // Herramientas (permisos que se guardan al tocar): Cuadrillas y Ubicación de camiones
  const pintarHerr = () => {
    const cont = $('#eHerr', h);
    if (u.rol === 'camion') { cont.innerHTML = ''; return; }
    const t = (k, tit, sub) => `<button type="button" class="u-tog ${u[k] ? 'on' : ''}" data-p="${k}" style="margin-top:8px"><span class="u-tx"><b>${tit}</b><span>${sub}</span></span><span class="u-sw ${u[k] ? 'on' : ''}"></span></button>`;
    cont.innerHTML = `<div class="u-lbl" style="margin-top:14px">Herramientas</div>` + t('ver_cuadrillas', '🚚 Cuadrillas', 'Rendimiento de las cuadrillas por turno') + t('ver_ubicacion', '📍 Ubicación de camiones', 'Ver dónde están los camiones (permiso aparte)');
  };
  pintarHerr();
  $('#eHerr', h).addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-p]'); if (!b) return;
    const k = b.dataset.p, nuevo = !u[k];
    b.disabled = true;
    try {
      const r = await api(`/rest/v1/usuarios?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: { [k]: nuevo } });
      if (!r || !r.length) throw new Error('No se guardó (¿falta ejecutar el SQL?)');
      u[k] = nuevo;
      if (id === S.perfil.id) { S.perfil[k] = nuevo; if (k === 'ver_ubicacion') S.perfil.ubic_col = true; }
      toast('Guardado', 'ok');
    } catch (e) { toast('No se pudo guardar: ' + e.message, 'error'); }
    pintarHerr();
  });
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
const DURACION_MAX_INSPECCION_MS = 4 * 3600 * 1000;   // el ITO pierde la inspección a las 4 h de iniciada
const NOMBRES_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
async function refrescarOperativos() {
  S.perfil.operativos = [];
  if (rol() !== 'ito') return;
  try {
    const o = await select('operativos_inspeccion', `fecha=eq.${hoyChileStr()}&select=fecha`);
    S.perfil.operativos = (o || []).map((x) => String(x.fecha).slice(0, 10));
  } catch (e) { /* sin la tabla: no hay operativos */ }
}
function esOperativoHoy() { return (S.perfil.operativos || []).includes(hoyChileStr()); }
function esItoConPauta() { return rol() === 'ito' && Array.isArray(S.perfil.dias_inspeccion); }
function diaIsoHoy() { const d = fechaChileLocal(hoyChileStr(), 12).getUTCDay(); return d === 0 ? 7 : d; }
function textoDiasPauta() { return (S.perfil.dias_inspeccion || []).slice().sort().map((n) => NOMBRES_DIA[n]).join(', '); }
function vencioModo() {
  return rol() === 'ito' && S.modo.tipo === 'inspeccion' && S.modo.inicio && Date.now() - S.modo.inicio >= DURACION_MAX_INSPECCION_MS;
}
function cerrarPorTiempo() {
  S.modo = { tipo: 'agregar', fecha: null, inspId: null }; guardarModo(); pintarModo();
  toast('La inspección se cerró sola al cumplir 4 horas. Usa "Agregar falla" o inicia otra en tu día de ronda.', 'error');
}
setInterval(() => { if (S.perfil && vencioModo()) cerrarPorTiempo(); }, 30000);
/* Botones de la barra inferior que el admin puede ocultar (solo en este teléfono) */
const LS_NAV_OCULTOS = 'fm_nav_ocultos_v1';
const NAV_OPCIONES = [['navLista', 'Activas'], ['navInspC3', 'Inspecciones'], ['navInsp', 'Inspección'], ['navCuad', 'Cuadrillas'], ['navHist', 'Historial']];
function navOcultos() { try { const v = JSON.parse(localStorage.getItem(LS_NAV_OCULTOS) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function aplicarNavOcultos() {
  if (rol() !== 'admin') return;
  const oc = navOcultos();
  NAV_OPCIONES.forEach(([id]) => { if (oc.includes(id)) $('#' + id).hidden = true; });
}
function abrirOpcionesBarra() {
  const oc = navOcultos();
  const h = abrirHoja(`<h2>Botones de la barra</h2><div class="hint">Elige cuáles se muestran abajo. Solo cambia en este teléfono. «Mapa» y «Más» siempre están.</div>
    <div class="m-lista">${NAV_OPCIONES.map(([id, t]) => `<label class="m-fila" style="cursor:pointer"><span class="t">${t}</span><input type="checkbox" data-nav="${id}" ${oc.includes(id) ? '' : 'checked'} style="width:22px;height:22px"></label>`).join('')}</div>`);
  $$('[data-nav]', h).forEach((c) => c.addEventListener('change', () => {
    const o = new Set(navOcultos());
    if (c.checked) o.delete(c.dataset.nav); else o.add(c.dataset.nav);
    try { localStorage.setItem(LS_NAV_OCULTOS, JSON.stringify([...o])); } catch (e) { /* */ }
    pintarModo();
  }));
}
function pintarModo() {
  if (S.perfil && vencioModo()) { S.modo = { tipo: 'agregar', fecha: null, inspId: null }; guardarModo(); }
  $('#navInspC3').hidden = !(rol() === 'contratista3' || rol() === 'admin');
  $('#navCuad').hidden = !puedeCuadrillas();
  $('#navHist').hidden = rol() !== 'admin';
  if (rol() !== 'admin' && S.modoHist) alternarModoHist(false);
  const puede = PUEDE_MODO_INSPECCION.includes(rol());
  const c = $('#chipModo'), n = $('#navInsp');
  n.hidden = !puede;
  aplicarNavOcultos();
  $('#navInferior').classList.toggle('apretado', $$('#navInferior .nav-btn:not([hidden])').length >= 4);
  if (!puede) { c.hidden = true; return; }
  const on = S.modo.tipo === 'inspeccion';
  n.classList.toggle('sel', on);
  c.hidden = !on;
  c.textContent = on ? `📋 Inspección del ${fmtFechaCorta(S.modo.fecha)} activa · toca para terminar` : '';
}
function guardarModo() {
  try {
    if (S.modo.tipo === 'inspeccion') localStorage.setItem(LS_MODO, JSON.stringify({ uid: S.perfil.id, fecha: S.modo.fecha, guardado: Date.now(), inicio: S.modo.inicio || Date.now() }));
    else localStorage.removeItem(LS_MODO);
  } catch (e) { /* */ }
}
function restaurarModo() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_MODO) || 'null');
    if (!s || s.uid !== S.perfil.id || !PUEDE_MODO_INSPECCION.includes(rol())) return;
    const dias = Math.round((fechaChileLocal(hoyChileStr(), 12) - fechaChileLocal(s.fecha, 12)) / 86400000);
    const ini = s.inicio || s.guardado || 0;
    const vencida = Date.now() - (s.guardado || 0) > 36 * 3600 * 1000 || s.fecha > hoyChileStr() || (rol() !== 'admin' && dias > DIAS_MAX_INSPECCION)
      || (rol() === 'ito' && Date.now() - ini >= DURACION_MAX_INSPECCION_MS);
    if (vencida) { localStorage.removeItem(LS_MODO); return; }
    S.modo = { tipo: 'inspeccion', fecha: s.fecha, inspId: null, inicio: ini };
  } catch (e) { /* */ }
}
async function abrirInspeccion() {
  const on = S.modo.tipo === 'inspeccion';
  if (!on) await refrescarOperativos();
  let bloqueo = '';
  if (!on && esItoConPauta()) {
    if (!S.perfil.dias_inspeccion.length && !esOperativoHoy()) bloqueo = 'Aún no tienes días de inspección asignados. Pídele al administrador que los habilite; mientras tanto usa <b>Agregar falla</b>.';
    else if (!S.perfil.dias_inspeccion.includes(diaIsoHoy()) && !esOperativoHoy()) bloqueo = `Hoy no es tu día de inspección (tus días: ${esc(textoDiasPauta())}). Hoy usa <b>Agregar falla</b>.`;
  }
  const h = abrirHoja(`
    <h2>Inspección</h2>
    <p class="hint" style="font-size:14px;margin-top:6px">Con la inspección activa, todas las fallas que reportes quedan dentro de ella (para la estadística), cada una con la fecha y hora exactas en que la registras. Si la inspección es nocturna y pasa de medianoche, conserva la fecha en que la iniciaste. Cualquier otro ajuste se hace en la página de escritorio.</p>
    ${on ? `<div class="aviso"><b>Inspección activa</b> iniciada el ${esc(fmtFechaCorta(S.modo.fecha))}${rol() === 'ito' && S.modo.inicio ? ` · se cierra sola a las ${new Date(S.modo.inicio + DURACION_MAX_INSPECCION_MS).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' })}` : ''}</div>` : ''}
    ${bloqueo ? `<div class="aviso">${bloqueo}</div>` : (!on && esItoConPauta() && esOperativoHoy() && !S.perfil.dias_inspeccion.includes(diaIsoHoy()) ? '<div class="aviso">🚨 <b>Operativo</b> activo hoy: puedes inspeccionar aunque no sea tu día.</div>' : '')}
    <div class="acciones">
      ${on ? '<button id="mTerminar" class="btn btn-primario">Terminar inspección</button>' : (bloqueo ? '' : '<button id="mInsp" class="btn btn-primario">Comenzar inspección</button>')}
    </div>`);
  const mi = $('#mInsp', h);
  if (mi) mi.addEventListener('click', ocupar(mi, async () => {
    const f = hoyChileStr();
    S.modo = { tipo: 'inspeccion', fecha: f, inspId: null, inicio: Date.now() };
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
  if (!f) { avisoDiag('no-encontrada'); toast('No se encontró la falla del aviso (puede haber sido eliminada).', 'error'); return; }
  cambiarVista('mapa');
  // Entrando por un aviso el mapa se queda en la falla: sin centrado inicial en tu ubicación y sin seguimiento
  S.centrarAlFijar = false; detenerSeguir();
  if (map && f._c) map.setView(f._c, Math.max(map.getZoom(), 18), { animate: false });   // sin animación: el ajuste por la ficha se aplica después
  abrirFalla(f.properties, f.geometry);
  verSobreFicha(f._c);
}
async function avisoPendienteSW(consumir) {
  try {
    if (!window.caches) return null;
    const c = await caches.open('fm-aviso');
    const r = await c.match('pendiente');
    if (!r) return null;
    if (consumir) await c.delete('pendiente');
    const d = await r.json();
    return d && d.id && /^[\w-]{1,64}$/.test(d.id) && Date.now() - (d.t || 0) < 300000 ? d.id : null;
  } catch (e) { return null; }
}
async function recogerAvisoPendiente() {
  if (!S.perfil) return;
  const id = await avisoPendienteSW(true);
  if (!id) return;
  S.fallaPendiente = id; abrirPendienteDeAviso();
}
function fallaDeUrl() {
  try {
    const u = new URL(location.href), id = u.searchParams.get('falla');
    if (id) { u.searchParams.delete('falla'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); }
    return id && /^[\w-]{1,64}$/.test(id) ? id : null;
  } catch (e) { return null; }
}
// Anota qué pasó con el último aviso (se muestra en «Más») para poder ver por qué no abrió, si no abre
function avisoDiag(estado, msg) { try { localStorage.setItem('fm_aviso_diag', JSON.stringify({ t: Date.now(), estado, msg: msg || '' })); } catch (e) { /* */ } }
async function abrirPendienteDeAviso() {
  const id = S.fallaPendiente; S.fallaPendiente = null;
  if (id && S._avisoAbriendo && S._avisoAbriendo.id === id && Date.now() - S._avisoAbriendo.t < 4000) return;   // mismo aviso llegado por dos vías a la vez
  if (id) {
    S._avisoAbriendo = { id, t: Date.now() };
    try { localStorage.setItem('fm_aviso_reciente', JSON.stringify({ id, t: Date.now() })); } catch (e) { /* */ }
    // Desde ya (no cuando termine de cargar la falla): sin seguimiento ni centrado automático sobre tu ubicación
    S.sinAutoSeguir = true; S.centrarAlFijar = false; detenerSeguir();
    try { await abrirFallaPorId(id); avisoDiag('abierta'); }
    catch (e) { avisoDiag('error', e.message); toast('No se pudo abrir la falla del aviso.', 'error'); }
  }
}
async function textoDiagAviso() {
  const partes = [];
  try {
    const c = await caches.open('fm-aviso'), r = await c.match('ultimo');
    if (r) { const d = await r.json(); partes.push(`Último toque de aviso: ${fmtFechaHoraCorta(new Date(d.t).toISOString())} (${d.via === 'foco' ? 'con la app abierta' : 'con la app cerrada'})`); }
  } catch (e) { /* */ }
  try {
    const d = JSON.parse(localStorage.getItem('fm_aviso_diag') || 'null');
    if (d) partes.push(`Resultado: ${d.estado === 'abierta' ? 'falla abierta' : d.estado === 'no-encontrada' ? 'no se encontró la falla' : 'error ' + d.msg} (${fmtFechaHoraCorta(new Date(d.t).toISOString())})`);
  } catch (e) { /* */ }
  try { const t = Number(localStorage.getItem('fm_carga')); if (t) partes.push(`Última carga de la app: ${fmtFechaHoraCorta(new Date(t).toISOString())}`); } catch (e) { /* */ }
  return partes.join('\n');
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
      ${rol() === 'camion' ? '<div class="hint" style="margin:4px 6px 8px">📍 Tu ubicación se comparte con el administrador mientras la app está abierta.</div>' : ''}
      ${(puedeUbicacion() && !puedeCuadrillas()) || ['contratista', 'contratista2', 'contratista3', 'admin'].includes(rol()) ? '<div class="m-grupo">Operación</div>' : ''}
      ${puedeUbicacion() && !puedeCuadrillas() ? `<button id="mCamiones" class="m-fila"><span class="m-ico m-azul">${ico('<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>')}</span><span class="t">Camiones en el mapa</span>${chev}</button>` : ''}
      ${['contratista', 'contratista2', 'contratista3', 'admin'].includes(rol()) ? `<button id="mMaestros" class="m-fila"><span class="m-ico m-azul">${ico('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.5-4 3-6 7-6s6.5 2 7 6"/>')}</span><span class="t">Maestros</span>${chev}</button>` : ''}
      ${rol() === 'admin' ? '<div class="m-grupo">Administración</div>' : ''}
      ${rol() === 'admin' ? `<button id="mUsuarios" class="m-fila"><span class="m-ico m-azul">${ico('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6"/><path d="M17 11h5M19.5 8.5v5"/>')}</span><span class="t">Usuarios y permisos</span>${chev}</button>` : ''}
      ${rol() === 'admin' ? `<button id="mConfig" class="m-fila"><span class="m-ico m-ambar">${ico('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>')}</span><span class="t">Configuración</span>${chev}</button>` : ''}
      <div class="m-grupo">Cuenta</div>
      <button id="mPush" class="m-fila" hidden><span class="m-ico m-ambar">${ico('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21h4"/>')}</span><span class="t">Avisos</span>${chev}</button>
      ${rol() === 'admin' ? `<button id="mBarra" class="m-fila"><span class="m-ico m-azul">${ico('<rect x="3" y="15" width="18" height="5" rx="2"/><path d="M7 9h10M7 5h10"/>')}</span><span class="t">Botones de la barra</span>${chev}</button>` : ''}
      <button id="mActualizar" class="m-fila"><span class="m-ico m-verde">${ico('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')}</span><span class="t">Actualizar la app</span></button>
      <div id="mDiag" class="hint" style="margin:8px 6px 0;white-space:pre-line"></div>
      <button id="mSalir" class="m-fila m-rojo"><span class="m-ico m-rojo-ico">${ico('<path d="M9 4H5v16h4"/><path d="M16 8l4 4-4 4M20 12H9"/>')}</span><span class="t">Cerrar sesión</span></button>
    </div>`);
  $('#hoja').classList.add('hoja-menu');
  textoDiagAviso().then((t) => { const d = $('#mDiag', h); if (d && t) d.textContent = t; });
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
  const mcm = $('#mCamiones', h);
  if (mcm) mcm.addEventListener('click', () => { cerrarHoja(); mostrarCamionesMapa(); });
  const mcu = $('#mCuadrillas', h);
  if (mcu) mcu.addEventListener('click', () => abrirCuadrillas());
  const mma = $('#mMaestros', h);
  if (mma) mma.addEventListener('click', () => abrirMaestros());
  const mu = $('#mUsuarios', h);
  if (mu) mu.addEventListener('click', () => abrirUsuarios('usuarios'));
  const mba = $('#mBarra', h);
  if (mba) mba.addEventListener('click', () => abrirOpcionesBarra());
  const mcf = $('#mConfig', h);
  if (mcf) mcf.addEventListener('click', () => abrirUsuarios('config'));
  $('#mActualizar', h).addEventListener('click', () => { $('#mActualizar', h).querySelector('.t').textContent = 'Actualizando…'; forzarActualizacion(); });
  $('#mSalir', h).addEventListener('click', async () => { try { await desactivarPush(); } catch (e) { /* */ } salir(); });
});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.instalar = e; });

/* ------------------------------ arranque ------------------------------ */
async function entrarApp() {
  if (typeof L === 'undefined') throw new Error('No se pudo cargar el mapa. Revisa tu conexión y recarga la página.');
  await cargarPerfil();
  cargarLibreria();   // códigos de falla y de cierre de la Librería (sin bloquear la entrada)
  iniciarUbicacion();
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
  // En iPhone, al tocar el aviso con la app cerrada, la dirección con la falla puede perderse: el aviso queda anotado
  // por el service worker y se recoge aquí, ya que al abrir de cero no hay ningún evento de "volver a la app".
  // Se abre ANTES de cargar todas las fallas (esa carga puede tardar o fallar y el aviso no debe depender de ella).
  if (!S.fallaPendiente) { try { const idp = await avisoPendienteSW(true); if (idp) S.fallaPendiente = idp; } catch (e) { /* */ } }
  // iPhone: si el sistema recarga la app justo después de tocar el aviso, la falla se vuelve a abrir (sin centrar en tu ubicación)
  if (!S.fallaPendiente) {
    try {
      const r = JSON.parse(localStorage.getItem('fm_aviso_reciente') || 'null');
      if (r && r.id && /^[\w-]{1,64}$/.test(r.id) && Date.now() - r.t < 25000) S.fallaPendiente = r.id;
    } catch (e) { /* */ }
  }
  try { localStorage.setItem('fm_carga', String(Date.now())); } catch (e) { /* */ }
  const habiaAviso = !!S.fallaPendiente;
  if (habiaAviso) toast('Abriendo la falla del aviso…', '');
  abrirPendienteDeAviso();
  await cargarFallas();
  if (!habiaAviso) restaurarBorrador();
  cargarArea(true);
  if (habiaAviso) S.sinAutoSeguir = true;
  S.centrarAlFijar = !habiaAviso;   // si se entró por un aviso, el mapa se queda en esa falla
  iniciarGPS();
  iniciarPush();
  revisarVersion();
  clearInterval(S.timer);
  S.timer = setInterval(() => { if (!document.hidden && !hojaAbierta) cargarFallas(); }, REFRESCO_MS);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.perfil) { cargarFallas(); revisarVersion(); setTimeout(recogerAvisoPendiente, 400); } });
window.addEventListener('focus', () => setTimeout(recogerAvisoPendiente, 400));
window.addEventListener('pageshow', () => setTimeout(recogerAvisoPendiente, 400));

(async function iniciar() {
  if ('serviceWorker' in navigator && navigator.serviceWorker.addEventListener) {
    const habiaControlador = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!habiaControlador || S.recargando) return;
      S.recargando = true;
      const recargar = () => { if (!hojaAbierta) location.reload(); else setTimeout(recargar, 3000); };
      setTimeout(recargar, 1200);   // recarga en silencio (si hay una hoja abierta, espera a que la cierren)
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
      if (S.perfil) abrirPendienteDeAviso();
    });
  }
  cargarSesion();
  if (!sesion) { mostrarLogin(); return; }
  try { await entrarApp(); } catch (e) {
    if (e.name === 'SesionExpirada') mostrarLogin(e.message); else mostrarLogin(e.message);
  }
})();
