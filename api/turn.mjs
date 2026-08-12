/* Acuña credenciales TURN de Cloudflare.
   ---------------------------------------------------------------------------
   El token de Cloudflare no es como el de Metered: no es una clave de cliente,
   es un secreto que GENERA credenciales. Si viajara al navegador, cualquiera
   podría acuñar las suyas y gastarse la cuota. Por eso vive aquí, en una
   función de servidor, y al navegador solo llegan credenciales temporales.

   Variables de entorno en Vercel (Settings → Environment Variables):
     CF_TURN_KEY_ID     — TURN Token ID del panel de Cloudflare
     CF_TURN_API_TOKEN  — su API token

   Sin ellas responde 501 y el juego usa el relé de reserva. */
export default async function handler(req, res) {
  const id = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) {
    res.status(501).json({ error: 'cloudflare-turn-not-configured' });
    return;
  }
  try {
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        // 12 h: de sobra para una sesión de juego, y limita el daño si se filtran
        body: JSON.stringify({ ttl: 43200 }),
      },
    );
    if (!r.ok) {
      res.status(502).json({ error: `cloudflare-${r.status}` });
      return;
    }
    const data = await r.json();
    // la API devuelve un objeto; el navegador espera una lista
    const list = Array.isArray(data.iceServers) ? data.iceServers
      : data.iceServers ? [data.iceServers] : [];
    // se cachea menos que el ttl para que nunca se sirvan credenciales vencidas
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800');
    res.status(200).json({ iceServers: list });
  } catch {
    res.status(502).json({ error: 'cloudflare-unreachable' });
  }
}
