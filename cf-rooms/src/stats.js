/* Cuántos juegan de verdad — contador propio, sin cookies ni rastreo.
   ---------------------------------------------------------------------------
   Ni CrazyGames ni la analítica de Vercel responden a la pregunta completa:
   una es solo su plataforma y la otra cuenta quién ABRE la página, no quién
   llega a jugar. Esto cuenta partidas y jugadores distintos en las tres
   versiones (web, itch, CrazyGames) con un único endpoint:

     POST /stat   { ev: 'play' | 'wave2' | 'mp' | 'win', build }
     GET  /stats                                resumen de los últimos 60 días

   Cómo se distingue a un jugador sin seguirle la pista:

     huella = SHA-256(IP + navegador + sal_del_día)   →  8 bytes en hexadecimal

   La IP nunca se guarda: se usa un instante para calcular la huella y se
   descarta. La sal es aleatoria y se tira cada noche, así que las huellas de
   ayer no se pueden comparar con las de hoy ni con nadie: solo sirven para no
   contar dos veces a la misma persona dentro del mismo día. Es el método de
   las analíticas que no piden consentimiento, y evita tocar el dispositivo de
   quien juega — un identificador en su navegador sí necesitaría permiso. */

const DIAS = 60;             // histórico que se conserva
const MAX_HUELLAS = 20000;   // techo por día, para que un objeto no crezca sin fin
const EVENTOS = ['play', 'wave2', 'mp', 'win'];
const BUILDS = ['web', 'crazygames', 'portal'];

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

const hoy = (t) => new Date(t).toISOString().slice(0, 10);

export class Stats {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.dias = new Map();     // 'AAAA-MM-DD' -> { play, wave2, mp, win, builds, huellas:Set }
    this.sal = null;           // sal del día en curso, solo en memoria
    this.salDia = null;
    state.blockConcurrencyWhile(async () => {
      const g = await state.storage.get('dias');
      if (g && typeof g === 'object') {
        for (const [d, v] of Object.entries(g.dias || {})) {
          this.dias.set(d, { ...v, huellas: new Set(v.huellas || []) });
        }
      }
    });
  }

  async persist(now) {
    const dias = {};
    for (const [d, v] of this.dias) dias[d] = { ...v, huellas: [...v.huellas] };
    await this.state.storage.put('dias', { dias, flushedAt: now });
  }

  dia(d) {
    if (!this.dias.has(d)) {
      this.dias.set(d, { play: 0, wave2: 0, mp: 0, win: 0, builds: {}, huellas: new Set() });
      // el objeto sobrevive meses: se tiran los días viejos al crear uno nuevo
      const vivos = [...this.dias.keys()].sort();
      while (vivos.length > DIAS) this.dias.delete(vivos.shift());
    }
    return this.dias.get(d);
  }

  /* La sal se renueva sola al cambiar de día. Como vive solo en memoria, un
     reinicio del objeto la cambia también: en el peor caso alguien cuenta dos
     veces ese día, que es el error que se prefiere frente a guardar algo que
     permita reconstruir quién era. */
  async huella(request, d) {
    if (this.salDia !== d) {
      this.salDia = d;
      this.sal = crypto.randomUUID();
    }
    const ip = request.headers.get('CF-Connecting-IP') || '0';
    const ua = request.headers.get('User-Agent') || '';
    const buf = new TextEncoder().encode(`${ip}|${ua}|${this.sal}`);
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async fetch(request) {
    const now = Date.now();
    const url = new URL(request.url);

    /* Borrado de los contadores, para dejarlos a cero antes de publicar. Pide
       el secreto que guarda Cloudflare (wrangler secret put STATS_TOKEN); sin
       secreto configurado, nadie puede borrar nada. */
    const reset = url.searchParams.get('reset');
    if (reset) {
      if (!this.env?.STATS_TOKEN || reset !== this.env.STATS_TOKEN) return json({ error: 'no' }, 403);
      this.dias.clear();
      await this.state.storage.delete('dias');
      return json({ ok: true, borrado: true });
    }

    if (request.method === 'POST') {
      let b;
      try { b = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }
      const ev = EVENTOS.includes(b.ev) ? b.ev : null;
      if (!ev) return json({ error: 'bad-event' }, 400);
      const build = BUILDS.includes(b.build) ? b.build : 'web';

      const d = hoy(now);
      const reg = this.dia(d);
      reg[ev]++;
      reg.builds[build] = (reg.builds[build] || 0) + 1;

      // jugadores distintos: solo cuenta al empezar a jugar, no en cada evento
      let nuevo = false;
      if (ev === 'play' && reg.huellas.size < MAX_HUELLAS) {
        const h = await this.huella(request, d);
        nuevo = !reg.huellas.has(h);
        if (nuevo) reg.huellas.add(h);
      }

      /* A disco SIEMPRE, sin débito diferido. Aquí no vale el truco del tablón:
         el objeto hiberna a los 10 s y estos eventos llegan de uno en uno cada
         varios minutos, así que casi todos se perderían antes de bajar. Una
         escritura por partida son cuatro cifras al día en el peor caso, nada
         frente a las cien mil del plan gratuito — y son datos que, perdidos,
         no se recuperan. */
      await this.persist(now);
      return json({ ok: true });
    }

    const dias = [...this.dias.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ dia: d, jugadores: v.huellas.size, partidas: v.play,
        oleada2: v.wave2, multijugador: v.mp, victorias: v.win, plataformas: v.builds }));
    const suma = (k) => dias.reduce((a, x) => a + x[k], 0);
    const resumen = {
      // OJO: los jugadores se cuentan por día; sumarlos NO da personas distintas,
      // porque quien vuelve mañana cuenta otra vez. Es el precio de no rastrear.
      jugadores_por_dia: dias.map(x => x.jugadores),
      total_partidas: suma('partidas'),
      total_multijugador: suma('multijugador'),
      total_victorias: suma('victorias'),
      media_partidas_por_jugador: suma('jugadores') ? +(suma('partidas') / suma('jugadores')).toFixed(2) : 0,
      dias,
    };
    if (url.pathname.endsWith('/panel')) return new Response(panel(resumen), {
      headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
    return json(resumen);
  }
}

/* Página mínima para mirar los números sin montar nada más. */
function panel(r) {
  const fila = (d) => `<tr><td>${d.dia}</td><td class="n">${d.jugadores}</td><td class="n">${d.partidas}</td>`
    + `<td class="n">${d.oleada2}</td><td class="n">${d.multijugador}</td><td class="n">${d.victorias}</td>`
    + `<td class="p">${Object.entries(d.plataformas).map(([k, v]) => `${k}&nbsp;${v}`).join(' · ') || '—'}</td></tr>`;
  const dias = r.dias.slice().reverse();
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
 .g{display:flex;align-items:flex-end;justify-content:flex-start;gap:3px;height:90px;margin-bottom:26px;
   border-bottom:1px solid #234655;padding-bottom:2px}
 .g i{flex:1 1 auto;max-width:26px;background:linear-gradient(#7fe7ff,#2b6f9f);min-height:2px;border-radius:2px 2px 0 0}
 table{border-collapse:collapse;width:100%;font-size:12px}
 th{text-align:left;color:#5d8298;font-weight:500;font-size:10px;letter-spacing:.14em;
   border-bottom:1px solid #234655;padding:6px 10px 6px 0}
 td{padding:5px 10px 5px 0;border-bottom:1px solid #101d27}
 td.n{text-align:right;width:70px}
 td.p{color:#5d8298;font-size:11px}
 tr:hover td{background:#0a141c}
</style>
<h1>SPACE BATTLE</h1>
<p class="sub">Jugadores distintos por día · sin cookies: la huella caduca cada noche</p>
<div class="cifras">
  <div class="c"><b>${r.dias.at(-1)?.jugadores ?? 0}</b><span>HOY</span></div>
  <div class="c"><b>${r.dias.slice(-7).reduce((a, d) => a + d.jugadores, 0)}</b><span>ÚLTIMOS 7 DÍAS</span></div>
  <div class="c"><b>${r.total_partidas}</b><span>PARTIDAS</span></div>
  <div class="c"><b>${r.total_multijugador}</b><span>MULTIJUGADOR</span></div>
  <div class="c"><b>${r.media_partidas_por_jugador}</b><span>PARTIDAS/JUGADOR</span></div>
</div>
<div class="g">${barras}</div>
<table><tr><th>DÍA</th><th class="n">JUGADORES</th><th class="n">PARTIDAS</th><th class="n">OLEADA 2</th>
<th class="n">MULTI</th><th class="n">VICTORIAS</th><th>PLATAFORMA</th></tr>
${dias.map(fila).join('')}</table>`;
}
