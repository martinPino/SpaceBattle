/* Directorio de salas públicas.
   ---------------------------------------------------------------------------
   El juego es P2P: no hay servidor de partida donde mirar quién está jugando.
   Esto es lo mínimo para suplirlo — un tablón de anuncios con caducidad:

     POST /api/rooms  { id, name, players, max, mode }   el anfitrión se anuncia
     GET  /api/rooms                                     lista de salas vivas

   Cada anuncio caduca solo a los 40 s, así que un anfitrión que cierra el
   navegador desaparece de la lista sin que nadie tenga que limpiarla. El juego
   refresca cada 15 s mientras la sala admita gente.

   Almacén: Redis de Upstash por REST (el que provisiona Vercel en su
   Marketplace, plan gratuito). Sin configurar, responde `disabled` y el juego
   simplemente no enseña la sección: nada se rompe. */

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 40;          // segundos que vive un anuncio sin refrescar
const MAX_ROOMS = 40;    // techo de lo que se devuelve, por si algún día hay cola

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result;
}

const clean = (s, n) => String(s ?? '').replace(/[<>"'\\]/g, '').slice(0, n);

export default async function handler(req, res) {
  // el juego publicado en portales corre en otro dominio
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!URL_ || !TOKEN) {
    res.status(200).json({ rooms: [], disabled: true });
    return;
  }

  try {
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const id = clean(b.id, 64);
      if (!id) { res.status(400).json({ error: 'missing-id' }); return; }
      if (b.closed) {                      // el anfitrión se va o cierra la sala
        await redis(['DEL', `sb:room:${id}`]);
        res.status(200).json({ ok: true, removed: true });
        return;
      }
      const room = {
        id,
        name: clean(b.name, 14) || 'PILOT',
        players: Math.max(1, Math.min(8, parseInt(b.players, 10) || 1)),
        max: Math.max(2, Math.min(8, parseInt(b.max, 10) || 8)),
        mode: b.mode === 'teams' ? 'teams' : 'ffa',
      };
      await redis(['SET', `sb:room:${id}`, JSON.stringify(room), 'EX', String(TTL)]);
      res.status(200).json({ ok: true });
      return;
    }

    const keys = (await redis(['KEYS', 'sb:room:*'])) || [];
    if (!keys.length) { res.status(200).json({ rooms: [] }); return; }
    const vals = (await redis(['MGET', ...keys.slice(0, MAX_ROOMS)])) || [];
    const rooms = vals.map((v) => { try { return JSON.parse(v); } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => b.players - a.players);
    res.setHeader('Cache-Control', 'no-store'); // una lista de salas rancia no sirve
    res.status(200).json({ rooms });
  } catch {
    res.status(200).json({ rooms: [], error: true }); // nunca romper la sala por esto
  }
}
