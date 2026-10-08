'use strict';
/* =========================================================================
   Fallas Alumbrado — La Florida · App móvil (PWA)
   - Misma base de datos y mismos permisos (RLS) que la página web.
   - Solo reporta fallas (punto / circuito) y registra reparaciones.
   - Estadísticas, análisis y gestión de usuarios siguen en la web.
   ========================================================================= */

const SUPABASE_URL = 'https://rcwtqvhssgtufgypnobn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7DTKNsCtPUlaQVDhiwVtoA_o5A_dIcu';
const VERSION_APP = '1.0.0';

const LS_SESION = 'fm_sesion_v1';
const LS_PERFIL = 'fm_perfil_v1';
const LS_MODO = 'fm_modo_v1';

const ZOOM_DATOS = 17;          // desde este zoom se cargan y se pueden tocar puntos y circuitos
const REFRESCO_MS = 60000;      // actualización automática de fallas
const DIAS_MAX_INSPECCION = 3;  // misma regla que la base (admin sin límite)

const PUEDE_REPORTAR = ['ito', 'ito2', 'admin', 'contratista2'];
const PUEDE_CERRAR = ['contratista', 'contratista2', 'camion', 'admin'];
const PUEDE_MODO_INSPECCION = ['ito', 'ito2', 'admin'];

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
function sumarDiasStr(fechaStr, dias) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}
function fmtFecha(iso) { return iso ? FMT_VISTA.format(new Date(iso)) : '—'; }
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

/* ------------------------------ estado ------------------------------ */
const S = {
  perfil: null,
  features: [],       // fallas_geojson (todas las que devuelve la base)
  activas: [],        // no reparadas
  pos: null,          // {lat, lng, prec}
  watchId: null,
  centrarAlFijar: false,
  vista: 'mapa',
  filtro: 'todas',
  busqueda: '',
  modo: { tipo: 'agregar', fecha: null, inspId: null },
  instalar: null,
};
const rol = () => (S.perfil ? S.perfil.rol : null);
const rolVisible = () => (rol() === 'contratista2' ? 'contratista' : rol());
const puedeReportar = () => PUEDE_REPORTAR.includes(rol());
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
let hojaAbierta = false;
function abrirHoja(html) {
  $('#hojaContenido').innerHTML = html;
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
  if (!desdePop && history.state && history.state.hoja) { try { history.back(); } catch (e) { /* */ } }
}
window.addEventListener('popstate', () => { if (hojaAbierta) cerrarHoja(true); });
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
  detenerGPS();
  clearInterval(S.timer);
  cerrarHoja();
  S.perfil = null; S.features = []; S.activas = [];
  S.modo = { tipo: 'agregar', fecha: null, inspId: null };
  mostrarLogin(msg);
}

async function cargarPerfil() {
  try {
    const f = await select('usuarios', `id=eq.${sesion.user_id}&select=id,nombre,rol`);
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
let map, rend, capaCircuitos, capaPuntos, capaFallas, marcadorPos, circuloPos;
let cacheBbox = null;

function iniciarMapa() {
  if (map) { map.invalidateSize(); return; }
  map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 20 }).setView([-33.52, -70.58], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  rend = L.canvas({ padding: 0.5, tolerance: 12 });
  capaCircuitos = L.geoJSON(null, { renderer: rend });
  capaPuntos = L.geoJSON(null, { renderer: rend });
  capaFallas = L.geoJSON(null, { renderer: rend });
  map.on('moveend', cargarArea);
  map.on('zoomend', () => { ajustarRadios(); dibujarFallas(); });
  map.on('click', () => { /* un toque en el vacío no hace nada */ });
}
const radioPunto = () => { const z = map.getZoom(); return z >= 19 ? 11 : z >= 18 ? 9 : 7; };
function ajustarRadios() { const r = radioPunto(); capaPuntos.eachLayer((l) => l.setRadius && l.setRadius(r)); }

function expandir(b, f) {
  const dx = (b[2] - b[0]) * f, dy = (b[3] - b[1]) * f;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
}
const contenido = (c, b) => c && b[0] >= c[0] && b[1] >= c[1] && b[2] <= c[2] && b[3] <= c[3];

async function cargarArea(forzar) {
  if (!map) return;
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
  if (forzar !== true && contenido(cacheBbox, bbox)) return;
  const grande = expandir(bbox, 0.4);
  try {
    const args = { min_lon: grande[0], min_lat: grande[1], max_lon: grande[2], max_lat: grande[3] };
    const [circ, pts] = await Promise.all([rpc('circuitos_en_area', args), rpc('puntos_en_area', args)]);
    capaCircuitos.clearLayers();
    capaPuntos.clearLayers();
    if (circ) {
      L.geoJSON(circ, {
        renderer: rend,
        style: { color: '#2563a8', weight: 4, opacity: 0.75 },
        onEachFeature: (f, l) => l.on('click', (e) => { L.DomEvent.stopPropagation(e); abrirCircuito(f.properties); }),
      }).eachLayer((l) => capaCircuitos.addLayer(l));
    }
    if (pts) {
      L.geoJSON(pts, {
        pointToLayer: (f, ll) => L.circleMarker(ll, { renderer: rend, radius: radioPunto(), weight: 2, color: '#1f4d3d', fillColor: '#ffd54a', fillOpacity: 0.9 }),
        onEachFeature: (f, l) => l.on('click', (e) => { L.DomEvent.stopPropagation(e); abrirPunto(f.properties, f.geometry); }),
      }).eachLayer((l) => capaPuntos.addLayer(l));
    }
    cacheBbox = grande;
    capaFallas.bringToFront && capaFallas.bringToFront();
  } catch (e) {
    if (e.name === 'SesionExpirada') salir(e.message); else toast(e.message, 'error');
  }
}

function dibujarFallas() {
  if (!map || !capaFallas) return;
  const z = map.getZoom();
  capaFallas.clearLayers();
  S.features.forEach((f) => {
    const p = f.properties;
    const reparada = p.estado === 'reparada';
    if (p.cascada && z < ZOOM_DATOS) return;
    const color = COLOR_ESTADO[p.estado] || '#d33a2c';
    let capa;
    if (f.geometry.type === 'Point') {
      const [lng, lat] = f.geometry.coordinates;
      const r = p.cascada ? (z >= 18 ? 7 : 5) : (z >= 18 ? 13 : z >= 16 ? 11 : 8);
      capa = L.circleMarker([lat, lng], { renderer: rend, radius: r, weight: 3, color: '#fff', fillColor: color, fillOpacity: reparada ? 0.55 : 0.95, interactive: !reparada });
    } else {
      capa = L.geoJSON(f.geometry, { renderer: rend, style: { color, weight: 7, opacity: reparada ? 0.45 : 0.9 }, interactive: !reparada });
    }
    if (!reparada) capa.on('click', (e) => { L.DomEvent.stopPropagation(e); abrirFalla(p, f.geometry); });
    capaFallas.addLayer(capa);
  });
}

/* ------------------------------ GPS ------------------------------ */
function iniciarGPS() {
  if (!navigator.geolocation) { toast('Este dispositivo no tiene GPS disponible.', 'error'); return; }
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
      circuloPos = L.circle(ll, { radius: S.pos.prec, weight: 1, color: '#2563a8', fillColor: '#2563a8', fillOpacity: 0.12, interactive: false }).addTo(map);
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
async function cargarFallas(manual) {
  const btn = $('#btnActualizar');
  if (manual) btn.classList.add('girando');
  try {
    const geo = await rpc('fallas_geojson', {});
    S.features = ((geo && geo.features) || []).map((f) => { f._c = centroGeom(f.geometry); return f; });
    S.activas = S.features.filter((f) => f.properties.estado !== 'reparada');
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
$('#btnActualizar').addEventListener('click', () => { cargarFallas(true); cargarArea(true); });

/* ----------------------- hojas: punto y circuito ----------------------- */
function infoSoloLectura() {
  if (puedeReportar()) return '';
  return `<div class="aviso">Con tu perfil (${esc(rolVisible())}) puedes ver el mapa${puedeCerrar() ? ' y registrar reparaciones desde las fallas activas' : ''}. Reportar fallas lo hacen los ITO.</div>`;
}
function modoTexto() {
  return S.modo.tipo === 'inspeccion'
    ? `Se guardará dentro de tu <b>inspección del ${esc(fmtFechaCorta(S.modo.fecha))}</b>.`
    : 'Se guardará como falla informada <b>ahora</b>.';
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
async function contextoReporte() {
  if (S.modo.tipo !== 'inspeccion' || !S.modo.fecha) return {};
  if (!S.modo.inspId || S.modo.inspFecha !== S.modo.fecha) {
    S.modo.inspId = await rpc('obtener_o_crear_inspeccion', { p_fecha: S.modo.fecha, p_ito: null });
    S.modo.inspFecha = S.modo.fecha;
  }
  return { p_inspeccion_id: S.modo.inspId, p_fecha_falla: fechaChileLocal(S.modo.fecha, 23, 50, 0).toISOString() };
}

function formReportePunto(p) {
  const mono = String(p.simb_poste || '').toUpperCase().trim() === 'MONOPOSTE';
  const cat = mono ? CAT_MONOPOSTE : CAT_PUNTO;
  let codigo = null, card = null;
  const h = abrirHoja(`
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
    <p class="hint" style="margin-top:12px">${modoTexto()}</p>
    <div class="acciones fija"><button id="fEnviar" class="btn btn-primario">Confirmar reporte</button></div>`);
  $$('.codigo', h).forEach((b) => b.addEventListener('click', () => {
    $$('.codigo', h).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); codigo = b.dataset.c;
  }));
  $$('#fCard button', h).forEach((b) => b.addEventListener('click', () => {
    const ya = b.classList.contains('sel');
    $$('#fCard button', h).forEach((x) => x.classList.remove('sel'));
    if (!ya) { b.classList.add('sel'); card = b.dataset.r; } else card = null;
  }));
  const env = $('#fEnviar', h);
  env.addEventListener('click', ocupar(env, async () => {
    if (!codigo) { toast('Selecciona un código de falla.', 'error'); return; }
    const desc = $('#fDesc', h).value.trim();
    if (codigo === 'OTRO' && !desc) { toast('Describe la falla.', 'error'); return; }
    const oe = leerOrdenExterna(h);
    if (oe.error) { toast(oe.error, 'error'); return; }
    env.textContent = 'Enviando…';
    const ctx = await contextoReporte();
    const r = await rpc('crear_falla_punto', { p_punto_gid: p.gid, p_tipo_falla: codigo, p_cardinalidad: card, p_descripcion: desc || null, p_orden_externa: oe.valor, ...ctx });
    cerrarHoja();
    toast(`Falla registrada · OS ${r.ot}${r.estado === 'reiterada' ? ' (reiterada)' : ''}`, 'ok');
    cargarFallas();
  }));
}

function formReporteCircuito(p) {
  let codigo = null;
  const h = abrirHoja(`
    <h2>Reportar falla de circuito</h2>
    <div class="hint">Circuito ${esc(p.id ?? '')} · ${esc(p.cantidad_luminarias_cliente ?? '—')} luminarias</div>
    <div class="aviso">Se crea una falla por cada punto del circuito. Al reparar el circuito se cierran todas juntas.</div>
    <h3>Código de falla</h3>${htmlCodigos(CAT_CIRCUITO)}
    <h3>Comentario</h3>
    <textarea id="fDesc" class="campo" placeholder="Opcional (obligatorio si eliges OTRO)"></textarea>
    <h3>Orden externa (opcional)</h3>${htmlOrdenExterna()}
    <p class="hint" style="margin-top:12px">${modoTexto()}</p>
    <div class="acciones fija"><button id="fEnviar" class="btn btn-primario">Confirmar reporte</button></div>`);
  $$('.codigo', h).forEach((b) => b.addEventListener('click', () => {
    $$('.codigo', h).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); codigo = b.dataset.c;
  }));
  const env = $('#fEnviar', h);
  env.addEventListener('click', ocupar(env, async () => {
    if (!codigo) { toast('Selecciona un código de falla.', 'error'); return; }
    const desc = $('#fDesc', h).value.trim();
    if (codigo === 'OTRO' && !desc) { toast('Describe la falla.', 'error'); return; }
    const oe = leerOrdenExterna(h);
    if (oe.error) { toast(oe.error, 'error'); return; }
    env.textContent = 'Enviando…';
    const ctx = await contextoReporte();
    const r = await rpc('crear_falla_circuito', { p_circuito_gid: p.gid, p_tipo_falla: codigo, p_descripcion: desc || null, p_orden_externa: oe.valor, ...ctx });
    cerrarHoja();
    toast(`Falla registrada · OS ${r.ot} · ${r.puntos_afectados} puntos afectados`, 'ok');
    cargarFallas();
  }));
}

/* ------------------------ hoja: detalle de falla ------------------------ */
function tipoLabel(p) { return p.tipo === 'punto' ? (p.cascada ? 'Punto (por circuito)' : 'Punto lumínico') : 'Circuito'; }
function urlComoLlegar(c) { return `https://www.google.com/maps/dir/?api=1&destination=${c[0]},${c[1]}&travelmode=driving`; }

async function abrirFalla(p, geom) {
  const c = centroGeom(geom);
  const desc = DESC_CODIGO[p.tipo_falla];
  const kv = [
    ['OS', p.ot || '—'],
    p.orden_externa ? ['Orden externa', p.orden_externa] : null,
    ['Tipo', tipoLabel(p)],
    p.tipo === 'punto' ? ['Llave / N.° mun.', `${p.llave ?? '—'} / ${p.nro_mun ?? '—'}`] : ['Puntos afectados', p.puntos_afectados ?? '—'],
    p.cardinalidad ? ['Cardinalidad', p.cardinalidad] : null,
    ['Informó', p.nombre_creador || p.nombre_real_creador || '—'],
    ['Fecha de la falla', fmtFecha(p.fecha_falla)],
    p.asignado_camion_nombre ? ['Camión asignado', p.asignado_camion_nombre] : null,
  ].filter(Boolean);
  const puedeCerrarEsta = puedeCerrar() && !p.cascada && p.estado !== 'reparada';
  const h = abrirHoja(`
    <h2>${esc(p.tipo_falla)}${desc ? ' · ' + esc(desc) : ''}</h2>
    <div style="margin-top:6px"><span class="insignia ${esc(p.estado)}">${esc(ETIQUETA_ESTADO[p.estado] || p.estado)}</span></div>
    <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${p.estado === 'pendiente' ? `<div class="aviso"><b>Pendiente</b> por ${esc(p.pendiente_por_nombre || '—')} · ${esc(fmtFecha(p.fecha_pendiente))}<br><pre class="texto">${esc(p.motivo_pendiente || '')}</pre></div>` : ''}
    ${p.cascada ? `<div class="aviso" id="avCascada">Este punto se cierra automáticamente al reparar su circuito.</div>` : ''}
    <div class="acciones" id="accFalla">
      ${puedeCerrarEsta ? `<button id="bCerrar" class="btn btn-primario">Registrar reparación</button>` : ''}
      <a class="btn btn-secundario" style="display:flex;align-items:center;justify-content:center;text-decoration:none" target="_blank" rel="noopener" href="${esc(urlComoLlegar(c))}">Cómo llegar</a>
    </div>
    <h3>Historial</h3>
    <ul class="linea-tiempo" id="histFalla"><li class="hint">Cargando…</li></ul>`);
  const bc = $('#bCerrar', h);
  if (bc) bc.addEventListener('click', () => formCierre(p));
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

function formCierre(p) {
  let sel = [];
  const h = abrirHoja(`
    <h2>Registrar reparación</h2>
    <div class="hint">${esc(p.tipo_falla)} · OS ${esc(p.ot || '—')} · ${esc(tipoLabel(p))}${p.tipo === 'linea' ? ' · se cerrarán también sus ' + esc(p.puntos_afectados ?? '') + ' puntos' : ''}</div>
    <h3>Trabajo realizado</h3>
    <div class="codigos">${CAT_CIERRES.map((x) => `<button type="button" class="codigo" data-t="${esc(x.c + ' ' + x.d)}"><b>${esc(x.c)}</b><span>${esc(x.d)}</span></button>`).join('')}</div>
    <h3>Información adicional</h3>
    <textarea id="cDesc" class="campo" placeholder="Ej: detalle de lo realizado. Obligatorio si dejas la falla pendiente."></textarea>
    <div class="acciones fija">
      <button id="cOk" class="btn btn-primario">Registrar reparación y cerrar falla</button>
      <button id="cPend" class="btn btn-ambar">Dejar pendiente</button>
    </div>`);
  $$('.codigo', h).forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.t, i = sel.indexOf(t);
    if (i >= 0) { sel.splice(i, 1); b.classList.remove('sel'); } else { sel.push(t); b.classList.add('sel'); }
  }));
  const texto = () => { const libre = $('#cDesc', h).value.trim(); return [...sel, ...(libre ? [libre] : [])].join('\n'); };
  const ok = $('#cOk', h), pend = $('#cPend', h);
  ok.addEventListener('click', ocupar(ok, async () => {
    const d = texto();
    if (!d) { toast('Elige el trabajo realizado o describe la reparación.', 'error'); return; }
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
  let items = S.activas.filter((f) => !f.properties.cascada);
  const total = items.length;
  if (S.filtro !== 'todas') items = items.filter((f) => f.properties.estado === S.filtro || (S.filtro === 'reportada' && f.properties.estado === 'reiterada'));
  if (q) {
    items = items.filter((f) => {
      const p = f.properties;
      return [p.ot, p.orden_externa, p.tipo_falla, DESC_CODIGO[p.tipo_falla], p.llave, p.nro_mun, p.nombre_creador].some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }
  items = items.map((f) => ({ f, d: S.pos ? distanciaM([S.pos.lat, S.pos.lng], f._c) : null }));
  if (S.pos) items.sort((a, b) => a.d - b.d);
  else items.sort((a, b) => String(b.f.properties.ot).localeCompare(String(a.f.properties.ot)));
  $('#listaResumen').textContent = `${items.length} de ${total} fallas activas · ${S.pos ? 'ordenadas por cercanía' : 'más recientes primero (activa el GPS para ordenar por cercanía)'}`;
  $('#listaItems').innerHTML = items.length ? items.map(({ f, d }, i) => {
    const p = f.properties;
    return `<button class="tarjeta est-${esc(p.estado)}" data-i="${i}">
      <div class="tarjeta-top"><b>${esc(p.tipo_falla)} · ${esc(DESC_CODIGO[p.tipo_falla] || '')}</b>${d != null ? `<span class="dist">${esc(fmtDist(d))}</span>` : ''}</div>
      <div class="sub">OS ${esc(p.ot || '—')} · ${p.tipo === 'punto' ? 'Llave ' + esc(p.llave ?? '—') : esc(p.puntos_afectados ?? '') + ' puntos (circuito)'} · <span class="insignia ${esc(p.estado)}">${esc(ETIQUETA_ESTADO[p.estado] || p.estado)}</span></div>
      <div class="sub">${esc(p.nombre_creador || '—')} · ${esc(hace(p.fecha_falla))}</div>
    </button>`;
  }).join('') : '<div class="vacio">No hay fallas activas con este filtro.</div>';
  $$('#listaItems .tarjeta').forEach((b) => b.addEventListener('click', () => {
    const { f } = items[Number(b.dataset.i)];
    cambiarVista('mapa');
    map.setView(f._c, Math.max(map.getZoom(), 18));
    abrirFalla(f.properties, f.geometry);
  }));
}
$('#listaBuscar').addEventListener('input', (e) => { S.busqueda = e.target.value; renderLista(); });
$$('#listaChips .chip').forEach((b) => b.addEventListener('click', () => {
  $$('#listaChips .chip').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); S.filtro = b.dataset.f; renderLista();
}));

function cambiarVista(v) {
  S.vista = v;
  $('#vistaMapa').hidden = v !== 'mapa';
  $('#vistaLista').hidden = v !== 'lista';
  $$('.nav-btn').forEach((b) => b.classList.toggle('sel', b.dataset.vista === v));
  if (v === 'mapa' && map) { setTimeout(() => { map.invalidateSize(); cargarArea(); }, 50); }
  if (v === 'lista') renderLista();
  $('#zoomAviso').hidden = v !== 'mapa' || (map && map.getZoom() >= ZOOM_DATOS);
}
$$('.nav-btn').forEach((b) => b.addEventListener('click', () => cambiarVista(b.dataset.vista)));

/* ------------------------- modo: agregar / inspección ------------------------- */
function pintarChipModo() {
  const c = $('#chipModo');
  if (!PUEDE_MODO_INSPECCION.includes(rol())) { c.hidden = true; return; }
  c.hidden = false;
  if (S.modo.tipo === 'inspeccion') {
    c.className = 'chip-modo insp';
    c.textContent = `📋 Inspección del ${fmtFechaCorta(S.modo.fecha)} · toca para cambiar`;
  } else {
    c.className = 'chip-modo';
    c.textContent = '➕ Modo: agregar falla (ahora) · toca para cambiar';
  }
  if (map) setTimeout(() => map.invalidateSize(), 50);
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
    const vencida = Date.now() - (s.guardado || 0) > 24 * 3600 * 1000 || s.fecha > hoyChileStr() || (rol() !== 'admin' && dias > DIAS_MAX_INSPECCION);
    if (vencida) { localStorage.removeItem(LS_MODO); return; }
    S.modo = { tipo: 'inspeccion', fecha: s.fecha, inspId: null };
  } catch (e) { /* */ }
}
function abrirSelectorModo() {
  const hoy = hoyChileStr();
  const min = rol() === 'admin' ? '' : `min="${sumarDiasStr(hoy, -DIAS_MAX_INSPECCION)}"`;
  const h = abrirHoja(`
    <h2>¿Cómo vas a informar?</h2>
    <div class="acciones" style="margin-top:12px">
      <button id="mAgregar" class="btn ${S.modo.tipo === 'agregar' ? 'btn-primario' : 'btn-secundario'}">➕ Agregar falla (hora actual)</button>
    </div>
    <h3>Informar una inspección</h3>
    <input id="mFecha" class="campo" type="date" value="${esc(S.modo.fecha || hoy)}" max="${esc(hoy)}" ${min}>
    <div id="mAviso" class="hint" style="margin:8px 0"></div>
    <div class="acciones"><button id="mInsp" class="btn ${S.modo.tipo === 'inspeccion' ? 'btn-primario' : 'btn-secundario'}">📋 ${S.modo.tipo === 'inspeccion' ? 'Cambiar fecha de inspección' : 'Comenzar inspección'}</button></div>`);
  const aviso = async () => {
    const f = $('#mFecha', h).value;
    $('#mAviso', h).textContent = '';
    if (!f) return;
    try {
      const r = await rpc('inspeccion_existente', { p_fecha: f, p_ito: null });
      if (r && r.existe) $('#mAviso', h).textContent = r.permitido === false
        ? 'Ya existe una inspección de ese día, pero es muy antigua para continuarla.'
        : `Ya tienes una inspección de ese día con ${r.fallas} falla(s): se continuará esa.`;
    } catch (e) { /* sin aviso */ }
  };
  $('#mFecha', h).addEventListener('change', aviso);
  aviso();
  $('#mAgregar', h).addEventListener('click', () => {
    S.modo = { tipo: 'agregar', fecha: null, inspId: null }; guardarModo(); pintarChipModo(); cerrarHoja(); toast('Modo: agregar falla');
  });
  const mi = $('#mInsp', h);
  mi.addEventListener('click', ocupar(mi, async () => {
    const f = $('#mFecha', h).value;
    if (!f) { toast('Elige la fecha de la inspección.', 'error'); return; }
    if (f > hoyChileStr()) { toast('La fecha no puede ser futura.', 'error'); return; }
    if (rol() !== 'admin' && f < sumarDiasStr(hoyChileStr(), -DIAS_MAX_INSPECCION)) { toast(`Solo se puede informar hasta ${DIAS_MAX_INSPECCION} días atrás.`, 'error'); return; }
    S.modo = { tipo: 'inspeccion', fecha: f, inspId: null };
    guardarModo(); pintarChipModo(); cerrarHoja();
    toast(`Inspección del ${fmtFechaCorta(f)}. Toca un punto o circuito para reportar.`, 'ok');
  }));
}
$('#chipModo').addEventListener('click', abrirSelectorModo);

/* ------------------------------ menú ------------------------------ */
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const esStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
$('#btnMenu').addEventListener('click', () => {
  const h = abrirHoja(`
    <h2>${esc(S.perfil.nombre)}</h2>
    <div class="hint">Perfil: ${esc(rolVisible())} · versión ${VERSION_APP}</div>
    <div class="acciones" style="margin-top:14px">
      ${S.instalar ? '<button id="mInstalar" class="btn btn-primario">Instalar la app en este teléfono</button>' : ''}
      ${!S.instalar && esIOS() && !esStandalone() ? '<div class="aviso">Para instalarla en iPhone: toca el botón <b>Compartir</b> de Safari y luego <b>Añadir a pantalla de inicio</b>.</div>' : ''}
      <button id="mActualizar" class="btn btn-secundario">Buscar actualización de la app</button>
      <button id="mSalir" class="btn btn-peligro">Cerrar sesión</button>
    </div>`);
  const i = $('#mInstalar', h);
  if (i) i.addEventListener('click', async () => { S.instalar.prompt(); await S.instalar.userChoice; S.instalar = null; cerrarHoja(); });
  $('#mActualizar', h).addEventListener('click', async () => {
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) { /* */ }
    location.reload();
  });
  $('#mSalir', h).addEventListener('click', () => salir());
});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.instalar = e; });

/* ------------------------------ arranque ------------------------------ */
async function entrarApp() {
  if (typeof L === 'undefined') throw new Error('No se pudo cargar el mapa. Revisa tu conexión y recarga la página.');
  await cargarPerfil();
  $('#pantallaLogin').hidden = true;
  $('#pantallaApp').hidden = false;
  $('#barraNombre').textContent = S.perfil.nombre;
  $('#barraRol').textContent = rolVisible();
  restaurarModo();
  pintarChipModo();
  S.vista = 'mapa';
  cambiarVista('mapa');
  iniciarMapa();
  setTimeout(() => map.invalidateSize(), 80);
  cacheBbox = null;
  await cargarFallas();
  cargarArea(true);
  S.centrarAlFijar = true;
  iniciarGPS();
  clearInterval(S.timer);
  S.timer = setInterval(() => { if (!document.hidden && !hojaAbierta) cargarFallas(); }, REFRESCO_MS);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.perfil) cargarFallas(); });

(async function iniciar() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* sin SW: la app funciona igual */ });
  cargarSesion();
  if (!sesion) { mostrarLogin(); return; }
  try { await entrarApp(); } catch (e) {
    if (e.name === 'SesionExpirada') mostrarLogin(e.message); else mostrarLogin(e.message);
  }
})();
