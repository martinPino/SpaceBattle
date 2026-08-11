// SPACE BATTLE — Web · batalla de flotas estilo space-opera.
// Construido sobre el space-kit del proyecto (Tools/viewer/space-kit-models.js):
// mismos modelos, mismas seeds, misma dirección de arte (Espacio + Vacío).
import * as THREE from 'three';
import {
  buildPlayerFighter, buildCapitalShip, buildAsteroidMedium01, buildAsteroidLarge01,
  buildAsteroidField, buildPlanetEarthLike, buildPlanetRinged, buildPlanetGasGiant,
  buildMoonRocky, buildStar, buildNebula, buildStarfieldDome, MAT,
} from '../Tools/viewer/space-kit-models.js';
import { makeSpaceEnvironment, radialGlow } from '../Tools/viewer/space-kit-textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ============================== escenario ============================== */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 30000);

const envRig = makeSpaceEnvironment(renderer);
scene.environment = envRig.env; // los metales necesitan algo que reflejar
scene.background = null;        // fondo "Vacío": el negro lo llenan el domo y las nebulosas

// iluminación "Espacio" — el rig EXACTO aprobado en el visor del kit
const sun = new THREE.DirectionalLight(0xfff8f0, 4.4);
sun.position.set(6, 4, 7);
const bounce = new THREE.DirectionalLight(0x3f6f9a, 1.1);
bounce.position.set(-6, -2, -5);
const rim = new THREE.DirectionalLight(0x9fd0e8, 0.8);
rim.position.set(-3, 2, -8);
scene.add(sun, bounce, rim);
const sunDir = sun.position.clone().normalize();

/* --------- decorado lejano (modelos del kit, escala de escena) --------- */
const world = new THREE.Group();
scene.add(world);
// escala MAJESTUOSA: planetas mucho más grandes y mucho más lejos — dominan
// el horizonte sin estorbar la batalla (el domo crece con ellos; sus estrellas
// mantienen el tamaño aparente porque el kit las escala con el radio)
const dome = buildStarfieldDome({ radius: 22000, count: 6000 });
world.add(dome);
const star = buildStar({ radius: 430 });
star.position.copy(sunDir.clone().multiplyScalar(14000));
world.add(star);
const earth = buildPlanetEarthLike({ radius: 1500 });
earth.position.set(-7800, 900, 8400);
world.add(earth);
const ringed = buildPlanetRinged({ radius: 1300 });
ringed.position.set(8700, -2100, -10200);
world.add(ringed);
const gas = buildPlanetGasGiant({ radius: 2600 });
gas.position.set(12600, 3900, 15600);
world.add(gas);
const moon = buildMoonRocky({ radius: 280 });
moon.position.set(-4500, -800, 4500);
world.add(moon);
const nebula = buildNebula({ extent: 2600, puffs: 90 });
nebula.position.set(-9000, 1500, -11000);
world.add(nebula);

/* ============================== facciones ============================== */
const CYAN = 0x6fe8ff, RED = 0xff5a3c;

function tintFaction(root, faction) {
  if (faction === 'ally') return root; // el look por defecto del kit ES el bando aliado
  const red = MAT.emis_red();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.material.name || '';
    if (n.includes('Emissive_Cyan') || n.includes('EngineCore')) o.material = red;
    else if (n.includes('Hull_Mid') || n.includes('Hull_Light')) {
      o.material = o.material.clone();
      // rojizo SIN oscurecer: sobre fondo negro, oscurecer = desaparecer
      o.material.color.lerp(new THREE.Color(0x8a3a2c), 0.4);
    }
  });
  return root;
}

/* luces de posición: los cascos llevan un rescoldo emisivo por bando para que
   las naves se LEAN contra el vacío (el rig de luz "Espacio" no se toca).
   OJO: intensidad < 0.5 — el horneado del enjambre clasifica como "glow" todo
   material con emissiveIntensity > 0.5 y convertiría cascos enteros en neón. */
function liftShipVisibility(root, faction) {
  const glow = new THREE.Color(faction === 'ally' ? 0x16303c : 0x3c1a14);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.material.name || '';
    if (n.includes('Hull')) {
      o.material = o.material.clone();
      o.material.emissive = glow.clone();
      o.material.emissiveIntensity = 0.45;
      if (o.material.metalness !== undefined) o.material.metalness = Math.min(o.material.metalness, 0.3);
    }
  });
  return root;
}
function tintCapital(root, faction) {
  if (faction === 'enemy') return root; // el capital del kit ya viene con rojos: es el enemigo
  const cyan = MAT.emis_cyan();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.material.name || '';
    if (n.includes('Emissive_Red') || n.includes('EngineCore_Red')) o.material = cyan;
  });
  return root;
}

/* ------------------- las dos naves capitales ------------------- */
const alliedCapital = tintCapital(buildCapitalShip({ length: 2600 }), 'ally');
alliedCapital.position.set(-500, -140, -1100);
alliedCapital.rotation.y = 0.35;
world.add(alliedCapital);

const enemyCapital = buildCapitalShip({ length: 2600 });
enemyCapital.position.set(700, 60, 3100);
enemyCapital.rotation.y = Math.PI - 0.3;
world.add(enemyCapital);

/* ----------------- campo de asteroides con colisión ----------------- */
const colliders = [];
function addCollider(obj, r, cap) { colliders.push({ obj, r, pos: new THREE.Vector3(), cap: cap || null }); }

const field = buildAsteroidField({ count: 40, radius: 420, size_max: 14 });
field.position.set(0, -30, 900);
world.add(field);
field.updateMatrixWorld(true);
for (const rock of field.children) addCollider(rock, 1.6 * rock.scale.x);
const big = buildAsteroidLarge01();
big.position.set(-350, 60, 1200);
world.add(big);
addCollider(big, 105);
const med = buildAsteroidMedium01();
med.position.set(140, -20, 500);
world.add(med);
addCollider(med, 26);

// las capitales son entidades de combate: vida, torretas y estado de destrucción
const capitals = {
  ally: { group: alliedCapital, faction: 'ally', hp: 2600, maxHp: 2600, alive: true, dying: 0, burnT: 0, turrets: [], bar: null },
  enemy: { group: enemyCapital, faction: 'enemy', hp: 2600, maxHp: 2600, alive: true, dying: 0, burnT: 0, turrets: [], bar: null },
};

// los cascos de las capitales bloquean: 5 esferas que siguen el afilado del casco
// (las puntas estrechas — nada de parachoques fantasma delante de la proa)
for (const cap of [capitals.ally, capitals.enemy]) {
  for (const [off, r] of [[-1000, 150], [-500, 260], [0, 300], [500, 260], [1000, 150]]) {
    const proxy = new THREE.Object3D();
    cap.group.add(proxy);
    proxy.position.set(0, 0, off);
    addCollider(proxy, r, cap);
  }
}

// torretas: usa los TurretSocket_* del kit y completa con soportes sintéticos
function initTurrets(cap) {
  const marks = [];
  cap.group.traverse((o) => { if (o.name && o.name.includes('TurretSocket')) marks.push(o); });
  while (marks.length < 8) {
    const i = marks.length;
    const p = new THREE.Object3D();
    cap.group.add(p);
    p.position.set(i % 2 ? 110 : -110, 90, -1000 + i * 260);
    marks.push(p);
  }
  cap.turrets = marks.slice(0, 12).map((mark) => ({ mark, flakCool: 1 + Math.random() * 2 }));
}
initTurrets(capitals.ally);
initTurrets(capitals.enemy);
// cache de posiciones de colliders (se refresca una vez por frame)
function refreshColliders() {
  for (const c of colliders) c.obj.getWorldPosition(c.pos);
}

/* ============================== jugador ============================== */
const ship = buildPlayerFighter();
// despega sobre el flanco de la capital aliada, con el pasillo hacia delante LIBRE
// (comprobado contra las esferas de colisión del casco)
ship.position.set(-80, 60, -650);
scene.add(ship);
const muzzles = ['Muzzle_L', 'Muzzle_R'].map((n) => ship.getObjectByName(n));
const engineMarks = ['FX_Engine_L', 'FX_Engine_R'].map((n) => ship.getObjectByName(n));

const flameTex = radialGlow([0.45, 0.85, 1.0], 0.32);
const engineFx = engineMarks.map((mark) => {
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flameTex, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flame.scale.setScalar(0.1);
  mark.add(flame);
  const light = new THREE.PointLight(0x54c8ff, 0, 40);
  mark.add(light);
  return { flame, light };
});

const player = {
  vel: new THREE.Vector3(), angVel: new THREE.Vector3(),
  shield: 100, hull: 100, dead: false, radius: 6,
};
const TUNE = {
  accel: 70, maxSpeed: 95, boostSpeed: 190, boostAccel: 160,
  strafe: 45, vertical: 45,
  mousePitch: 2.6, mouseYaw: 2.1, rollAccel: 6.5,
  linDamp: 0.6, angDamp: 4.5,
};

/* ============================== input ============================== */
const keys = {};
let mouseDX = 0, mouseDY = 0, firing = false, started = false;

/* ---- móvil: stick derecho (dirección), FUEGO izquierda, TURBO y MISIL ---- */
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const touchStick = { x: 0, y: 0 };
let touchBoost = false;
if (isTouch) {
  document.body.classList.add('touch');
  const zone = document.getElementById('stickZone');
  const base = document.getElementById('stickBase');
  const knob = document.getElementById('stickKnob');
  const STICK_R = 62;
  let stickId = null, cx = 0, cy = 0;

  function placeStick(x, y) {
    base.style.left = `${x - zone.getBoundingClientRect().left - 62}px`;
    base.style.top = `${y - zone.getBoundingClientRect().top - 62}px`;
    base.style.display = 'block';
    knob.style.display = 'block';
  }
  function moveKnob(x, y) {
    let dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_R) { dx *= STICK_R / len; dy *= STICK_R / len; }
    touchStick.x = dx / STICK_R;
    touchStick.y = dy / STICK_R;
    const zr = zone.getBoundingClientRect();
    knob.style.left = `${cx + dx - zr.left - 28}px`;
    knob.style.top = `${cy + dy - zr.top - 28}px`;
  }
  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (stickId !== null) return;
    const t = e.changedTouches[0];
    stickId = t.identifier;
    cx = t.clientX; cy = t.clientY;
    placeStick(cx, cy);
    moveKnob(cx, cy);
  }, { passive: false });
  zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === stickId) moveKnob(t.clientX, t.clientY);
  }, { passive: false });
  const stickEnd = (e) => {
    for (const t of e.changedTouches) if (t.identifier === stickId) {
      stickId = null;
      touchStick.x = touchStick.y = 0;
      base.style.display = 'none';
      knob.style.display = 'none';
    }
  };
  zone.addEventListener('touchend', stickEnd);
  zone.addEventListener('touchcancel', stickEnd);

  const hold = (id, on, off) => {
    const b = document.getElementById(id);
    b.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
    b.addEventListener('touchend', (e) => { e.preventDefault(); off && off(); }, { passive: false });
    b.addEventListener('touchcancel', () => off && off());
  };
  hold('fireBtn', () => { firing = true; }, () => { firing = false; });
  hold('boostBtn', () => { touchBoost = true; }, () => { touchBoost = false; });
  hold('missileBtn', () => launchMissile());
}
addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => {
  if (!document.pointerLockElement) return;
  if (e.button === 0) firing = true;
  else if (e.button === 2) launchMissile();
});
addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (!document.pointerLockElement) return;
  mouseDX += e.movementX; mouseDY += e.movementY;
});
function lockPointer() {
  if (isTouch) return; // en táctil no hay pointer lock: manda el stick
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {}); // Chrome rechaza re-locks <1.25s tras Esc
}
document.getElementById('startBtn').onclick = () => {
  document.getElementById('start').classList.add('hidden');
  initAudio(); // el gesto del usuario desbloquea el audio del navegador
  if (audio && audio.ctx.state === 'suspended') audio.ctx.resume();
  lockPointer();
  started = true;
};
document.getElementById('nextWaveBtn').onclick = () => startNextWave();
renderer.domElement.addEventListener('click', () => {
  if (started && !document.pointerLockElement) lockPointer();
});
// al perder el lock o el foco, ningún input puede quedarse "pegado"
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement) { firing = false; mouseDX = mouseDY = 0; }
});
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  firing = false;
});
// pestaña oculta: rAF se pausa pero el AudioContext seguiría sonando (drone eterno)
document.addEventListener('visibilitychange', () => {
  if (!audio) return;
  if (document.hidden) audio.ctx.suspend();
  else audio.ctx.resume();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  sizeMarkers();
});

/* ============================== láseres ============================== */
const laserGeo = new THREE.BoxGeometry(0.09, 0.09, 3.2);
const allyLaserMat = new THREE.MeshBasicMaterial({ color: CYAN });
const enemyLaserMat = new THREE.MeshBasicMaterial({ color: RED });
const lasers = [];
const laserPool = [];
for (let i = 0; i < 340; i++) {
  const m = new THREE.Mesh(laserGeo, allyLaserMat);
  m.visible = false;
  scene.add(m);
  laserPool.push(m);
}
function fireLaser(origin, dir, speed, faction, isPlayer = false) {
  const m = laserPool.pop();
  if (!m) return;
  m.material = faction === 'ally' ? allyLaserMat : enemyLaserMat;
  m.position.copy(origin);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  m.visible = true;
  lasers.push({ mesh: m, vel: dir.clone().multiplyScalar(speed), life: 2.2, faction, isPlayer });
  sfxLaser(isPlayer ? 0.55 : gainFor(origin, 650) * 0.35);
}

/* ------------------------- destellos (POOL FIJO) -------------------------
   La cuenta de luces de la escena no cambia nunca en runtime: cambiar el número
   de PointLights fuerza a three.js a recompilar los shaders de TODOS los
   materiales en pleno combate (tirones). Pool constante = cero recompilaciones. */
const flashTex = radialGlow([0.6, 0.9, 1.0], 0.28);
const boomTex = radialGlow([1.0, 0.62, 0.3], 0.3);
const flashSlots = [];
for (let i = 0; i < 10; i++) {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, opacity: 0,
  }));
  spr.visible = false;
  const light = new THREE.PointLight(0x7fd8ff, 0, 80);
  scene.add(spr, light);
  flashSlots.push({ spr, light, life: 0, total: 1, grow: 0, active: false });
}
function flash(pos, warm = false, size = 6, time = 0.18) {
  let slot = flashSlots.find((s) => !s.active);
  if (!slot) slot = flashSlots.reduce((a, b) => (a.life < b.life ? a : b)); // roba el más gastado
  slot.active = true;
  slot.spr.visible = true;
  slot.spr.material.map = warm ? boomTex : flashTex;
  slot.spr.material.opacity = 1;
  slot.spr.position.copy(pos);
  slot.spr.scale.setScalar(size);
  slot.light.color.setHex(warm ? 0xffa050 : 0x7fd8ff);
  slot.light.intensity = 6;
  slot.light.distance = size * 12;
  slot.light.position.copy(pos);
  slot.life = time;
  slot.total = time;
  slot.grow = size * 2.4;
}

/* ============================== sonido ==============================
   100% sintetizado con WebAudio — como los modelos: el audio también es código.
   Presupuesto de láseres por segundo (184 tiradores ahí fuera) y atenuación
   por distancia al jugador. Se inicia con el gesto del botón de inicio. */
const AC = window.AudioContext || window.webkitAudioContext;
let audio = null;
let sfxMuted = false; // __sb.step() simula minutos en un instante: sin esto, cientos de nodos a la vez
function initAudio() {
  if (audio || !AC) return;
  const ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(ctx.destination);
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  // motor: ruido en banda que sigue al acelerador
  const engineSrc = ctx.createBufferSource();
  engineSrc.buffer = noiseBuf;
  engineSrc.loop = true;
  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'bandpass';
  engineFilter.frequency.value = 110;
  engineFilter.Q.value = 1.1;
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineSrc.connect(engineFilter).connect(engineGain).connect(master);
  engineSrc.start();
  audio = {
    ctx, master, engineGain, engineFilter, noiseBuf, laserBudget: 2,
    music: null, musicTrack: null, laserBuf: null, explodeBuf: null, shieldBuf: null, musicTrackBuf: null,
  };
  // samples del usuario; si alguno falla, queda el respaldo sintetizado
  const loadSample = (url, key, onOk, onFail) => fetch(url)
    .then((r) => r.arrayBuffer())
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => { audio[key] = decoded; onOk && onOk(); })
    .catch(() => { onFail && onFail(); });
  loadSample('./assets/blaster-fire.mp3', 'laserBuf');
  loadSample('./assets/ship-explode.mp3', 'explodeBuf');
  loadSample('./assets/shield-down.mp3', 'shieldBuf');
  loadSample('./assets/flyby.mp3', 'flybyBuf');
  loadSample('./assets/battle-music.mp3', 'musicTrackBuf',
    () => startUserMusic(),  // la pista del usuario, en bucle perfecto
    () => startMusic());     // sin pista: banda sonora generativa de respaldo
}

// música del usuario en bucle sin costuras para toda la partida
function startUserMusic() {
  if (!audio || audio.musicTrack) return;
  const { ctx, master } = audio;
  const gain = ctx.createGain();
  gain.gain.value = 0.42; // presente, pero los efectos mandan
  gain.connect(master);
  const src = ctx.createBufferSource();
  src.buffer = audio.musicTrackBuf;
  src.loop = true;
  src.connect(gain);
  src.start();
  audio.musicTrack = { src, gain };
}

// whoosh de pasada cercana: una nave cruza rozándote a velocidad
let flybyCool = 0;
function sfxFlyby(vol) {
  if (sfxMuted || !audio || !audio.flybyBuf) return;
  const { ctx, master } = audio;
  const src = ctx.createBufferSource();
  src.buffer = audio.flybyBuf;
  src.playbackRate.value = 0.94 + Math.random() * 0.14;
  const g = ctx.createGain();
  g.gain.value = 0.7 * vol;
  src.connect(g).connect(master);
  src.start();
}
function checkFlybys(dt) {
  flybyCool -= dt;
  if (flybyCool > 0 || player.dead || !started) return;
  const R2 = 52 * 52;
  const near = (e) => {
    const d2 = e.obj.position.distanceToSquared(ship.position);
    if (d2 > R2) return false;
    segTmp.copy(e.vel).sub(player.vel); // velocidad relativa: pasada, no escolta
    if (segTmp.lengthSq() < 34 * 34) return false;
    flybyCool = 2.8 + Math.random() * 1.5;
    sfxFlyby(THREE.MathUtils.clamp(1.25 - Math.sqrt(d2) / 52, 0.45, 1));
    return true;
  };
  for (const f of fighters) if (f.alive && near(f)) return;
  for (const s of swarm) if (s.alive && near(s)) return;
}

// alarma al romperse el escudo del jugador
function sfxShieldDown() {
  if (sfxMuted || !audio || !audio.shieldBuf) return;
  const { ctx, master } = audio;
  const src = ctx.createBufferSource();
  src.buffer = audio.shieldBuf;
  const g = ctx.createGain();
  g.gain.value = 0.85;
  src.connect(g).connect(master);
  src.start();
}
function gainFor(pos, range) {
  const d = pos.distanceTo(ship.position);
  return d >= range ? 0 : 1 - d / range;
}
function sfxLaser(vol) {
  if (sfxMuted || !audio || vol <= 0) return;
  if (audio.laserBudget < 1) return;
  audio.laserBudget -= 1;
  const { ctx, master, noiseBuf } = audio;
  const t = ctx.currentTime;
  // sample del usuario para TODOS los bandos (el volumen ya trae la distancia);
  // la cola de eco de 4.4 s se recorta a ~1.4 s — a cadencia de combate, cuarenta
  // colas superpuestas serían una muralla de eco
  if (audio.laserBuf) {
    const src = ctx.createBufferSource();
    src.buffer = audio.laserBuf;
    src.playbackRate.value = 0.95 + Math.random() * 0.12; // cada disparo, su matiz
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * vol, t);
    g.gain.setValueAtTime(0.9 * vol, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    src.connect(g).connect(master);
    src.start(t);
    src.stop(t + 1.45);
    return;
  }
  // respaldo sintetizado: "PYEW" tipo blaster de space-opera
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(2300 + Math.random() * 300, t);
  o.frequency.exponentialRampToValueAtTime(170, t + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.2 * vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.2);
  const o2 = ctx.createOscillator();
  o2.type = 'square';
  o2.frequency.setValueAtTime(3400, t);
  o2.frequency.exponentialRampToValueAtTime(240, t + 0.12);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.06 * vol, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  o2.connect(g2).connect(master);
  o2.start(t);
  o2.stop(t + 0.14);
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  const nf = ctx.createBiquadFilter();
  nf.type = 'highpass';
  nf.frequency.value = 2000;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.12 * vol, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  n.connect(nf).connect(ng).connect(master);
  n.start(t);
  n.stop(t + 0.04);
}

/* ---------------- música de fondo: space-opera generativa ORIGINAL ----------------
   Drone grave, pads en progresión menor épica (i–VI–III–VII) y tambores de
   guerra, compuestos en tiempo real por el motor — ni un byte de audio externo. */
const MUSIC_CHORDS = [
  { root: 73.42, notes: [146.83, 174.61, 220.0] },   // Dm
  { root: 58.27, notes: [116.54, 146.83, 174.61] },  // Sib
  { root: 87.31, notes: [174.61, 220.0, 261.63] },   // Fa
  { root: 65.41, notes: [130.81, 164.81, 196.0] },   // Do
];
function startMusic() {
  if (!audio || audio.music) return;
  const { ctx, master } = audio;
  const gain = ctx.createGain();
  gain.gain.value = 0.14; // colchón: siempre por debajo de los efectos
  gain.connect(master);
  const droneF = ctx.createBiquadFilter();
  droneF.type = 'lowpass';
  droneF.frequency.value = 260;
  const droneG = ctx.createGain();
  droneG.gain.value = 0.16;
  droneF.connect(droneG).connect(gain);
  const drones = [1, 1.007].map((det) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = MUSIC_CHORDS[0].root * det;
    o.connect(droneF);
    o.start();
    return o;
  });
  audio.music = { gain, drones, nextBar: ctx.currentTime + 0.15, bar: 0 };
}
function musicDrum(t, vol) {
  const { ctx, noiseBuf, music } = audio;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(88, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.35);
  const og = ctx.createGain();
  og.gain.setValueAtTime(vol, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  o.connect(og).connect(music.gain);
  o.start(t);
  o.stop(t + 0.45);
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  const nf = ctx.createBiquadFilter();
  nf.type = 'lowpass';
  nf.frequency.value = 320;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vol * 0.5, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  n.connect(nf).connect(ng).connect(music.gain);
  n.start(t);
  n.stop(t + 0.15);
}
function scheduleMusicBar(t, bar) {
  const { ctx, music } = audio;
  const chord = MUSIC_CHORDS[(bar >> 1) % MUSIC_CHORDS.length];
  if (bar % 2 === 0) {
    // el drone se desliza al nuevo acorde; el pad respira encima (5 s, 2 compases)
    for (const [i, o] of music.drones.entries()) {
      o.frequency.exponentialRampToValueAtTime(chord.root * (i ? 1.007 : 1), t + 0.6);
    }
    for (const f of chord.notes) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = 900;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.05, t + 1.4);
      og.gain.setValueAtTime(0.05, t + 3.6);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 5.0);
      o.connect(fl).connect(og).connect(music.gain);
      o.start(t);
      o.stop(t + 5.1);
    }
  }
  musicDrum(t, 0.5);                 // BOOM al 1
  musicDrum(t + 1.875, 0.2);         // eco al 3.5
  if (bar % 4 === 3) {               // destello agudo espacial, muy de vez en cuando
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = [587.33, 659.25, 880][bar % 3];
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.035, t + 1.25);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(og).connect(music.gain);
    o.start(t + 1.25);
    o.stop(t + 2.7);
  }
}
function sfxExplosion(size, vol) {
  if (sfxMuted || !audio || vol <= 0) return;
  const { ctx, master, noiseBuf } = audio;
  const t = ctx.currentTime;
  // sample del usuario para naves destruidas: cuanto mayor la nave, más grave.
  // En capitales (size >= 2.5) suena POR DEBAJO del boom sintetizado con subgrave.
  if (audio.explodeBuf) {
    const src = ctx.createBufferSource();
    src.buffer = audio.explodeBuf;
    src.playbackRate.value = (0.92 + Math.random() * 0.16) / Math.sqrt(Math.min(size, 2.2));
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.95, 0.55 * size) * vol, t);
    g.gain.setValueAtTime(Math.min(0.95, 0.55 * size) * vol, t + 1.9);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    src.connect(g).connect(master);
    src.start(t);
    src.stop(t + 2.45);
    if (size < 2.5) return; // capital: sigue al boom sintetizado de abajo
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(900 * size, t);
  f.frequency.exponentialRampToValueAtTime(60, t + 0.4 + 0.25 * size);
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.min(0.85, 0.4 * size) * vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45 + 0.3 * size);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.5 + 0.3 * size);
  if (size >= 2.5) { // subgrave para capitales
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(55, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 1.4);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 1.7);
  }
}
function sfxMissile() {
  if (sfxMuted || !audio) return;
  const { ctx, master, noiseBuf } = audio;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 2.5;
  f.frequency.setValueAtTime(280, t);
  f.frequency.exponentialRampToValueAtTime(1500, t + 0.45);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.6);
}
function sfxLock() {
  if (sfxMuted || !audio) return;
  const { ctx, master } = audio;
  for (let i = 0; i < 2; i++) {
    const t = ctx.currentTime + i * 0.09;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 1320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.08);
  }
}
function sfxHit() {
  if (sfxMuted || !audio) return;
  const { ctx, master } = audio;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(190, t);
  o.frequency.exponentialRampToValueAtTime(60, t + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.2);
}

/* ============================== escuadrones ============================== */
// plantillas por facción: un solo build + tint, y clones baratos que comparten materiales
const allyTemplate = liftShipVisibility(buildPlayerFighter(), 'ally');
const enemyTemplate = liftShipVisibility(tintFaction(buildPlayerFighter(), 'enemy'), 'enemy');
liftShipVisibility(ship, 'ally'); // tu nave también luce sus luces de posición

const fighters = [];
const ALLY_TOTAL = 7, ENEMY_TOTAL = 8;

function spawnFighter(faction, i, total) {
  const obj = (faction === 'ally' ? allyTemplate : enemyTemplate).clone();
  const home = faction === 'ally' ? alliedCapital.position : enemyCapital.position;
  const spread = (i / total - 0.5) * 900;
  obj.position.set(
    home.x + spread + (Math.random() - 0.5) * 200,
    home.y + 150 + (Math.random() - 0.5) * 240,
    home.z + (faction === 'ally' ? 350 : -350) + (Math.random() - 0.5) * 200,
  );
  scene.add(obj);
  fighters.push({
    obj, faction, vel: new THREE.Vector3(), hp: 3, alive: true,
    target: null, retarget: 0, nextShot: 2 + Math.random() * 2.5,
    orbitDir: Math.random() > 0.5 ? 1 : -1,
  });
}
for (let i = 0; i < ALLY_TOTAL; i++) spawnFighter('ally', i, ALLY_TOTAL);
for (let i = 0; i < ENEMY_TOTAL; i++) spawnFighter('enemy', i, ENEMY_TOTAL);

// el jugador cuenta como objetivo del bando aliado para la IA enemiga
const playerEntity = {
  obj: ship, faction: 'ally', isPlayer: true,
  get alive() { return !player.dead; },
  get vel() { return player.vel; }, // para el adelanto de tiro de las torretas
};

/* ---------------- ENJAMBRES: la guerra de fondo, a lo grande ----------------
   Docenas de cazas librando dogfights ambientales. Usan el MISMO caza del kit
   pero aligerado (fuera los detalles pequeños) para sostener el framerate. */
const SWARM_PER_SIDE = 92; // 100 por bando contando al jugador, héroes y élite
const SWARM_DETAIL_CUT = /PanelLine|Vent|Conduit|Thruster|NavLight|Collar|HUD|AccentStrip|_Ring_|LeadingEdge|Hardpoint|CoreHalo|Fin_|SensorPod|TipPylon|Breech|Frame|Intake/;

function makeSwarmTemplate(faction) {
  const base = (faction === 'ally' ? allyTemplate : enemyTemplate).clone();
  const toRemove = [];
  base.traverse((o) => { if (o.isMesh && SWARM_DETAIL_CUT.test(o.name)) toRemove.push(o); });
  for (const o of toRemove) o.parent.remove(o);
  return base;
}

/* Fusión + instancing: las 184 naves del enjambre se dibujan en 4 draw calls.
   El caza del kit se hornea en 2 geometrías (casco con color por vértice, y
   partes emisivas) y cada bando es un par de InstancedMesh. */
function bakeSwarmGeometry(template) {
  template.updateMatrixWorld(true);
  const hullGeos = [], glowGeos = [];
  template.traverse((o) => {
    if (!o.isMesh) return;
    let geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (geo.index) geo = geo.toNonIndexed();
    geo.deleteAttribute('uv');
    if (geo.getAttribute('uv1')) geo.deleteAttribute('uv1');
    const mat = o.material;
    const isGlow = (mat.emissiveIntensity || 0) > 0.5 && mat.emissive;
    const c = isGlow
      ? mat.emissive.clone().multiplyScalar(Math.min(2.4, mat.emissiveIntensity * 0.85))
      : (mat.color ? mat.color.clone().multiplyScalar(1.15) : new THREE.Color(0.8, 0.8, 0.8));
    const n = geo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    (isGlow ? glowGeos : hullGeos).push(geo);
  });
  return {
    hull: mergeGeometries(hullGeos),
    glow: glowGeos.length ? mergeGeometries(glowGeos) : null,
  };
}
function makeSwarmBatch(faction) {
  const baked = bakeSwarmGeometry(makeSwarmTemplate(faction));
  const hull = new THREE.InstancedMesh(baked.hull, new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.25, roughness: 0.55, envMapIntensity: 1.0,
    // rescoldo por bando: el enjambre se lee contra el vacío igual que los héroes
    emissive: faction === 'ally' ? 0x16303c : 0x3c1a14, emissiveIntensity: 0.5,
  }), SWARM_PER_SIDE);
  hull.frustumCulled = false; // las instancias cubren toda la batalla: sin culling por lote
  scene.add(hull);
  let glow = null;
  if (baked.glow) {
    glow = new THREE.InstancedMesh(baked.glow, new THREE.MeshBasicMaterial({ vertexColors: true }), SWARM_PER_SIDE);
    glow.frustumCulled = false;
    scene.add(glow);
  }
  return { hull, glow };
}
const swarmBatches = { ally: makeSwarmBatch('ally'), enemy: makeSwarmBatch('enemy') };

const swarm = [];
function resetSwarmShip(s, immediate) {
  const home = s.faction === 'ally' ? alliedCapital.position : enemyCapital.position;
  s.obj.position.set(
    home.x + (Math.random() - 0.5) * 1600,
    home.y + 100 + (Math.random() - 0.5) * 800,
    home.z + (s.faction === 'ally' ? 1 : -1) * (immediate ? 700 + Math.random() * 2200 : 300),
  );
  s.vel.set(0, 0, 0);
  s.hp = 6;
  s.alive = true;
  s.target = null;
  s.retarget = Math.random() * 2;
  s.nextShot = 2 + Math.random() * 3;
}
for (const faction of ['ally', 'enemy']) {
  for (let i = 0; i < SWARM_PER_SIDE; i++) {
    const s = {
      obj: new THREE.Object3D(), faction, slot: i,
      vel: new THREE.Vector3(), hp: 3, alive: true, target: null,
      retarget: 0, nextShot: 0, orbitDir: Math.random() > 0.5 ? 1 : -1,
    };
    resetSwarmShip(s, true);
    swarm.push(s);
  }
}
// flotas FINITAS: 100 naves por bando y ni una más — cada baja acerca el final
function killSwarmShip(s, byPlayer) {
  s.alive = false;
  flash(s.obj.position, true, 22, 0.55);
  sfxExplosion(1.2, gainFor(s.obj.position, 1400));
  if (s.faction === 'enemy') {
    if (byPlayer) message('SWARM FIGHTER DOWN');
    registerEnemyKill();
  }
}

const instMatrix = new THREE.Matrix4();
const oneScale = new THREE.Vector3(1, 1, 1), zeroScale = new THREE.Vector3(0, 0, 0);
function updateSwarmInstances() {
  for (const s of swarm) {
    const batch = swarmBatches[s.faction];
    instMatrix.compose(s.obj.position, s.obj.quaternion, s.alive ? oneScale : zeroScale);
    batch.hull.setMatrixAt(s.slot, instMatrix);
    if (batch.glow) batch.glow.setMatrixAt(s.slot, instMatrix);
  }
  for (const b of [swarmBatches.ally, swarmBatches.enemy]) {
    b.hull.instanceMatrix.needsUpdate = true;
    if (b.glow) b.glow.instanceMatrix.needsUpdate = true;
  }
}

function pickTarget(f) {
  let best = null, bestD = Infinity;
  const candidates = fighters.filter((o) => o.alive && o.faction !== f.faction);
  if (f.faction === 'enemy' && !player.dead) candidates.push(playerEntity);
  for (const c of candidates) {
    const d = f.obj.position.distanceToSquared(c.obj.position);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/* -------------------- bajas de cazas (láser y misil comparten) -------------------- */
function damageFighter(f, dmg, atPos) {
  f.hp -= dmg;
  flash(atPos, false, 5, 0.15);
  if (f.hp > 0 || !f.alive) return;
  f.alive = false;
  flash(f.obj.position, true, 26, 0.6);
  sfxExplosion(1.5, gainFor(f.obj.position, 1500));
  scene.remove(f.obj);
  if (f.faction === 'enemy') {
    message('ENEMY INTERCEPTOR DOWN');
    registerEnemyKill();
  } else {
    message('ALLIED FIGHTER LOST');
  }
}

// la misión: aniquilar la flota enemiga COMPLETA (élite + enjambre = 100 naves)
const TOTAL_ENEMY_SHIPS = ENEMY_TOTAL + SWARM_PER_SIDE;
function registerEnemyKill() {
  kills++;
  hud.kills.textContent = kills;
  if (kills >= TOTAL_ENEMY_SHIPS) endGame(true);
}

/* -------------------- OLEADAS: la guerra no termina, se recrudece --------------------
   Tras cada victoria puedes pedir la siguiente oleada: ambas flotas se rehacen,
   te reabastecen (casco, escudo, misiles) y la puntería enemiga afina. Los pecios
   de capital se quedan muertos: perder tu capital pasa factura para siempre. */
let wave = 1, enemySpread = 0.14;
function reviveFighter(f) {
  const home = f.faction === 'ally' ? alliedCapital.position : enemyCapital.position;
  f.obj.position.set(
    home.x + (Math.random() - 0.5) * 900,
    home.y + 150 + (Math.random() - 0.5) * 240,
    home.z + (f.faction === 'ally' ? 350 : -350) + (Math.random() - 0.5) * 200,
  );
  f.vel.set(0, 0, 0);
  f.hp = 3;
  f.alive = true;
  f.target = null;
  f.retarget = Math.random() * 2;
  f.nextShot = 2 + Math.random() * 2.5;
  scene.add(f.obj);
}
function clearProjectiles() {
  // los proyectiles de la oleada anterior no cruzan a la siguiente: un misil
  // zombi re-fijaría al MISMO objeto de caza recién revivido (kill gratis)
  for (const ms of missiles) scene.remove(ms.mesh);
  missiles.length = 0;
  for (const b of bolts) scene.remove(b.mesh);
  bolts.length = 0;
  for (const l of lasers) { l.mesh.visible = false; laserPool.push(l.mesh); }
  lasers.length = 0;
}
function startNextWave() {
  wave++;
  enemySpread = Math.max(0.07, 0.14 - 0.02 * (wave - 1));
  el('waveNum').textContent = wave;
  kills = 0;
  hud.kills.textContent = 0;
  clearProjectiles();
  for (const f of fighters) if (!f.alive) reviveFighter(f);
  for (const s of swarm) if (!s.alive) resetSwarmShip(s, true);
  player.shield = 100;
  player.hull = 100;
  player.dead = false;
  missileAmmo = 8;
  if (hud.missiles) hud.missiles.textContent = missileAmmo;
  el('end').classList.add('hidden');
  lockPointer();
  sfxLock();
  message(`WAVE ${wave} — ENEMY REINFORCEMENTS INBOUND`);
}

/* -------------------- misiles guiados (click derecho) -------------------- */
const missiles = [];
let missileAmmo = 8, missileCooldown = 0;
const missileGeo = new THREE.BoxGeometry(0.3, 0.3, 2.2);
const missileMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
const missileFlameTex = radialGlow([1.0, 0.75, 0.4], 0.32);

function launchMissile() {
  if (!started || player.dead || missileAmmo <= 0 || missileCooldown > 0) return;
  missileCooldown = 1.1;
  missileAmmo--;
  if (hud.missiles) hud.missiles.textContent = missileAmmo;

  // fijación: enemigo vivo más alineado con la mira (cono ~25°, hasta 700 m)
  fwd.set(0, 0, 1).applyQuaternion(ship.quaternion);
  let target = null, bestDot = Math.cos(THREE.MathUtils.degToRad(25));
  for (const f of fighters) {
    if (!f.alive || f.faction !== 'enemy') continue;
    tmp.copy(f.obj.position).sub(ship.position);
    const dist = tmp.length();
    if (dist > 700) continue;
    const dot = tmp.normalize().dot(fwd);
    if (dot > bestDot) { bestDot = dot; target = f; }
  }
  // sin caza a tiro: fijación sobre la capital enemiga si la tienes de frente
  if (!target && capitals.enemy.alive) {
    tmp.copy(capitals.enemy.group.position).sub(ship.position);
    if (tmp.length() < 3000 && tmp.normalize().dot(fwd) > Math.cos(THREE.MathUtils.degToRad(20))) {
      const cap = capitals.enemy;
      target = { obj: cap.group, isCapital: true, get alive() { return cap.alive; } };
    }
  }

  const m = new THREE.Mesh(missileGeo, missileMat);
  m.position.copy(ship.position).addScaledVector(fwd, 8).add(tmp.set(0, -1.2, 0).applyQuaternion(ship.quaternion));
  m.quaternion.copy(ship.quaternion);
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({
    map: missileFlameTex, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flame.scale.setScalar(2.2);
  flame.position.z = -1.4;
  m.add(flame);
  scene.add(m);
  missiles.push({
    mesh: m, target,
    vel: fwd.clone().multiplyScalar(Math.max(90, player.vel.length() + 50)),
    life: 9,
  });
  message(target ? 'MISSILE: TARGET LOCKED' : 'MISSILE: NO LOCK');
  sfxMissile();
  if (target) sfxLock();
}

/* -------------------- cañones de las capitales -------------------- */
const bolts = [];
const boltGeo = new THREE.BoxGeometry(0.8, 0.8, 14);   // andanada pesada anticapital
const flakGeo = new THREE.BoxGeometry(0.45, 0.45, 6);  // flak antifighter
const boltAllyMat = new THREE.MeshBasicMaterial({ color: 0x9ff0ff });
const boltEnemyMat = new THREE.MeshBasicMaterial({ color: 0xff8a5c });
const zAxis = new THREE.Vector3(0, 0, 1);
const tv1 = new THREE.Vector3(), tv2 = new THREE.Vector3(), tv3 = new THREE.Vector3();
let nextBoltAlly = 1, nextBoltEnemy = 1.7;

// andanada pesada: sale de una torreta real, apunta a una esfera del casco rival
function capitalVolley(fromCap, toCap) {
  const capCols = colliders.filter((c) => c.cap === toCap);
  if (!capCols.length) return;
  const tr = fromCap.turrets[(Math.random() * fromCap.turrets.length) | 0];
  tr.mark.getWorldPosition(tv1);
  const aim = capCols[(Math.random() * capCols.length) | 0];
  tv2.copy(aim.pos)
    .add(tv3.set((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 300))
    .sub(tv1).normalize();
  const m = new THREE.Mesh(boltGeo, fromCap.faction === 'ally' ? boltAllyMat : boltEnemyMat);
  m.position.copy(tv1);
  m.quaternion.setFromUnitVectors(zAxis, tv2);
  scene.add(m);
  bolts.push({ mesh: m, vel: tv2.clone().multiplyScalar(240), life: 30, faction: fromCap.faction, kind: 'heavy', targetCap: toCap });
}

// flak: cada torreta busca el caza rival más cercano y tira con adelanto + dispersión
function turretTick(cap, dt) {
  if (!cap.alive) return;
  for (const tr of cap.turrets) {
    tr.flakCool -= dt;
    if (tr.flakCool > 0) continue;
    tr.mark.getWorldPosition(tv1);
    let best = null, bestD = 1500 * 1500;
    for (const f of fighters) {
      if (!f.alive || f.faction === cap.faction) continue;
      const d = tv1.distanceToSquared(f.obj.position);
      if (d < bestD) { bestD = d; best = f; }
    }
    for (const s of swarm) {
      if (!s.alive || s.faction === cap.faction) continue;
      const d = tv1.distanceToSquared(s.obj.position);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (cap.faction === 'enemy' && !player.dead) {
      const d = tv1.distanceToSquared(ship.position);
      if (d < bestD) { bestD = d; best = playerEntity; }
    }
    if (!best) { tr.flakCool = 0.5; continue; }
    const dist = Math.sqrt(bestD);
    const speed = 260;
    tv2.copy(best.obj.position).addScaledVector(best.vel, dist / speed).sub(tv1);
    tv2.x += (Math.random() - 0.5) * dist * 0.06;
    tv2.y += (Math.random() - 0.5) * dist * 0.06;
    tv2.z += (Math.random() - 0.5) * dist * 0.06;
    tv2.normalize();
    const m = new THREE.Mesh(flakGeo, cap.faction === 'ally' ? boltAllyMat : boltEnemyMat);
    m.position.copy(tv1);
    m.quaternion.setFromUnitVectors(zAxis, tv2);
    scene.add(m);
    bolts.push({ mesh: m, vel: tv2.clone().multiplyScalar(speed), life: 7, faction: cap.faction, kind: 'flak' });
    tr.flakCool = (3 + Math.random() * 2.5) * (cap.faction === 'enemy' ? Math.pow(0.92, wave - 1) : 1);
  }
}

/* ---------------- vida y muerte de una capital ---------------- */
const debris = [];
function damageCapital(cap, dmg, pos) {
  if (!cap.alive) return;
  cap.hp -= dmg;
  if (cap.bar) cap.bar.style.width = `${Math.max(0, (cap.hp / cap.maxHp) * 100)}%`;
  if (pos) flash(pos, true, 8, 0.2);
  if (cap.hp <= 0) {
    cap.alive = false;      // deja de disparar y de ser objetivo desde YA
    cap.dying = 4.2;        // …pero arde unos segundos antes de partirse
    cap.burnT = 0;
    message(cap.faction === 'enemy' ? 'ENEMY CAPITAL GOING DOWN' : 'ALLIED CAPITAL GOING DOWN');
  }
}

// el final: las piezas reales del casco salen despedidas girando y se apagan
function breakApartCapital(cap) {
  cap.dying = 0;
  cap.group.updateMatrixWorld(true);
  const center = cap.group.getWorldPosition(new THREE.Vector3());
  const meshes = [];
  cap.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const sized = meshes.map((m) => {
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    return { m, size: m.geometry.boundingSphere.radius * m.getWorldScale(tv1).length() };
  }).sort((a, b) => b.size - a.size).slice(0, 70); // las 70 piezas mayores vuelan; el resto se vaporiza
  for (const { m } of sized) {
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material])) mat.transparent = true;
    scene.attach(m);
    tv1.copy(m.position).sub(center);
    if (tv1.lengthSq() < 1) tv1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    tv1.normalize();
    debris.push({
      mesh: m,
      vel: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10)
        .addScaledVector(tv1, 7 + Math.random() * 15),
      spin: new THREE.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7),
      life: 0,
    });
  }
  world.remove(cap.group);
  for (let i = colliders.length - 1; i >= 0; i--) if (colliders[i].cap === cap) colliders.splice(i, 1);
  flash(center, true, 340, 1.5);
  sfxExplosion(4, Math.max(0.35, gainFor(center, 6000)));
  message(cap.faction === 'enemy' ? 'ENEMY CAPITAL DESTROYED' : 'ALLIED CAPITAL LOST');
}

/* ============================== polvo ============================== */
const dustGeo = new THREE.BufferGeometry();
const dustN = 360;
const dustArr = new Float32Array(dustN * 3);
for (let i = 0; i < dustN; i++) {
  dustArr[i * 3] = (Math.random() - 0.5) * 320;
  dustArr[i * 3 + 1] = (Math.random() - 0.5) * 320;
  dustArr[i * 3 + 2] = (Math.random() - 0.5) * 320;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustArr, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  color: 0x9fb8d8, size: 0.5, transparent: true, opacity: 0.5, sizeAttenuation: true,
}));
scene.add(dust);

/* ============================== HUD ============================== */
const el = (id) => document.getElementById(id);
const hud = {
  speed: el('speed'), boost: el('boost'), kills: el('killCount'),
  shield: el('shieldBar').firstElementChild, hull: el('hullBar').firstElementChild,
  msg: el('msg'), allies: el('allyCount'), missiles: el('missileCount'),
};
el('killTotal').textContent = TOTAL_ENEMY_SHIPS;
capitals.ally.bar = el('allyCapBar').firstElementChild;
capitals.enemy.bar = el('enemyCapBar').firstElementChild;
let kills = 0, msgTimer = 0;
function message(t) { hud.msg.textContent = t; hud.msg.style.opacity = 1; msgTimer = 2.6; }
// gancho de depuración (consola): estado de la batalla y daño directo a capitales
window.__sb = { capitals, damageCapital, fighters, swarm, ship, touchStick, get kills() { return kills; }, get t() { return clockTime; }, get audio() { return audio; }, get flybyCool() { return flybyCool; } };

/* -------------------- radar 3D (estilo Elite) --------------------
   Proyección al espacio local de la nave: X lateral, Z adelante (arriba del
   radar); la altura relativa se dibuja como un palito vertical desde el punto. */
const radarC = el('radar'), rctx = radarC.getContext('2d');
const arrowEl = el('enemyArrow');
const RADAR_RANGE = 2200;
const invQ = new THREE.Quaternion();
function radarPlot(pos, color, big) {
  tmp.copy(pos).sub(ship.position);
  if (tmp.lengthSq() > RADAR_RANGE * RADAR_RANGE) return;
  tmp.applyQuaternion(invQ);
  const px = 110 + (tmp.x / RADAR_RANGE) * 96;
  const py = 110 - (tmp.z / RADAR_RANGE) * 96;
  const dy = -(tmp.y / RADAR_RANGE) * 96;
  rctx.strokeStyle = color;
  rctx.fillStyle = color;
  if (Math.abs(dy) > 2.5) {
    rctx.beginPath();
    rctx.moveTo(px, py);
    rctx.lineTo(px, py + dy);
    rctx.stroke();
  }
  const r = big ? 3.4 : 1.8;
  rctx.fillRect(px - r, py + dy - r, r * 2, r * 2);
}
function drawRadar() {
  rctx.clearRect(0, 0, 220, 220);
  rctx.fillStyle = 'rgba(3,10,16,0.62)'; // disco de fondo: legible sobre cualquier casco
  rctx.beginPath(); rctx.arc(110, 110, 104, 0, Math.PI * 2); rctx.fill();
  rctx.lineWidth = 1;
  rctx.strokeStyle = 'rgba(127,231,255,0.22)';
  rctx.beginPath(); rctx.arc(110, 110, 96, 0, Math.PI * 2); rctx.stroke();
  rctx.beginPath(); rctx.arc(110, 110, 48, 0, Math.PI * 2); rctx.stroke();
  rctx.beginPath();
  rctx.moveTo(14, 110); rctx.lineTo(206, 110);
  rctx.moveTo(110, 14); rctx.lineTo(110, 206);
  rctx.stroke();
  invQ.copy(ship.quaternion).invert();
  for (const s of swarm) {
    if (s.alive) radarPlot(s.obj.position, s.faction === 'ally' ? 'rgba(95,216,255,0.75)' : 'rgba(255,95,60,0.9)', false);
  }
  for (const f of fighters) {
    if (f.alive) radarPlot(f.obj.position, f.faction === 'ally' ? '#8fe8ff' : '#ff7a4c', false);
  }
  for (const cap of [capitals.ally, capitals.enemy]) {
    if (cap.alive) radarPlot(cap.group.position, cap.faction === 'ally' ? '#9ff0ff' : '#ffb04c', true);
  }
  rctx.fillStyle = '#ffffff';
  rctx.fillRect(108.4, 108.4, 3.2, 3.2); // tú
}

/* -------- marcadores de enemigos: brackets rojos sobre cada nave hostil --------
   Identificación instantánea amigo/enemigo: solo los hostiles llevan marco. */
const markC = el('markers'), mctx = markC.getContext('2d');
function sizeMarkers() { markC.width = innerWidth; markC.height = innerHeight; }
sizeMarkers();
function drawMarkers() {
  mctx.clearRect(0, 0, markC.width, markC.height);
  if (!started || player.dead) return;
  mctx.lineWidth = 1.5;
  const mark = (pos, big) => {
    const d = pos.distanceTo(ship.position);
    // cerca gritan, lejos susurran: 92 hostiles con brackets a tope = muro de ruido
    if (!big && (d > 2400 || d < 22)) return;
    tmp.copy(pos).project(camera);
    if (tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05) return;
    const sx = (tmp.x + 1) / 2 * markC.width;
    const sy = (1 - tmp.y) / 2 * markC.height;
    const s = big ? 34 : THREE.MathUtils.clamp(6500 / d, 4, 26);
    const alpha = big ? 0.8 : THREE.MathUtils.clamp(1.1 - d / 2400, 0.12, 0.85);
    mctx.strokeStyle = `rgba(255,90,60,${alpha})`;
    const c = s * 0.4;
    mctx.beginPath();
    mctx.moveTo(sx - s, sy - s + c); mctx.lineTo(sx - s, sy - s); mctx.lineTo(sx - s + c, sy - s);
    mctx.moveTo(sx + s - c, sy - s); mctx.lineTo(sx + s, sy - s); mctx.lineTo(sx + s, sy - s + c);
    mctx.moveTo(sx + s, sy + s - c); mctx.lineTo(sx + s, sy + s); mctx.lineTo(sx + s - c, sy + s);
    mctx.moveTo(sx - s + c, sy + s); mctx.lineTo(sx - s, sy + s); mctx.lineTo(sx - s, sy + s - c);
    mctx.stroke();
    if (big) {
      mctx.fillStyle = `rgba(255,140,100,${alpha})`;
      mctx.font = '10px monospace';
      mctx.textAlign = 'center';
      mctx.fillText('CAPITAL', sx, sy - s - 6);
    }
  };
  for (const f of fighters) if (f.alive && f.faction === 'enemy') mark(f.obj.position, false);
  for (const s of swarm) if (s.alive && s.faction === 'enemy') mark(s.obj.position, false);
  if (capitals.enemy.alive) mark(capitals.enemy.group.position, true);
}

/* flecha en pantalla hacia el enemigo más cercano (para cazar a los últimos) */
function updateEnemyArrow() {
  if (!started || player.dead) { arrowEl.style.opacity = 0; return; }
  let best = null, bestD = Infinity;
  for (const f of fighters) {
    if (!f.alive || f.faction !== 'enemy') continue;
    const d = ship.position.distanceToSquared(f.obj.position);
    if (d < bestD) { bestD = d; best = f; }
  }
  for (const s of swarm) {
    if (!s.alive || s.faction !== 'enemy') continue;
    const d = ship.position.distanceToSquared(s.obj.position);
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best) { arrowEl.style.opacity = 0; return; }
  tmp.copy(best.obj.position).project(camera);
  const behind = tmp.z > 1;
  if (!behind && Math.abs(tmp.x) < 0.88 && Math.abs(tmp.y) < 0.82) {
    arrowEl.style.opacity = 0; // el objetivo ya está a la vista
    return;
  }
  let ax = tmp.x, ay = tmp.y;
  if (behind) { ax = -ax; ay = -ay; }
  const ang = Math.atan2(ay, ax);
  const R = 92;
  arrowEl.style.opacity = 0.9;
  arrowEl.style.transform =
    `translate(${Math.cos(ang) * R - 10}px, ${-Math.sin(ang) * R - 13}px) rotate(${90 - ang * 180 / Math.PI}deg)`;
}

function damagePlayer(amount) {
  if (player.dead || !started) return;
  const hadShield = player.shield > 0;
  if (player.shield > 0) player.shield = Math.max(0, player.shield - amount);
  else player.hull = Math.max(0, player.hull - amount * 0.8);
  if (hadShield && player.shield <= 0) { // el golpe que lo rompe (también tras regenerar)
    sfxShieldDown();
    message('SHIELD DOWN');
  }
  sfxHit();
  if (player.hull <= 0) endGame(false);
}
function endGame(victory) {
  if (player.dead) return;
  player.dead = true;
  document.exitPointerLock();
  document.getElementById('start').classList.add('hidden');
  el('endTitle').textContent = victory ? 'VICTORY' : 'SHIP LOST';
  el('endText').innerHTML = victory
    ? `Wave ${wave} cleared — all ${TOTAL_ENEMY_SHIPS} enemy ships destroyed.<br>`
      + (capitals.enemy.alive ? 'The enemy capital withdraws… for now.' : 'Their capital is drifting wreckage.')
    : 'Your hull gave out. Space is unforgiving.';
  el('nextWaveBtn').classList.toggle('hidden', !victory);
  el('end').classList.remove('hidden');
}

/* ============================== bucle ============================== */
const fwd = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();
const lookM = new THREE.Matrix4(), lookQ = new THREE.Quaternion();
const segPrev = new THREE.Vector3(), segStep = new THREE.Vector3(), segTmp = new THREE.Vector3();

/// ¿El segmento [p0, p0+step] pasa a menos de r del centro? (anti-túnel a bajo framerate)
function segmentHitsSphere(p0, step, center, r) {
  segTmp.copy(center).sub(p0);
  const len2 = step.lengthSq();
  const t = len2 > 0 ? THREE.MathUtils.clamp(segTmp.dot(step) / len2, 0, 1) : 0;
  segTmp.copy(step).multiplyScalar(t).add(p0).sub(center);
  return segTmp.lengthSq() < r * r;
}
let fireCooldown = 0, muzzleFlip = 0, shieldRegen = 0;
let clockTime = 0;
const clock = new THREE.Clock();

function update(dt) {
  clockTime += dt;
  const t = clockTime;
  refreshColliders();
  if (audio) {
    audio.laserBudget = Math.min(3, audio.laserBudget + dt * 9); // máx ~9 láseres audibles/s
    if (player.dead) audio.engineGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.3);
    // música: planificar compases con antelación (compás de 2.5 s, ~96 BPM)
    if (audio.music) {
      const m = audio.music;
      // si rAF se pausó sin visibilitychange (p.ej. panel embebido), saltar los
      // compases perdidos: planificar en el pasado = ráfaga de tambores de golpe
      if (m.nextBar < audio.ctx.currentTime) m.nextBar = audio.ctx.currentTime + 0.1;
      while (m.nextBar < audio.ctx.currentTime + 0.8) {
        scheduleMusicBar(m.nextBar, m.bar);
        m.bar++;
        m.nextBar += 2.5;
      }
    }
  }

  /* ---- vuelo del jugador ---- */
  if (!player.dead && started) {
    // móvil: auto-crucero siempre adelante; el stick vierte en el pipeline del ratón
    if (isTouch) {
      mouseDX += touchStick.x * 820 * dt;
      mouseDY += touchStick.y * 820 * dt;
    }
    const boosting = isTouch ? touchBoost : (keys.ShiftLeft && keys.KeyW);
    const accel = boosting ? TUNE.boostAccel : TUNE.accel;
    const maxV = boosting ? TUNE.boostSpeed : TUNE.maxSpeed;

    tmp.set(
      (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
      (keys.KeyR ? 1 : 0) - (keys.KeyF ? 1 : 0),
      isTouch ? 1 : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
    );
    const throttle = Math.max(0, tmp.z);
    tmp.set(tmp.x * TUNE.strafe, tmp.y * TUNE.vertical, tmp.z * accel).applyQuaternion(ship.quaternion);
    player.vel.addScaledVector(tmp, dt);
    player.vel.multiplyScalar(Math.exp(-TUNE.linDamp * dt));
    if (player.vel.length() > maxV) player.vel.setLength(THREE.MathUtils.lerp(player.vel.length(), maxV, 0.1));
    ship.position.addScaledVector(player.vel, dt);

    // estilo FPS en TODOS los mandos: ratón/pulgar ARRIBA = morro ARRIBA
    // (una sola inversión aquí, en el origen — antes era convención avión)
    player.angVel.x += mouseDY * 0.0022 * TUNE.mousePitch;
    player.angVel.y += -mouseDX * 0.0022 * TUNE.mouseYaw;
    mouseDX = mouseDY = 0;
    // alabeo: Q/E en teclado; en táctil, las DIAGONALES del stick escoran la nave
    // (x·|y| = cero en vertical u horizontal puros, máximo en las esquinas)
    const rollIn = ((keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0))
      + (isTouch ? -touchStick.x * Math.abs(touchStick.y) * 2.8 : 0);
    player.angVel.z += rollIn * TUNE.rollAccel * dt;
    player.angVel.multiplyScalar(Math.exp(-TUNE.angDamp * dt));
    ship.rotateX(player.angVel.x * dt);
    ship.rotateY(player.angVel.y * dt);
    ship.rotateZ(player.angVel.z * dt);

    const power = boosting ? 1.6 : throttle;
    for (const fx of engineFx) {
      fx.flame.scale.setScalar(0.6 + power * 3.4 + Math.sin(t * 31) * 0.18 * power);
      fx.flame.material.opacity = 0.25 + power * 0.6;
      fx.light.intensity = power * 9;
    }
    if (audio) { // el motor respira con el acelerador
      const tt = audio.ctx.currentTime;
      audio.engineGain.gain.setTargetAtTime(0.03 + power * 0.09, tt, 0.08);
      audio.engineFilter.frequency.setTargetAtTime(90 + player.vel.length() * 2.4 + (boosting ? 160 : 0), tt, 0.1);
    }

    fireCooldown -= dt;
    if ((firing || keys.Space) && fireCooldown <= 0) {
      fireCooldown = 1 / 7;
      const m = muzzles[muzzleFlip++ % muzzles.length];
      m.getWorldPosition(tmp);
      fwd.set(0, 0, 1).applyQuaternion(ship.quaternion);
      fireLaser(tmp, fwd.clone(), 350, 'ally', true);
    }

    for (const c of colliders) {
      const minDist = c.r + player.radius;
      if (ship.position.distanceToSquared(c.pos) < minDist * minDist) {
        const push = tmp.copy(ship.position).sub(c.pos).normalize();
        ship.position.copy(c.pos).addScaledVector(push, minDist + 0.5);
        const impact = Math.min(40, player.vel.length());
        player.vel.reflect(push).multiplyScalar(0.35);
        damagePlayer(impact * 0.8);
        flash(ship.position.clone().addScaledVector(push, -player.radius), true, 8, 0.3);
        message('HULL COLLISION!');
      }
    }

    shieldRegen += dt;
    if (shieldRegen > 4 && player.shield < 100) player.shield = Math.min(100, player.shield + dt * 8);
  }

  /* ---- escuadrones (dormidos hasta entrar en cabina) ---- */
  if (started) {
    for (const f of fighters) {
      if (!f.alive) continue;

      f.retarget -= dt;
      if (!f.target || !f.target.alive || f.retarget <= 0) {
        f.target = pickTarget(f);
        f.retarget = 3 + Math.random() * 2;
      }
      if (!f.target) continue;

      const toTarget = tmp.copy(f.target.obj.position).sub(f.obj.position);
      const dist = toTarget.length();
      toTarget.normalize();
      const desired = tmp2.copy(toTarget);
      if (dist < 110) {
        desired.crossVectors(toTarget, f.obj.up).multiplyScalar(f.orbitDir).addScaledVector(toTarget, 0.15);
      }
      // separación de compañeros (evita el churro de naves apiladas)
      for (const other of fighters) {
        if (other === f || !other.alive) continue;
        const d2 = f.obj.position.distanceToSquared(other.obj.position);
        if (d2 < 30 * 30) {
          desired.addScaledVector(tmp3.copy(f.obj.position).sub(other.obj.position).normalize(), 0.8);
        }
      }
      f.vel.addScaledVector(desired.normalize(), 26 * dt);
      f.vel.multiplyScalar(Math.exp(-0.5 * dt));
      if (f.vel.length() > 46) f.vel.setLength(46);
      f.obj.position.addScaledVector(f.vel, dt);
      lookM.lookAt(f.obj.position, f.target.obj.position, f.obj.up);
      f.obj.quaternion.slerp(lookQ.setFromRotationMatrix(lookM), 1 - Math.exp(-3 * dt));

      f.nextShot -= dt;
      if (f.nextShot <= 0 && dist < 320) {
        f.nextShot = 1.5 + Math.random() * 1.4;
        const dir = tmp.copy(f.target.obj.position).sub(f.obj.position).normalize();
        dir.x += (Math.random() - 0.5) * 0.05;
        dir.y += (Math.random() - 0.5) * 0.05;
        fireLaser(tmp2.copy(f.obj.position).addScaledVector(dir, 8), dir.normalize().clone(), 220, f.faction);
      }
    }

    /* ---- el ENJAMBRE: la guerra ambiental ---- */
    for (const s of swarm) {
      if (!s.alive) continue;
      s.retarget -= dt;
      if (!s.target || !s.target.alive || s.retarget <= 0) {
        let best = null, bestD = Infinity;
        for (const o of swarm) {
          if (!o.alive || o.faction === s.faction) continue;
          const d = s.obj.position.distanceToSquared(o.obj.position);
          if (d < bestD) { bestD = d; best = o; }
        }
        // sin enjambre rival: caza élites contrarios y al jugador — con flotas
        // finitas NADIE puede quedarse congelado sin objetivo (estancaría la misión)
        if (!best) {
          for (const o of fighters) {
            if (!o.alive || o.faction === s.faction) continue;
            const d = s.obj.position.distanceToSquared(o.obj.position);
            if (d < bestD) { bestD = d; best = o; }
          }
          if (s.faction === 'enemy' && !player.dead) {
            const d = s.obj.position.distanceToSquared(ship.position);
            if (d < bestD) { bestD = d; best = playerEntity; }
          }
        }
        s.target = best;
        s.retarget = 4 + Math.random() * 3;
      }
      if (!s.target) continue;

      const toT = tmp.copy(s.target.obj.position).sub(s.obj.position);
      const dist = toT.length();
      toT.normalize();
      const desired = tmp2.copy(toT);
      if (dist < 90) desired.crossVectors(toT, s.obj.up).multiplyScalar(s.orbitDir).addScaledVector(toT, 0.2);
      s.vel.addScaledVector(desired.normalize(), 24 * dt);
      s.vel.multiplyScalar(Math.exp(-0.5 * dt));
      if (s.vel.length() > 42) s.vel.setLength(42);
      s.obj.position.addScaledVector(s.vel, dt);
      lookM.lookAt(s.obj.position, s.target.obj.position, s.obj.up);
      s.obj.quaternion.slerp(lookQ.setFromRotationMatrix(lookM), 1 - Math.exp(-2.5 * dt));

      s.nextShot -= dt;
      if (s.nextShot <= 0 && dist < 260) {
        s.nextShot = 5 + Math.random() * 4; // 184 tiradores con impacto REAL: cadencia contenida
        const spr = s.faction === 'enemy' ? enemySpread : 0.14; // cada oleada afina la puntería enemiga
        const dir = tmp.copy(s.target.obj.position).sub(s.obj.position).normalize();
        dir.x += (Math.random() - 0.5) * spr;
        dir.y += (Math.random() - 0.5) * spr;
        fireLaser(tmp2.copy(s.obj.position).addScaledVector(dir, 8), dir.normalize().clone(), 220, s.faction);
        // pincelada teatral residual: alguna ráfaga lejana conecta fuera de cámara
        if (Math.random() < 0.02) {
          s.target.hp--;
          if (s.target.hp <= 0) killSwarmShip(s.target, false);
          else flash(s.target.obj.position, false, 5, 0.15);
        }
      }
    }

    checkFlybys(dt);

    /* cañones: flak antifighter + andanadas capital contra capital */
    turretTick(capitals.ally, dt);
    turretTick(capitals.enemy, dt);
    nextBoltAlly -= dt; nextBoltEnemy -= dt;
    if (capitals.ally.alive && capitals.enemy.alive) {
      // artillería aliada superior: el duelo de capitales suele ganarlo tu bando
      if (nextBoltAlly <= 0) { nextBoltAlly = 1.1 + Math.random() * 0.6; capitalVolley(capitals.ally, capitals.enemy); }
      if (nextBoltEnemy <= 0) { nextBoltEnemy = 1.5 + Math.random(); capitalVolley(capitals.enemy, capitals.ally); }
    }
  }

  /* ---- capitales tocadas: incendio en cadena y despedazamiento ---- */
  for (const cap of [capitals.ally, capitals.enemy]) {
    if (cap.dying <= 0) continue;
    cap.dying -= dt;
    cap.burnT -= dt;
    if (cap.burnT <= 0) {
      cap.burnT = 0.12; // explosiones recorriendo el casco
      tv1.set((Math.random() - 0.5) * 240, (Math.random() - 0.5) * 150, (Math.random() - 0.5) * 2100);
      cap.group.localToWorld(tv1);
      flash(tv1, true, 18 + Math.random() * 40, 0.4);
      if (Math.random() < 0.35) sfxExplosion(1 + Math.random(), gainFor(tv1, 3200) * 0.8);
    }
    if (cap.dying <= 0) breakApartCapital(cap);
  }

  /* ---- escombros de capital: derivan, giran y se apagan ---- */
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life += dt;
    d.mesh.position.addScaledVector(d.vel, dt);
    d.mesh.rotation.x += d.spin.x * dt;
    d.mesh.rotation.y += d.spin.y * dt;
    d.mesh.rotation.z += d.spin.z * dt;
    if (d.life > 9) {
      const k = Math.max(0, 1 - (d.life - 9) / 5);
      for (const mat of (Array.isArray(d.mesh.material) ? d.mesh.material : [d.mesh.material])) mat.opacity = k;
      if (k <= 0) { scene.remove(d.mesh); debris.splice(i, 1); }
    }
  }

  /* ---- proyectiles de torreta (segmento: sin túneles) ---- */
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    segPrev.copy(b.mesh.position);
    segStep.copy(b.vel).multiplyScalar(dt);
    b.mesh.position.add(segStep);
    b.life -= dt;
    let done = b.life <= 0;

    if (!done && b.kind === 'heavy' && b.targetCap.alive) {
      for (const c of colliders) {
        if (c.cap !== b.targetCap) continue;
        if (segmentHitsSphere(segPrev, segStep, c.pos, c.r)) {
          damageCapital(b.targetCap, 16, b.mesh.position);
          flash(b.mesh.position, true, 30, 0.5);
          sfxExplosion(1.3, gainFor(b.mesh.position, 1800) * 0.7);
          done = true; break;
        }
      }
    }
    if (!done && b.kind === 'flak') {
      for (const f of fighters) {
        if (!f.alive || f.faction === b.faction) continue;
        if (segmentHitsSphere(segPrev, segStep, f.obj.position, 9)) {
          damageFighter(f, 1, b.mesh.position);
          done = true; break;
        }
      }
      if (!done) {
        for (const s of swarm) {
          if (!s.alive || s.faction === b.faction) continue;
          if (segmentHitsSphere(segPrev, segStep, s.obj.position, 9)) {
            s.hp--;
            if (s.hp <= 0) killSwarmShip(s, false);
            else flash(b.mesh.position, false, 5, 0.15);
            done = true; break;
          }
        }
      }
      if (!done && b.faction === 'enemy' && !player.dead
          && segmentHitsSphere(segPrev, segStep, ship.position, 8)) {
        damagePlayer(9);
        shieldRegen = 0;
        flash(b.mesh.position, true, 6, 0.2);
        done = true;
      }
    }
    if (done) { scene.remove(b.mesh); bolts.splice(i, 1); }
  }

  /* ---- misiles guiados ---- */
  missileCooldown -= dt;
  for (let i = missiles.length - 1; i >= 0; i--) {
    const ms = missiles[i];
    const hasTarget = ms.target && ms.target.alive;
    if (hasTarget) {
      // persecución con giro limitado: alcanzable, pero esquivable
      tmp.copy(ms.target.obj.position).sub(ms.mesh.position).normalize();
      const speed = Math.min(240, ms.vel.length() + 130 * dt); // más rápido que tu turbo: no te adelantas a tu propio misil
      ms.vel.lerp(tmp.multiplyScalar(speed), 1 - Math.exp(-2.6 * dt));
      ms.mesh.quaternion.setFromUnitVectors(tmp.set(0, 0, 1), tmp2.copy(ms.vel).normalize());
    }
    ms.mesh.position.addScaledVector(ms.vel, dt);
    ms.life -= dt;
    let done = ms.life <= 0;

    if (!done && hasTarget && !ms.target.isCapital
        && ms.mesh.position.distanceToSquared(ms.target.obj.position) < 12 * 12) {
      damageFighter(ms.target, 3, ms.mesh.position); // un misil, una baja
      flash(ms.mesh.position, true, 14, 0.35);
      sfxExplosion(1.6, gainFor(ms.mesh.position, 1600));
      done = true;
    }
    if (!done) {
      for (const c of colliders) {
        if (ms.mesh.position.distanceToSquared(c.pos) < c.r * c.r) {
          // cabezazo contra una capital enemiga: daño pesado de misil
          if (c.cap && c.cap.alive && c.cap.faction === 'enemy') damageCapital(c.cap, 150, ms.mesh.position);
          flash(ms.mesh.position, true, 12, 0.3);
          done = true; break;
        }
      }
    }
    if (done) { scene.remove(ms.mesh); missiles.splice(i, 1); }
  }

  /* ---- láseres (test de segmento: sin túneles a bajo framerate) ---- */
  for (let i = lasers.length - 1; i >= 0; i--) {
    const l = lasers[i];
    segPrev.copy(l.mesh.position);
    segStep.copy(l.vel).multiplyScalar(dt);
    l.mesh.position.add(segStep);
    l.life -= dt;
    let dead = l.life <= 0;

    if (!dead) {
      for (const f of fighters) {
        if (!f.alive || f.faction === l.faction) continue;
        if (segmentHitsSphere(segPrev, segStep, f.obj.position, 8)) {
          damageFighter(f, 1, l.mesh.position);
          dead = true; break;
        }
      }
    }
    // los láseres cazan al enjambre RIVAL — simétrico para ambos bandos
    // (antes solo los aliados impactaban de verdad: con flotas finitas era una escabechina)
    if (!dead) {
      // el jugador es cirujano (r8); los NPC son peores tiradores (r5):
      // la flota se desgasta sola DESPACIO y tú eres quien decide la batalla
      const hitR = l.isPlayer ? 8 : 5;
      for (const s of swarm) {
        if (!s.alive || s.faction === l.faction) continue;
        if (segmentHitsSphere(segPrev, segStep, s.obj.position, hitR)) {
          s.hp--;
          if (s.hp <= 0) killSwarmShip(s, l.isPlayer);
          else flash(l.mesh.position, false, 5, 0.15);
          dead = true; break;
        }
      }
    }
    if (!dead && l.faction === 'enemy' && !player.dead) {
      if (segmentHitsSphere(segPrev, segStep, ship.position, 7)) {
        damagePlayer(12);
        flash(l.mesh.position, true, 5, 0.2);
        shieldRegen = 0;
        dead = true;
      }
    }
    if (!dead) {
      for (const c of colliders) {
        if (segmentHitsSphere(segPrev, segStep, c.pos, c.r)) {
          // los cascos de capital acusan el fuego láser rival (daño de picadura)
          if (c.cap && c.cap.alive && c.cap.faction !== l.faction) damageCapital(c.cap, 1, l.mesh.position);
          flash(l.mesh.position, false, 4, 0.15);
          dead = true; break;
        }
      }
    }
    if (dead) {
      l.mesh.visible = false;
      laserPool.push(l.mesh);
      lasers.splice(i, 1);
    }
  }

  /* ---- destellos del pool ---- */
  for (const s of flashSlots) {
    if (!s.active) continue;
    s.life -= dt;
    const k = Math.max(0, s.life / s.total);
    s.spr.material.opacity = k;
    s.spr.scale.setScalar(s.spr.scale.x + s.grow * dt);
    s.light.intensity = 6 * k;
    if (s.life <= 0) { s.active = false; s.spr.visible = false; s.light.intensity = 0; }
  }

  /* ---- polvo envolvente ---- */
  const dp = dustGeo.attributes.position;
  for (let i = 0; i < dustN; i++) {
    tmp.fromBufferAttribute(dp, i);
    if (tmp.distanceToSquared(ship.position) > 170 * 170) {
      fwd.set(0, 0, 1).applyQuaternion(ship.quaternion);
      tmp.copy(ship.position)
        .addScaledVector(fwd, 60 + Math.random() * 110)
        .add(tmp2.set((Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240));
      dp.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
  }
  dp.needsUpdate = true;

  /* ---- cámara third-person (compensada por velocidad) ---- */
  const camT = 1 - Math.exp(-5 * dt);
  tmp.set(0, 4, -14).applyQuaternion(ship.quaternion).add(ship.position)
    .addScaledVector(player.vel, 1 / 5);
  camera.position.lerp(tmp, camT);
  const fromShip = tmp2.copy(camera.position).sub(ship.position);
  const d = fromShip.length();
  if (d < 9) camera.position.copy(ship.position).addScaledVector(fromShip.normalize(), 9);
  else if (d > 34) camera.position.copy(ship.position).addScaledVector(fromShip.normalize(), 34);
  fwd.set(0, 0, 1).applyQuaternion(ship.quaternion);
  tmp.copy(ship.position).addScaledVector(fwd, 40);
  lookM.lookAt(camera.position, tmp, tmp2.set(0, 1, 0).applyQuaternion(ship.quaternion));
  camera.quaternion.slerp(lookQ.setFromRotationMatrix(lookM), 1 - Math.exp(-6 * dt));

  const speed = player.vel.length();
  const boosting = !player.dead && (isTouch ? touchBoost : (keys.ShiftLeft && keys.KeyW));
  const targetFov = 62 + 8 * Math.min(1, speed / TUNE.maxSpeed) + (boosting ? 14 : 0);
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();
  dome.position.copy(camera.position);

  /* ---- HUD ---- */
  hud.speed.textContent = Math.round(speed);
  hud.boost.style.opacity = boosting ? 1 : 0;
  hud.shield.style.width = `${player.shield}%`;
  hud.hull.style.width = `${player.hull}%`;
  if (hud.allies) hud.allies.textContent =
    fighters.filter((f) => f.alive && f.faction === 'ally').length +
    swarm.filter((s) => s.alive && s.faction === 'ally').length + (player.dead ? 0 : 1);
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) hud.msg.style.opacity = 0; }

  earth.rotation.y += dt * 0.004;
  ringed.rotation.y += dt * 0.003;
  gas.rotation.y += dt * 0.002;

  updateSwarmInstances();
}
function tick() {
  requestAnimationFrame(tick);
  update(Math.min(clock.getDelta(), 0.05));
  drawRadar();          // solo una vez por frame RENDERIZADO (no en __sb.step)
  drawMarkers();
  updateEnemyArrow();
  renderer.render(scene, camera);
}
// simulación acelerada para pruebas: N segundos de batalla sin esperar al render
window.__sb.step = (seconds) => {
  sfxMuted = true;
  try { for (let i = 0, n = Math.round(seconds * 60); i < n; i++) update(1 / 60); }
  finally { sfxMuted = false; }
};
tick();
