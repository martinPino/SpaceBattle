/* Cuántos juegan de verdad.
   ---------------------------------------------------------------------------
   Ni la analítica de Vercel ni la de CrazyGames responden a la pregunta
   completa: la primera cuenta quién ABRE la página (y no viaja en los
   paquetes de los portales), y la segunda solo ve su plataforma. Esto manda
   cuatro señales al Worker propio, iguales en las tres versiones.

   No se envía nada de quien juega: ni identificador, ni nombre, ni partida.
   Solo qué ocurrió y en qué plataforma. Quién es «uno distinto» lo decide el
   servidor con una huella que caduca cada noche, así que aquí no hay nada que
   guardar en su navegador ni permiso que pedir.

   Si el servidor no responde, no pasa nada: se traga el error y el juego sigue. */

const API = 'https://space-battle-rooms.martin-schwarzbock.workers.dev/stat';

// una misma señal no se manda dos veces en la misma sesión (salvo 'play', que
// sí puede repetirse: son partidas distintas)
const enviado = new Set();

function plataforma() {
  try {
    if (window.CrazyGames && window.CrazyGames.SDK) return 'crazygames';
    if (window.SB_CLEAN) return 'portal';
  } catch { /* da igual */ }
  return 'web';
}

export function stat(ev) {
  if (ev !== 'play' && enviado.has(ev)) return;
  enviado.add(ev);
  try {
    // text/plain para no arrastrar la petición de sondeo previa del navegador
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ ev, build: plataforma() }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* nunca romper el juego por una estadística */ }
}
