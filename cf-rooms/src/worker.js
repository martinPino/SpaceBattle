/* Tablón de salas públicas — Cloudflare Worker + Durable Object.
   ---------------------------------------------------------------------------
   El juego es P2P: no hay servidor de partida al que preguntar quién está
   jugando. Esto lo suple con un tablón de anuncios con caducidad:

     POST /rooms   { id, name, players, max, mode }   el anfitrión se anuncia
     POST /rooms   { id, closed: true }               retira su sala
     GET  /rooms                                      salas vivas

   Tres decisiones, y las tres vienen de los límites del plan gratuito:

   · UN SOLO objeto para todo el mundo (no uno por sala). La duración se
     factura asumiendo 128 MB por objeto, así que el presupuesto gratuito solo
     da para un objeto caliente; veinte serían dieciséis veces el límite.

   · La lista se persiste, no vive solo en memoria. Un objeto se hiberna a los
     10 s sin tráfico y pierde la memoria — medido: con latidos cada 30 s la
     lista aparecería vacía casi siempre. Pero persistir en CADA latido son
     ~115.000 filas al día con veinte salas, por encima del límite. Así que se
     distingue qué cambia:
         altas y bajas          → a disco al momento (raras, y se notan)
         recuentos y latidos    → a disco como mucho cada 30 s, todo junto
     Coste real: unas 2 escrituras por minuto, con una sala o con sesenta.

   · Todo el registro en UNA clave. Una lectura devuelve una fila, no una por
     sala: con muchos curiosos mirando, veinte filas por consulta se comen el
     presupuesto de lectura.

   La caducidad se filtra al leer (now - seen > TTL) en vez de con alarmas:
   una alarma cuesta una escritura al programarla y una petición al dispararse,
   y encima un setTimeout pendiente impide hibernar y factura duración. */

const TTL_MS = 90000;      // sin latido, la sala desaparece (tolera perder uno)
const FLUSH_MS = 30000;    // cada cuánto baja a disco un simple refresco
const EDGE_CACHE_S = 8;    // la lista se sirve cacheada: no despierta al objeto
const MAX_ROOMS = 60;      // techo, para que nadie hinche el objeto
const KEY = 'rooms';       // todo el registro en una sola clave
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 30;       // anuncios por minuto y por IP (uno legítimo hace 2)

const CORS = {
  'Access-Control-Allow-Origin': '*',   // el juego también vive en los portales
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  // sin esto, cada POST arrastraría su OPTIONS y duplicaría el consumo
  'Access-Control-Max-Age': '86400',
};
const json = (body, status = 200, extra = null) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...CORS,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...extra,
  },
});
// avisa al Worker de que la copia cacheada de la lista ya no vale
const LIST_CHANGED = { 'X-List-Changed': '1' };

const clean = (s, n) => String(s ?? '').replace(/[<>"'\\]/g, '').slice(0, n);
const clamp = (v, lo, hi, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    if (url.pathname !== '/rooms' && url.pathname !== '/') return json({ error: 'not-found' }, 404);
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method' }, 405);

    const stub = () => env.ROOMS.get(env.ROOMS.idFromName('global'));
    const cache = caches.default;
    const key = new Request(`${url.origin}/rooms`, { method: 'GET' });

    if (request.method === 'POST') {
      /* Un anuncio de sala son unos 200 bytes. El tope se comprueba AQUÍ y no
         en el objeto: quien lee el cuerpo lo mantiene despierto, y la duración
         del objeto es el presupuesto más fácil de agotar de todo el plan. */
      // Se rechaza por la cabecera, sin tocar el flujo: cancelarlo a mano tumba
      // el runtime local, y aquí no hace falta porque el cuerpo nunca se lee.
      const len = parseInt(request.headers.get('Content-Length') || '0', 10);
      if (len > 2048) return json({ error: 'too-big' }, 413);

      const r = await stub().fetch(request);
      // Una sala que aparece o desaparece debe verse YA: se tira la copia
      // cacheada. Un latido que solo mueve el recuento no la invalida, que es
      // justo lo que hace barata la lectura.
      if (r.headers.get('X-List-Changed') === '1') ctx.waitUntil(cache.delete(key));
      return r;
    }

    /* La lista se sirve desde la caché del borde unos segundos. Diez curiosos
       mirando cada doce segundos despertarían al objeto quinientas veces por
       hora; así lo despiertan cuatrocientas cincuenta menos. Ir 8 s por detrás
       en el recuento de pilotos no significa nada para un tablón de salas.
       OJO: en un subdominio workers.dev no hay zona detrás y la Cache API no
       guarda nada — el ahorro solo se materializa con dominio propio. Con o
       sin él el comportamiento es el mismo; cambia cuánta cuota se gasta. */
    const hit = await cache.match(key);
    if (hit) return noStore(hit);

    const fresh = await stub().fetch(request);
    const body = await fresh.text();
    // Dos copias del mismo cuerpo a propósito: la que se guarda lleva max-age
    // para que el borde la reutilice, y la que se envía lleva no-store. Si el
    // navegador se quedara con la suya, el botón REFRESH no haría nada durante
    // ocho segundos y la invalidación del servidor no podría alcanzarla.
    const stored = new Response(body, {
      status: fresh.status,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${EDGE_CACHE_S}` },
    });
    ctx.waitUntil(cache.put(key, stored));
    return json(JSON.parse(body), fresh.status);
  },
};

// devuelve la respuesta cacheada sin dejar que el navegador se quede con ella
function noStore(r) {
  const out = new Response(r.body, r);
  out.headers.set('Cache-Control', 'no-store');
  return out;
}

export class RoomRegistry {
  constructor(state) {
    this.state = state;
    this.rooms = new Map();   // id -> { room, seen, secret }
    this.hits = new Map();    // ip -> { since, n }  (freno, solo en memoria)
    this.dirty = false;       // hay refrescos sin bajar a disco
    this.lastFlush = 0;
    // el objeto pudo hibernar y perder la memoria: recuperar la lista ANTES de
    // atender nada, o la primera petición respondería una lista vacía
    state.blockConcurrencyWhile(async () => {
      const saved = await state.storage.get(KEY);
      if (Array.isArray(saved)) {                       // formato viejo, sin sello
        for (const e of saved) this.rooms.set(e.room.id, e);
      } else if (saved && Array.isArray(saved.list)) {
        for (const e of saved.list) this.rooms.set(e.room.id, e);
        // OJO: `lastFlush` tiene que venir de disco. Si se inicializara aquí a
        // "ahora", como el objeto hiberna a los 10 s y el latido llega cada 30,
        // cada latido encontraría un lastFlush recién puesto, el débito no se
        // cumpliría NUNCA y el sello `seen` no bajaría jamás a disco: la sala
        // caducaría a los 90 s aunque su anfitrión siguiera latiendo.
        this.lastFlush = saved.flushedAt || 0;
      }
    });
  }

  async persist(now) {
    this.dirty = false;
    this.lastFlush = now;
    await this.state.storage.put(KEY, { list: [...this.rooms.values()], flushedAt: now });
  }

  async fetch(request) {
    const now = Date.now();
    // barrido perezoso de caducadas: si alguna cae, el conjunto cambió
    let changed = false;
    for (const [k, v] of this.rooms) if (now - v.seen > TTL_MS) { this.rooms.delete(k); changed = true; }

    if (request.method === 'POST') {
      /* El cuerpo se lee ANTES de cualquier rechazo. Responder sin consumirlo
         deja el flujo de la petición a medias y el runtime lanza "Can't read
         from request stream after response has been sent", que se lleva por
         delante al proceso entero. El tamaño ya viene acotado por el Worker. */
      let b;
      try { b = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }

      /* Freno por IP. Un anfitrión legítimo escribe dos veces por minuto; el
         tope deja sitio de sobra a varios detrás del mismo router y corta el
         bucle que agotaría el presupuesto del día. Vive en memoria a propósito:
         un contador así no merece una escritura, y perderlo al hibernar solo
         significa perdonar a quien llevaba una hora sin llamar. */
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      const w = this.hits.get(ip);
      if (!w || now - w.since > RATE_WINDOW_MS) this.hits.set(ip, { since: now, n: 1 });
      else if (++w.n > RATE_MAX) return json({ error: 'slow-down' }, 429);
      if (this.hits.size > 5000) this.hits.clear();   // techo de memoria

      const id = clean(b.id, 64);
      if (!id) return json({ error: 'missing-id' }, 400);

      /* Prueba de propiedad. El id de sala sale en la lista pública, así que si
         fuera la única credencial cualquiera podría borrar la sala de otro —o
         reescribirle el nombre— con un solo curl. El anfitrión manda además un
         secreto que solo él conoce; la primera vez queda registrado y a partir
         de ahí se exige. */
      const prev = this.rooms.get(id);
      const secret = clean(b.secret, 64);
      if (prev && prev.secret && prev.secret !== secret) {
        if (changed) await this.persist(now);
        return json({ error: 'not-yours' }, 403);
      }

      /* Número de orden por sala. Los avisos son fetch sueltos que nadie
         espera, así que un latido lanzado justo antes de cerrar puede llegar
         DESPUÉS del cierre y resucitar la sala: quedaría anunciada hasta
         caducar, y quien la eligiera se encontraría con que el anfitrión le
         cierra la puerta. Con el sello, lo viejo se descarta. */
      const seq = clamp(b.seq, 0, 1e9, 0);
      if (prev && seq && prev.seq && seq <= prev.seq) return json({ ok: true, stale: true });

      if (b.closed) {
        /* Lápida en vez de borrado: si se borrara sin dejar rastro, el mismo
           latido rezagado la recrearía como sala nueva. Se cae sola con el
           barrido por caducidad, sin escrituras extra. */
        const había = prev && !prev.closed;
        if (prev) {
          this.rooms.set(id, { ...prev, closed: true, seq, seen: now });
          changed = true;
          await this.persist(now);
        }
        return json({ ok: true, removed: !!había }, 200, había ? LIST_CHANGED : null);
      }
      /* Registro lleno: se desaloja la entrada más vieja en vez de rechazar al
         recién llegado. Si no, a alguien le bastaría con ocupar las sesenta
         plazas con ids inventados para que ningún anfitrión real entrase. */
      const known = prev && !prev.closed;        // reabrir cuenta como alta
      let vivas = 0;
      for (const v of this.rooms.values()) if (!v.closed) vivas++;
      if (!known && vivas >= MAX_ROOMS) {
        // se desaloja la más vieja (lápidas primero) en vez de rechazar al que
        // llega: si no, bastaría con ocupar las plazas con ids inventados para
        // dejar fuera a los anfitriones de verdad
        let old = null;
        for (const [k, v] of this.rooms) {
          const rank = [v.closed ? 0 : 1, v.seen];
          if (!old || rank[0] < old[1] || (rank[0] === old[1] && v.seen < old[2])) old = [k, rank[0], v.seen];
        }
        if (old) { this.rooms.delete(old[0]); changed = true; }
      }
      this.rooms.set(id, {
        seen: now,
        seq,
        secret: prev?.secret || secret,
        room: {
          id,
          name: clean(b.name, 14) || 'PILOT',
          players: clamp(b.players, 1, 8, 1),
          max: clamp(b.max, 2, 8, 8),
          mode: b.mode === 'teams' ? 'teams' : 'ffa',
        },
      });

      // alta o baja → a disco al momento; lo demás puede esperar al débito
      if (!known || changed) await this.persist(now);
      else {
        this.dirty = true;
        if (now - this.lastFlush > FLUSH_MS) await this.persist(now);
      }
      return json({ ok: true }, 200, (!known || changed) ? LIST_CHANGED : null);
    }

    if (changed || (this.dirty && now - this.lastFlush > FLUSH_MS)) await this.persist(now);

    // el secreto de cada sala vive en la entrada, nunca dentro de `room`: aquí
    // solo sale lo que ya es público, y sin las lápidas
    const rooms = [...this.rooms.values()].filter((v) => !v.closed)
      .map((v) => v.room).sort((a, b) => b.players - a.players);
    return json({ rooms });
  }
}
