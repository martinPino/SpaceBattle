/* Cuántos juegan de verdad — contador propio, sin cookies ni rastreo.
   ---------------------------------------------------------------------------
   Ni CrazyGames ni la analítica de Vercel responden a la pregunta completa:
   una es solo su plataforma y la otra cuenta quién ABRE la página, no quién
   llega a jugar. Esto cuenta partidas y jugadores distintos en las tres
   versiones (web, itch, CrazyGames) con un único endpoint:

     POST /stat    { ev: 'play' | 'wave2' | 'mp' | 'win', build }
     GET  /stats   resumen de los últimos 60 días · GET /panel  el mismo, en HTML

   Cómo se distingue a un jugador sin seguirle la pista:

     huella = SHA-256(IP + navegador + sal_del_día)   →  8 bytes en hexadecimal

   La IP nunca se guarda: se usa un instante para calcular la huella y se
   descarta. La sal es aleatoria y se tira al cambiar de día, así que las
   huellas de ayer no se pueden comparar con las de hoy: solo sirven para no
   contar dos veces a la misma persona dentro del mismo día. Es el método de
   las analíticas que no piden consentimiento, y evita tocar el dispositivo de
   quien juega — un identificador en su navegador sí necesitaría permiso.

   Dos decisiones que parecen detalles y no lo son:

   · La sal se GUARDA en disco. Tenerla solo en memoria era más limpio sobre
     el papel, pero el objeto hiberna a los 10 s y las partidas llegan
     separadas por minutos: cada una habría estrenado sal, cada huella habría
     salido distinta, y «jugadores» habría acabado siendo un sinónimo de
     «partidas» — justo lo que este contador existe para no ser.

   · Cada cosa en su clave. Meter los sesenta días en un único valor revienta
     el techo por valor en cuanto hay tráfico (veinte mil huellas diarias son
     megas) y obliga a reescribirlo entero en cada partida. Aquí el día lleva
     solo sus contadores y cada huella es una marca suelta de un byte. */

const DIAS = 60;             // histórico que se conserva
const MAX_HUELLAS = 50000;   // techo diario de jugadores contados, por coste
const EVENTOS = ['play', 'wave2', 'mp', 'win'];
const BUILDS = ['web', 'crazygames', 'portal'];
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 40;         // eventos por minuto y por IP; una partida manda 1-4

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (b, status = 200) => new Response(JSON.stringify(b), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const diaDe = (t) => new Date(t).toISOString().slice(0, 10);   // UTC
// comparar secretos sin que el tiempo de respuesta delate cuántos caracteres
// coincidían; con la longitud distinta ni se intenta
const igual = (a, b) => {
  const A = new TextEncoder().encode(a), B = new TextEncoder().encode(b);
  if (A.byteLength !== B.byteLength) return false;
  return crypto.subtle.timingSafeEqual ? crypto.subtle.timingSafeEqual(A, B) : a === b;
};
const vacio = () => ({ play: 0, wave2: 0, mp: 0, win: 0, jugadores: 0, builds: {} });

export class Stats {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.hits = new Map();     // ip -> { since, n }  (freno, solo en memoria)
  }

  /* Sal del día, persistida. Al cambiar de día se tira y se estrena otra: a
     partir de ahí las huellas del día anterior ya no son comparables con nada. */
  async sal(dia) {
    const g = await this.state.storage.get('sal');
    if (g && g.dia === dia) return g.valor;
    const valor = crypto.randomUUID();
    await this.state.storage.put('sal', { dia, valor });
    return valor;
  }

  async huella(request, dia) {
    const ip = request.headers.get('CF-Connecting-IP') || '0';
    const ua = request.headers.get('User-Agent') || '';
    const buf = new TextEncoder().encode(`${ip}|${ua}|${await this.sal(dia)}`);
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* Los días viejos se van con sus huellas. Se hace al leer el resumen, que
     ocurre de higos a brevas, y nunca en la ruta que corre en cada partida. */
  async purgar(dias) {
    const sobran = dias.slice(0, Math.max(0, dias.length - DIAS));
    for (const d of sobran) {
      await this.state.storage.delete(`d:${d}`);
      const viejas = await this.state.storage.list({ prefix: `h:${d}:`, limit: 1000 });
      if (viejas.size) await this.state.storage.delete([...viejas.keys()]);
    }
    return sobran;
  }

  async fetch(request) {
    const now = Date.now();
    const url = new URL(request.url);

    if (request.method === 'POST') {
      let b;
      try { b = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }

      /* Borrado de los contadores, para dejarlos a cero antes de publicar.
         El secreto va en el CUERPO, nunca en la dirección: con la
         observabilidad encendida, Cloudflare guarda «MÉTODO URL» de cada
         llamada, así que un ?reset=secreto acabaría escrito en sus registros
         (y en el historial del navegador). Los cuerpos no se registran. */
      if (b.reset !== undefined) {
        if (!this.env?.STATS_TOKEN || !igual(String(b.reset), this.env.STATS_TOKEN)) {
          return json({ error: 'no' }, 403);
        }
        await this.state.storage.deleteAll();
        return json({ ok: true, borrado: true });
      }

      // el resto del POST solo cuenta en /stat: antes, un POST a /stats o a
      // /panel registraba eventos igual
      if (!url.pathname.endsWith('/stat')) return json({ error: 'method' }, 405);

      /* Freno por IP, como en el tablón. Una partida manda entre uno y cuatro
         eventos; cuarenta por minuto deja sitio de sobra a varias personas
         tras el mismo router y corta el bucle que agotaría la cuota del día. */
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      const w = this.hits.get(ip);
      if (!w || now - w.since > RATE_WINDOW_MS) this.hits.set(ip, { since: now, n: 1 });
      else if (++w.n > RATE_MAX) return json({ error: 'slow-down' }, 429);
      if (this.hits.size > 5000) this.hits.clear();

      const ev = EVENTOS.includes(b.ev) ? b.ev : null;
      if (!ev) return json({ error: 'bad-event' }, 400);
      const build = BUILDS.includes(b.build) ? b.build : 'web';

      const dia = diaDe(now);
      const reg = (await this.state.storage.get(`d:${dia}`)) || vacio();
      reg[ev]++;
      // la plataforma se reparte por PARTIDAS, no por eventos: contándolos
      // todos, esa columna nunca cuadraba con la de partidas
      if (ev === 'play') {
        reg.builds[build] = (reg.builds[build] || 0) + 1;
        if (reg.jugadores < MAX_HUELLAS) {
          const clave = `h:${dia}:${await this.huella(request, dia)}`;
          if (!(await this.state.storage.get(clave))) {
            await this.state.storage.put(clave, 1);
            reg.jugadores++;
          }
        } else {
          reg.tope = true;         // el recuento de jugadores se queda ahí; se avisa
        }
      }

      // a disco al momento: el objeto hiberna a los 10 s y estos eventos
      // llegan de uno en uno, así que diferir la escritura los perdería
      await this.state.storage.put(`d:${dia}`, reg);
      return json({ ok: true });
    }

    if (request.method !== 'GET') return json({ error: 'method' }, 405);

    const lista = await this.state.storage.list({ prefix: 'd:' });
    const orden = [...lista.keys()].map(k => k.slice(2)).sort();
    const fuera = await this.purgar(orden);
    const dias = orden.filter(d => !fuera.includes(d)).map((d) => {
      const v = lista.get(`d:${d}`) || vacio();
      return { dia: d, jugadores: v.jugadores || 0, partidas: v.play || 0, oleada2: v.wave2 || 0,
        multijugador: v.mp || 0, victorias: v.win || 0, plataformas: v.builds || {}, tope: !!v.tope };
    });
    const suma = (k) => dias.reduce((a, x) => a + x[k], 0);
    const hoy = diaDe(now);
    const desde7 = diaDe(now - 6 * 864e5);
    const resumen = {
      // HOY es el día de hoy aunque no haya jugado nadie: antes se enseñaba el
      // último día CON datos, que a primera hora era el de ayer disfrazado
      hoy: dias.find(d => d.dia === hoy)?.jugadores || 0,
      ultimos_7_dias: dias.filter(d => d.dia >= desde7).reduce((a, d) => a + d.jugadores, 0),
      total_partidas: suma('partidas'),
      total_multijugador: suma('multijugador'),
      total_victorias: suma('victorias'),
      // por jugador-DÍA: quien vuelve mañana cuenta otra vez, porque sin
      // rastrear a nadie no hay forma de saber que es el mismo
      partidas_por_jugador_dia: suma('jugadores') ? +(suma('partidas') / suma('jugadores')).toFixed(2) : 0,
      dias,
    };
    if (url.pathname.endsWith('/panel')) return new Response(panel(resumen, hoy), {
      headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
    return json(resumen);
  }
}

/* Página mínima para mirar los números sin montar nada más. */
function panel(r, hoy) {
  const fila = (d) => `<tr><td>${d.dia}${d.tope ? ' *' : ''}</td><td class="n">${d.jugadores}</td>`
    + `<td class="n">${d.partidas}</td><td class="n">${d.oleada2}</td><td class="n">${d.multijugador}</td>`
    + `<td class="n">${d.victorias}</td>`
    + `<td class="p">${Object.entries(d.plataformas).map(([k, v]) => `${k}&nbsp;${v}`).join(' · ') || '—'}</td></tr>`;
  const max = Math.max(1, ...r.dias.map(d => d.jugadores));
  const barras = r.dias.slice(-30).map(d =>
    `<i style="height:${Math.round(d.jugadores / max * 100)}%" title="${d.dia}: ${d.jugadores}"></i>`).join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Space Battle — jugadores</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;padding:28px 20px;background:#050a10;color:#cfe6f5;
   font:14px/1.6 "JetBrains Mono","SF Mono",Menlo,monospace}
 h1{font-size:16px;letter-spacing:.24em;color:#7fe7ff;font-weight:500;margin:0 0 4px}
 p.sub{color:#5d8298;font-size:11px;margin:0 0 26px}
 .cifras{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:26px}
 .c{border:1px solid #234655;border-radius:6px;padding:12px 18px;background:#0a141c;min-width:130px}
 .c b{display:block;font-size:26px;color:#7fffc4;font-weight:500}
 .c span{font-size:10px;letter-spacing:.14em;color:#5d8298}
 .g{display:flex;align-items:flex-end;justify-content:flex-start;gap:3px;height:90px;
   margin-bottom:26px;border-bottom:1px solid #234655;padding-bottom:2px}
 .g i{flex:1 1 auto;max-width:26px;background:linear-gradient(#7fe7ff,#2b6f9f);
   min-height:2px;border-radius:2px 2px 0 0}
 table{border-collapse:collapse;width:100%;font-size:12px}
 th{text-align:left;color:#5d8298;font-weight:500;font-size:10px;letter-spacing:.14em;
   border-bottom:1px solid #234655;padding:6px 10px 6px 0}
 td{padding:5px 10px 5px 0;border-bottom:1px solid #101d27}
 td.n{text-align:right;width:70px}
 td.p{color:#5d8298;font-size:11px}
 tr:hover td{background:#0a141c}
 footer{color:#3f5f75;font-size:10px;margin-top:22px;line-height:1.9}
</style>
<h1>SPACE BATTLE</h1>
<p class="sub">Jugadores distintos por día · sin cookies: la huella caduca cada noche</p>
<div class="cifras">
  <div class="c"><b>${r.hoy}</b><span>HOY · ${hoy}</span></div>
  <div class="c"><b>${r.ultimos_7_dias}</b><span>ÚLTIMOS 7 DÍAS</span></div>
  <div class="c"><b>${r.total_partidas}</b><span>PARTIDAS</span></div>
  <div class="c"><b>${r.total_multijugador}</b><span>MULTIJUGADOR</span></div>
  <div class="c"><b>${r.partidas_por_jugador_dia}</b><span>PARTIDAS/JUGADOR</span></div>
</div>
<div class="g">${barras}</div>
<table><tr><th>DÍA</th><th class="n">JUGADORES</th><th class="n">PARTIDAS</th><th class="n">OLEADA 2</th>
<th class="n">MULTI</th><th class="n">VICTORIAS</th><th>PLATAFORMA</th></tr>
${r.dias.slice().reverse().map(fila).join('')}</table>
<footer>El día empieza a medianoche UTC, no en tu reloj.<br>
Dos personas en la misma red y con el mismo navegador cuentan como una.<br>
«Partidas/jugador» es por jugador y día: quien vuelve mañana cuenta otra vez.<br>
Un asterisco marca los días que tocaron el techo de ${MAX_HUELLAS.toLocaleString('es')} jugadores.</footer>`;
}
