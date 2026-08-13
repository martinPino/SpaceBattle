/* SPACE BATTLE — capa de red P2P (WebRTC vía PeerJS)
   ---------------------------------------------------------------------------
   Topología en ESTRELLA, no malla: el anfitrión se conecta con cada invitado y
   hace de retransmisor. Con 8 jugadores eso son 7 conexiones en vez de 28, y
   además hay un único árbitro para la flota de NPC.

   Reparto de autoridad:
     · Cada jugador manda SU propio vuelo (si lo validara el anfitrión se
       notaría goma elástica en cada maniobra).
     · El anfitrión es autoritativo para los NPC, las capitales y el daño.

   Los mensajes de sala y sucesos van en JSON (poco frecuentes y legibles);
   las instantáneas de la flota van en binario, que es lo que manda volumen. */
import Peer from 'https://esm.sh/peerjs@1.5.4';

export const net = {
  role: 'solo',        // 'solo' | 'host' | 'guest'
  id: null,            // id de sala (el del anfitrión)
  self: null,          // id propio
  peers: new Map(),    // id -> DataConnection (solo en el anfitrión)
  hostConn: null,      // conexión al anfitrión (solo en invitado)
  players: new Map(),  // id -> { id, name, ready, ship, kills, deaths, bot }
  name: 'PILOT',
  mode: 'ffa',         // 'ffa' | 'teams'
  team: 'blue',        // bando propio cuando mode === 'teams'
  ship: 'kit',         // casco elegido, para que los demás te vean como eres
  public: true,        // la sala se anuncia en la lista pública mientras espera
  started: false,
  onLobby: () => {},
  onStart: () => {},
  onMessage: () => {},
  onLeave: () => {},
  onError: () => {},
};

let peer = null;

/* Sin TURN, dos navegadores tras NAT simétrica (o tras el cortafuegos de una
   oficina) no llegan a verse aunque la señalización funcione: es la causa
   habitual de "no se pudo entrar en la sala". Los STUN solo descubren tu IP
   pública; el TURN retransmite cuando el camino directo es imposible, y por
   el 443 en TCP atraviesa casi cualquier red corporativa.
   Son servidores públicos gratuitos (openrelay), suficientes para partidas
   entre amigos; si algún día hace falta fiabilidad, se cambian por unos propios. */
// El 443 de openrelay ya no responde (comprobado); solo queda vivo el 80, en
// UDP y en TCP. Si algún día quieres conexiones fiables tras NAT estricta,
// pon aquí un TURN propio: es la única pieza que el P2P no puede evitar.
const STUN = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
];
/* Respaldo estático del mismo relé: si el API no responde (sin conexión al
   arrancar, corte del panel), estas credenciales siguen sirviendo. */
const FREE_TURN = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:standard.relay.metered.ca:80', username: 'f35789351b0707b52cd2d2d1', credential: '3bMmCjhxgM1+aGpG' },
  { urls: 'turn:standard.relay.metered.ca:80?transport=tcp', username: 'f35789351b0707b52cd2d2d1', credential: '3bMmCjhxgM1+aGpG' },
  { urls: 'turn:standard.relay.metered.ca:443', username: 'f35789351b0707b52cd2d2d1', credential: '3bMmCjhxgM1+aGpG' },
  { urls: 'turns:standard.relay.metered.ca:443?transport=tcp', username: 'f35789351b0707b52cd2d2d1', credential: '3bMmCjhxgM1+aGpG' },
];

/* Relé TURN de Metered. La clave viaja al navegador por narices: cualquier
   juego P2P en web expone sus credenciales de TURN (así son también los
   ejemplos oficiales de Metered). Está acotada a TURN y con cuota mensual,
   pero quien mire el código fuente puede gastarla: si un día ves consumo
   raro, se rota desde el panel y se cambia aquí. */
const METERED_APP = 'space-battle-sand';
const METERED_KEY = '553222725c5b43b0cc42bf7e7d394ed28ac6';
let meteredIce = [];

/* Relé por orden de preferencia:
     1. Cloudflare vía /api/turn — 1 TB gratis al mes, credenciales temporales
        acuñadas en el servidor (el token nunca baja al navegador).
     2. Metered con la clave del usuario — 20 GB gratis.
     3. Credenciales estáticas de reserva, por si ninguna API responde. */
// En un portal el juego vive en otro dominio: el empaquetador reescribe esta
// constante con la URL absoluta del endpoint, que sigue guardando el secreto.
const TURN_API = '/api/turn';
// El tablón de salas vive en Cloudflare (cf-rooms/), donde ya está el relé TURN.
// URL absoluta a propósito: el juego también corre en los portales, en otro dominio.
const ROOMS_API = 'https://space-battle-rooms.SUBDOMINIO.workers.dev/rooms';

/* ---------------- salas públicas ----------------
   El anfitrión se anuncia cada 30 s mientras admita gente; el anuncio caduca
   solo a los 90 s en el servidor, así que cerrar el navegador basta para
   desaparecer de la lista, y perder un latido suelto no la tira. Si el tablón
   no responde, todo sigue funcionando por enlace de invitación.

   El ritmo no es casual: cada llamada consume del presupuesto diario gratuito
   de Cloudflare, y a 15 s veinte salas se lo comían entero. */
const BEAT_MS = 30000;
const THROTTLE_MS = 10000;   // ráfagas de cambios en la sala no son ráfagas de avisos
let announceTimer = null;
let lastPost = 0;
let pendingBeat = null;      // el último cambio no puede quedarse sin enviar
let leaving = false;         // cerrando la sala: no volver a anunciarla
// Prueba de que la sala es tuya. Sin esto, el id que sale en la lista pública
// sería la única credencial y cualquiera podría borrarte del tablón.
let roomSecret = null;
// Número de orden: los avisos son fetch sueltos y pueden adelantarse entre sí.
// Sin él, un latido lanzado justo antes de cerrar la sala llegaría después del
// cierre y la resucitaría en el tablón hasta caducar.
let roomSeq = 0;

export async function listRooms() {
  try {
    const r = await fetch(ROOMS_API, { cache: 'no-store' });
    if (!r.ok) return { rooms: [], disabled: true };   // 4xx/5xx traen JSON válido
    const j = await r.json();
    if (!Array.isArray(j.rooms)) return { rooms: [], disabled: true };
    return { rooms: j.rooms, disabled: false };
  } catch { return { rooms: [], disabled: true }; }
}
/* text/plain a propósito: con application/json el navegador manda antes una
   petición OPTIONS de sondeo, y esa también cuenta. El servidor lee el cuerpo
   como JSON igualmente. */
function postRoom(body) {
  return fetch(ROOMS_API, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body),
  }).catch(() => {});
}
/* Se llama al abrir sala y cada vez que cambia la lista de pilotos, para que el
   contador de la lista no vaya por detrás. El acelerador evita que una racha de
   entradas/salidas dispare una petición por cada una. */
export function announceRoom(force = false) {
  if (leaving || net.role !== 'host' || !net.id || !net.public || net.started) return;
  if (!roomSecret) roomSecret = (crypto.randomUUID?.() || String(Math.random())).slice(0, 32);
  const now = performance.now();
  const beat = () => {
    lastPost = now;
    postRoom({
      id: net.id, secret: roomSecret, seq: ++roomSeq,
      name: net.players.get(net.self)?.name || 'PILOT',
      players: net.players.size, max: 8, mode: net.mode,
    });
  };
  /* Un invitado tecleando su nombre dispara un aviso de sala por pulsación:
     broadcastLobby() llama aquí en cada cambio. Se acelera a uno cada diez
     segundos, pero el último cambio se manda igualmente al vencer el plazo —
     si se descartara sin más, el recuento se quedaría mal hasta el siguiente
     latido. */
  if (force || now - lastPost > THROTTLE_MS) {
    clearTimeout(pendingBeat); pendingBeat = null;
    beat();
  } else if (!pendingBeat) {
    pendingBeat = setTimeout(() => { pendingBeat = null; announceRoom(true); },
      THROTTLE_MS - (now - lastPost));
  }
  clearInterval(announceTimer);
  announceTimer = setInterval(() => announceRoom(true), BEAT_MS);
}
export function unannounceRoom() {
  clearInterval(announceTimer);
  clearTimeout(pendingBeat);
  announceTimer = null;
  pendingBeat = null;
  lastPost = 0;
  if (net.id && net.role === 'host') postRoom({ id: net.id, secret: roomSecret, seq: ++roomSeq, closed: true });
}
/* Cerrar la pestaña deja la sala colgando hasta que caduque; el aviso de salida
   la retira al momento. `fetch` no sobrevive al cierre, sendBeacon sí.
   `persisted` distingue el cierre real de un simple ir y volver con el botón
   atrás: ahí la página sigue viva y la sala no debe desaparecer del tablón. */
addEventListener('pagehide', (e) => {
  if (e.persisted) return;
  if (net.role === 'host' && net.id && net.public) {
    try {
      navigator.sendBeacon(ROOMS_API, new Blob(
        [JSON.stringify({ id: net.id, secret: roomSecret, seq: ++roomSeq, closed: true })], { type: 'text/plain' }));
    } catch { /* da igual: caduca sola */ }
  }
});
// al volver del historial los temporizadores vienen fríos: reanunciar ya
addEventListener('pageshow', (e) => { if (e.persisted) announceRoom(true); });

/* Pública, en la lista de todos; privada, solo por enlace. */
export function setPublic(on) {
  const v = !!on;
  if (v === net.public) return;   // pulsar dos veces el mismo botón no es un aviso
  net.public = v;
  if (v) announceRoom(true);
  else unannounceRoom();
}
async function tryCloudflare() {
  try {
    const r = await fetch(TURN_API);
    if (!r.ok) return false;                    // 501 = aún sin configurar
    const j = await r.json();
    const list = (j.iceServers || []).filter((s) => s && s.urls);
    if (!list.length) return false;
    meteredIce = list;
    note(`relé TURN de Cloudflare listo (${list.length})`);
    return true;
  } catch { return false; }
}
async function tryMetered() {
  let app = METERED_APP, key = METERED_KEY;
  try {
    app = localStorage.getItem('sb_turn_app') || app;
    key = localStorage.getItem('sb_turn_key') || key;
  } catch { /* modo privado */ }
  if (!app || !key) return false;
  try {
    const r = await fetch(`https://${app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
    const j = await r.json();
    if (Array.isArray(j) && j.length) {
      meteredIce = j.filter((s) => s && s.urls);
      note(`relé TURN de Metered listo (${meteredIce.length})`);
      return true;
    }
    note(`Metered rechazó la clave: ${j && j.error ? j.error : 'respuesta inesperada'}`);
  } catch { note('Metered: no se pudo consultar'); }
  return false;
}
export async function refreshTurn() {
  meteredIce = [];
  if (await tryCloudflare()) return;
  if (await tryMetered()) return;
  note('sin relé por API: se usan las credenciales de reserva');
}

/* TURN propio, si lo hay. Se guarda en el navegador: en cuanto pegues unas
   credenciales, el multijugador funciona en cualquier red sin tocar código.
   Formato: "turn:host:puerto|usuario|clave" (varias líneas si quieres). */
export function getTurn() {
  try {
    return (localStorage.getItem('sb_turn') || '').split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => { const [urls, username, credential] = l.split('|').map((s) => s.trim()); return { urls, username, credential }; })
      .filter((s) => s.urls && s.urls.startsWith('turn'));
  } catch { return []; }
}
export function setTurn(text) {
  try { localStorage.setItem('sb_turn', text || ''); } catch { /* modo privado */ }
}
export function iceConfig() {
  const own = getTurn();
  const relays = [...meteredIce, ...own];
  return { iceServers: [...STUN, ...relays, ...(relays.length ? [] : FREE_TURN)], iceCandidatePoolSize: 4 };
}
export function hasRelay() { return meteredIce.length > 0 || getTurn().length > 0; }

export const diag = { log: [], onLog: () => {} };
function note(msg) {
  diag.log.push(msg);
  if (diag.log.length > 40) diag.log.shift();
  diag.onLog(msg);
}

function newPeer() {
  return new Promise((resolve, reject) => {
    // servidor público de señalización de PeerJS: solo intercambia la
    // "presentación" entre navegadores; el juego viaja directo entre ellos
    note('abriendo canal de señalización…');
    const p = new Peer({ debug: 1, config: iceConfig() });
    let done = false;
    /* Un intento fallido hay que destruirlo. Si solo se rechaza la promesa, el
       par sigue vivo y fuera de alcance: mantiene su socket abierto, se
       reconecta solo y sigue escribiendo errores en la sala de la sesión
       siguiente. */
    const fail = (err) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      try { p.destroy(); } catch { /* ya cerrado */ }
      reject(err);
    };
    const to = setTimeout(() => { note('señalización: sin respuesta en 15 s'); fail(new Error('signal-timeout')); }, 15000);
    p.on('open', (id) => { done = true; clearTimeout(to); note('señalización lista'); resolve([p, id]); });
    // OJO: destroy() emite 'disconnected' ANTES de marcarse como destruido, así
    // que sin la guarda el reconnect() vuelve a abrir el socket que se estaba
    // cerrando y deja el id de la sala ocupado en el servidor de señalización
    p.on('disconnected', () => {
      if (leaving) return;
      note('señalización caída; reconectando…');
      try { p.reconnect(); } catch { /* ya destruido */ }
    });
    p.on('error', (e) => {
      note(`error de par: ${e.type}`);
      // 'peer-unavailable' = sala inexistente; el resto suelen ser de red
      if (!leaving) net.onError(e.type === 'peer-unavailable' ? 'Room not found — check the code' : `Network: ${e.type}`);
      fail(e);
    });
  });
}

// deja rastro de por dónde va la negociación ICE: es donde falla el 99% de las veces
function watchIce(conn) {
  const pc = conn.peerConnection;
  if (!pc) return;
  pc.oniceconnectionstatechange = () => note(`ICE: ${pc.iceConnectionState}`);
  pc.onicegatheringstatechange = () => note(`candidatos: ${pc.iceGatheringState}`);
}

/* ------------------------------- anfitrión ------------------------------- */
export async function hostGame(name) {
  net.name = name;
  await refreshTurn(); // credenciales frescas antes de negociar
  const [p, id] = await newPeer();
  peer = p;
  net.role = 'host';
  net.self = id;
  net.id = id;
  net.players.set(id, { id, name: cleanName(name), ready: true, kills: 0, deaths: 0, team: net.team, ship: net.ship });
  p.on('connection', (conn) => {
    note('entrante: negociando…');
    watchIce(conn);
    conn.on('open', () => {
      note('entrante: conectado');
      if (net.started || net.players.size >= 8) { conn.close(); return; }
      net.peers.set(conn.peer, conn);
    });
    conn.on('data', (d) => hostHandle(conn, d));
    conn.on('close', () => dropPeer(conn.peer));
    conn.on('error', () => dropPeer(conn.peer));
  });
  net.onLobby();
  return id;
}

function dropPeer(id) {
  net.peers.delete(id);
  if (net.players.delete(id)) {
    net.onLeave(id);
    broadcastLobby();
  }
}

function hostHandle(conn, d) {
  if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) { net.onMessage(conn.peer, d); return; }
  switch (d.t) {
    case 'hello':
      net.players.set(conn.peer, {
        id: conn.peer, name: cleanName(d.name), ready: false, kills: 0, deaths: 0,
        team: d.team === 'red' ? 'red' : 'blue', ship: String(d.ship || 'kit').slice(0, 16),
      });
      broadcastLobby();
      break;
    case 'ready': {
      const pl = net.players.get(conn.peer);
      if (pl) { pl.ready = !!d.ready; broadcastLobby(); }
      break;
    }
    case 'rename': { // el nombre puede cambiar en cualquier momento
      const pl = net.players.get(conn.peer);
      if (pl) { pl.name = cleanName(d.name); broadcastLobby(); }
      break;
    }
    case 'team': {
      const pl = net.players.get(conn.peer);
      if (pl) { pl.team = d.team === 'red' ? 'red' : 'blue'; broadcastLobby(); }
      break;
    }
    case 'ship': {
      const pl = net.players.get(conn.peer);
      if (pl) { pl.ship = String(d.ship || 'kit').slice(0, 16); broadcastLobby(); }
      break;
    }
    default:
      net.onMessage(conn.peer, d);
  }
}

function cleanName(n) { return String(n || 'PILOT').toUpperCase().slice(0, 12) || 'PILOT'; }

export function broadcastLobby() {
  if (net.role !== 'host') return;
  const list = [...net.players.values()].map((p) => ({
    id: p.id, name: p.name, ready: p.ready, kills: p.kills, deaths: p.deaths,
    team: p.team || 'blue', ship: p.ship || 'kit',
  }));
  send({ t: 'lobby', players: list, hostId: net.self, mode: net.mode });
  announceRoom(); // el recuento de la lista pública sigue a los pilotos
  net.onLobby();
}

/* el nombre y el bando se pueden cambiar en la sala en cualquier momento */
export function setName(name) {
  net.name = cleanName(name);
  if (net.role === 'host') {
    const me = net.players.get(net.self);
    if (me) { me.name = net.name; broadcastLobby(); }
  } else if (net.role === 'guest') net.hostConn?.send({ t: 'rename', name: net.name });
}
export function setTeam(team) {
  net.team = team === 'red' ? 'red' : 'blue';
  if (net.role === 'host') {
    const me = net.players.get(net.self);
    if (me) { me.team = net.team; broadcastLobby(); }
  } else if (net.role === 'guest') net.hostConn?.send({ t: 'team', team: net.team });
}
export function setShip(id) {
  net.ship = String(id || 'kit');
  if (net.role === 'host') {
    const me = net.players.get(net.self);
    if (me) { me.ship = net.ship; broadcastLobby(); }
  } else if (net.role === 'guest') net.hostConn?.send({ t: 'ship', ship: net.ship });
}
export function setMode(mode) { // solo el anfitrión decide el tipo de partida
  if (net.role !== 'host') return;
  net.mode = mode === 'teams' ? 'teams' : 'ffa';
  broadcastLobby();
}

export function startMatch(seed) {
  if (net.role !== 'host') return;
  net.started = true;
  unannounceRoom(); // empezada la partida, fuera de la lista: ya no admite gente
  send({ t: 'start', seed });
  net.onStart(seed);
}

/* -------------------------------- invitado -------------------------------- */
export async function joinGame(hostId, name) {
  net.name = name;
  await refreshTurn();
  const [p, id] = await newPeer();
  peer = p;
  net.role = 'guest';
  net.self = id;
  net.id = hostId;
  // un intento directo y, si no cuaja, otro: la primera negociación ICE puede
  // perderse mientras el TURN todavía está reuniendo candidatos
  let conn = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    note(`conectando con el anfitrión (intento ${attempt})…`);
    conn = p.connect(hostId, { reliable: true });
    watchIce(conn);
    const ok = await new Promise((resolve) => {
      const to = setTimeout(() => resolve(false), 25000); // TURN puede tardar
      conn.on('open', () => { clearTimeout(to); resolve(true); });
      conn.on('error', (e) => { note(`error de conexión: ${e.type || e}`); clearTimeout(to); resolve(false); });
    });
    if (ok) break;
    try { conn.close(); } catch { /* ya cerrada */ }
    conn = null;
  }
  if (!conn) { note('no se pudo abrir el canal de datos'); throw new Error('connect-failed'); }
  note('¡conectado!');
  net.hostConn = conn;
  conn.on('data', (d) => {
    if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) { net.onMessage(hostId, d); return; }
    if (d.t === 'lobby') {
      net.players.clear();
      for (const pl of d.players) net.players.set(pl.id, pl);
      net.mode = d.mode === 'teams' ? 'teams' : 'ffa';
      net.onLobby();
    } else if (d.t === 'start') {
      net.started = true;
      net.onStart(d.seed);
    } else net.onMessage(hostId, d);
  });
  // al salir por tu propio pie no hay nada que avisar: el cierre lo has pedido tú
  conn.on('close', () => { if (!leaving) net.onError('Lost the connection to the host'); });
  conn.send({ t: 'hello', name: cleanName(name), team: net.team, ship: net.ship });
  return id;
}

export function setReady(ready) {
  if (net.role === 'guest') net.hostConn?.send({ t: 'ready', ready });
  else if (net.role === 'host') {
    const me = net.players.get(net.self);
    if (me) { me.ready = ready; broadcastLobby(); }
  }
}

/* ------------------------------- transporte ------------------------------- */
// del anfitrión a todos, o del invitado al anfitrión
export function send(msg, exceptId) {
  if (net.role === 'host') {
    for (const [id, c] of net.peers) {
      if (id === exceptId || !c.open) continue;
      try { c.send(msg); } catch { /* conexión cayendo: la limpia 'close' */ }
    }
  } else if (net.role === 'guest' && net.hostConn?.open) {
    try { net.hostConn.send(msg); } catch { /* ídem */ }
  }
}

// envío a UN invitado concreto: cada uno recibe la instantánea que le sirve
export function sendTo(id, msg) {
  const c = net.peers.get(id);
  if (!c || !c.open) return;
  try { c.send(msg); } catch { /* conexión cayendo */ }
}

export function leave() {
  /* El orden importa. peer.destroy() cierra cada conexión, y cada cierre acaba
     llamando a broadcastLobby() → announceRoom(): en ese instante el rol sigue
     siendo 'host', así que la sala que se acaba de retirar se volvía a anunciar
     y quedaba de fantasma en el tablón hasta caducar. La bandera corta eso. */
  leaving = true;
  unannounceRoom();
  try { peer?.destroy(); } catch { /* ya cerrado */ }
  peer = null;
  net.role = 'solo';
  net.peers.clear();
  net.players.clear();
  net.hostConn = null;
  net.started = false;
  roomSecret = null;
  roomSeq = 0;
  leaving = false;
}

/* --------------------- codificación binaria de la flota ---------------------
   Una instantánea con 200 naves en JSON pasa de 20 KB; en binario baja a ~2 KB.
   Posiciones a int16 en decímetros (±3.276 m cubre el campo de batalla) y
   rotación con el truco de "los tres menores": se omite el componente mayor
   del cuaternión, que se reconstruye porque la norma es 1. */
const POS_SCALE = 10;

export function writeQuat(view, off, q) {
  const a = [q.x, q.y, q.z, q.w];
  let big = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(a[i]) > Math.abs(a[big])) big = i;
  const sign = a[big] < 0 ? -1 : 1; // se envía el hemisferio positivo
  view.setUint8(off, big);
  let k = 1;
  for (let i = 0; i < 4; i++) {
    if (i === big) continue;
    view.setInt16(off + k, Math.round(a[i] * sign * 32767), true);
    k += 2;
  }
  return off + 7;
}
export function readQuat(view, off, q) {
  const big = view.getUint8(off);
  const v = [0, 0, 0, 0];
  let k = 1, sum = 0;
  for (let i = 0; i < 4; i++) {
    if (i === big) continue;
    v[i] = view.getInt16(off + k, true) / 32767;
    sum += v[i] * v[i];
    k += 2;
  }
  v[big] = Math.sqrt(Math.max(0, 1 - sum));
  q.set(v[0], v[1], v[2], v[3]);
  return off + 7;
}
export function writePos(view, off, p) {
  view.setInt16(off, clampI16(p.x * POS_SCALE), true);
  view.setInt16(off + 2, clampI16(p.y * POS_SCALE), true);
  view.setInt16(off + 4, clampI16(p.z * POS_SCALE), true);
  return off + 6;
}
export function readPos(view, off, p) {
  p.set(view.getInt16(off, true) / POS_SCALE,
    view.getInt16(off + 2, true) / POS_SCALE,
    view.getInt16(off + 4, true) / POS_SCALE);
  return off + 6;
}
function clampI16(v) { return Math.max(-32768, Math.min(32767, Math.round(v))); }
