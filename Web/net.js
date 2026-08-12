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
const ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:80?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
  iceCandidatePoolSize: 4,
};

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
    const p = new Peer({ debug: 1, config: ICE });
    const to = setTimeout(() => { note('señalización: sin respuesta en 15 s'); reject(new Error('signal-timeout')); }, 15000);
    p.on('open', (id) => { clearTimeout(to); note('señalización lista'); resolve([p, id]); });
    p.on('disconnected', () => { note('señalización caída; reconectando…'); try { p.reconnect(); } catch { /* ya destruido */ } });
    p.on('error', (e) => {
      note(`error de par: ${e.type}`);
      // 'peer-unavailable' = sala inexistente; el resto suelen ser de red
      net.onError(e.type === 'peer-unavailable' ? 'Room not found — check the code' : `Network: ${e.type}`);
      clearTimeout(to);
      reject(e);
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
  const [p, id] = await newPeer();
  peer = p;
  net.role = 'host';
  net.self = id;
  net.id = id;
  net.players.set(id, { id, name, ready: true, kills: 0, deaths: 0 });
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
      net.players.set(conn.peer, { id: conn.peer, name: String(d.name || 'PILOT').slice(0, 12), ready: false, kills: 0, deaths: 0 });
      broadcastLobby();
      break;
    case 'ready': {
      const pl = net.players.get(conn.peer);
      if (pl) { pl.ready = !!d.ready; broadcastLobby(); }
      break;
    }
    default:
      net.onMessage(conn.peer, d);
  }
}

export function broadcastLobby() {
  if (net.role !== 'host') return;
  const list = [...net.players.values()].map((p) => ({ id: p.id, name: p.name, ready: p.ready, kills: p.kills, deaths: p.deaths }));
  send({ t: 'lobby', players: list, hostId: net.self });
  net.onLobby();
}

export function startMatch(seed) {
  if (net.role !== 'host') return;
  net.started = true;
  send({ t: 'start', seed });
  net.onStart(seed);
}

/* -------------------------------- invitado -------------------------------- */
export async function joinGame(hostId, name) {
  net.name = name;
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
      net.onLobby();
    } else if (d.t === 'start') {
      net.started = true;
      net.onStart(d.seed);
    } else net.onMessage(hostId, d);
  });
  conn.on('close', () => net.onError('Se perdió la conexión con el anfitrión'));
  conn.send({ t: 'hello', name });
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

export function leave() {
  try { peer?.destroy(); } catch { /* ya cerrado */ }
  peer = null;
  net.role = 'solo';
  net.peers.clear();
  net.players.clear();
  net.hostConn = null;
  net.started = false;
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
