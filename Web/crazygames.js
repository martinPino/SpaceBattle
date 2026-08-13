/* Integración con el SDK de CrazyGames.
   ---------------------------------------------------------------------------
   Todo aquí es opcional por diseño: si `window.CrazyGames` no existe —en
   itch.io o en tu Vercel— cada función es un no-op y el juego se comporta
   exactamente igual. Así un único paquete vale para las tres plataformas.

   Cubre lo que CrazyGames exige para aceptar un juego multijugador:
     · isInstantMultiplayer — el líder de una party entra directo a una sala
     · invite link / room data — sus amigos pueden unirse desde la plataforma
     · muteAudio — su botón de silencio manda sobre el audio del juego
   y lo recomendable: marcar carga y partida, y celebrar las victorias. */

const SDK = () => (typeof window !== 'undefined' && window.CrazyGames && window.CrazyGames.SDK) || null;
export const onCrazyGames = () => !!SDK();

let ready = false;
const hooks = { join: null, mute: null };

export async function cgInit({ onJoinRoom, onMute } = {}) {
  hooks.join = onJoinRoom;
  hooks.mute = onMute;
  const sdk = SDK();
  if (!sdk) return false;
  try {
    await sdk.init();
    ready = true;
    sdk.game.loadingStart();
    // su botón de silencio manda sobre cualquier ajuste del juego
    const apply = (s) => hooks.mute && hooks.mute(!!(s && s.muteAudio));
    apply(sdk.game.settings);
    sdk.game.addSettingsChangeListener(apply);
    // un amigo te invita con la partida ya abierta
    sdk.game.addJoinRoomListener((params) => {
      const room = params && (params.room || params.roomName);
      if (room && hooks.join) hooks.join(String(room));
    });
    return true;
  } catch { return false; }
}

/* Sala a la que entrar al arrancar: o venimos de un enlace de invitación, o
   somos el líder de una party y toca abrir una nosotros (instant multiplayer). */
export function cgStartupRoom() {
  const sdk = SDK();
  if (!sdk || !ready) return { room: null, instant: false };
  let room = null;
  try { room = sdk.game.getInviteParam('room'); } catch { /* sin invitación */ }
  let instant = false;
  try { instant = !!sdk.game.isInstantMultiplayer; } catch { /* campo ausente */ }
  return { room, instant };
}

// sala abierta: la plataforma muestra el botón de invitar y avisa a los amigos
export function cgRoomOpen(roomId) {
  const sdk = SDK();
  if (!sdk || !ready) return;
  try {
    sdk.game.updateRoom({ roomId, isJoinable: true, inviteParams: { room: roomId } });
  } catch { /* la sala seguirá funcionando por enlace normal */ }
}
export function cgRoomClosed() {
  const sdk = SDK();
  if (!sdk || !ready) return;
  try { sdk.game.updateRoom({ isJoinable: false }); } catch { /* ya cerrada */ }
}
export function cgRoomLeft() {
  const sdk = SDK();
  if (!sdk || !ready) return;
  try { sdk.game.leftRoom(); } catch { /* ya fuera */ }
}

// enlace de invitación de la propia plataforma, que abre el juego en su web
export function cgInviteLink(roomId) {
  const sdk = SDK();
  if (!sdk || !ready) return null;
  try { return sdk.game.inviteLink({ room: roomId }); } catch { return null; }
}

export function cgLoaded() { try { SDK() && ready && SDK().game.loadingStop(); } catch { /* no crítico */ } }
export function cgPlaying(on) {
  const sdk = SDK();
  if (!sdk || !ready) return;
  try { on ? sdk.game.gameplayStart() : sdk.game.gameplayStop(); } catch { /* no crítico */ }
}
export function cgCelebrate() { try { SDK() && ready && SDK().game.happytime(); } catch { /* no crítico */ } }
export function cgProgress(pct) {
  const sdk = SDK();
  if (!sdk || !ready) return;
  try { sdk.game.reportGameCompletedPercentage(Math.max(0, Math.min(100, Math.round(pct)))); } catch { /* no crítico */ }
}
