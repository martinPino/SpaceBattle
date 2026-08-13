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
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { onCrazyGames, cgInit, cgStartupRoom, cgRoomOpen, cgRoomClosed, cgRoomLeft, cgInviteLink,
  cgLoaded, cgPlaying, cgCelebrate } from './crazygames.js';
import { stat } from './stats.js';
import { net, diag, hostGame, joinGame, setReady, startMatch, send as netSend, leave as netLeave, broadcastLobby,
  setName, setTeam, setMode, setShip, sendTo, iceConfig, getTurn, setTurn, refreshTurn,
  listRooms, announceRoom, setPublic,
  writePos, readPos, writeQuat, readQuat } from './net.js';

/* ============================== escenario ============================== */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.body.appendChild(renderer.domElement);

/* ===================== VERSIÓN LIMPIA =====================
   Un solo código, dos entradas. portal.html declara window.SB_CLEAN y entonces
   el juego no carga ni una muestra de sonido ni el caza del enjambre ajenos:
   usa el motor de audio sintetizado y el caza procedural del kit, que son
   originales y por tanto publicables y monetizables en cualquier portal.
   index.html no declara nada y se queda con la versión completa. */
const CLEAN_BUILD = !!window.SB_CLEAN;

/* ===================== PANTALLA DE CARGA =====================
   Hasta ahora el menú aparecía al instante y el botón de empezar podía
   pulsarse con la mitad de los modelos aún viajando por la red: la partida
   arrancaba con un tirón. Cada cargador se apunta aquí y el menú no sale
   hasta que todos terminan (o fallan, que también cuenta). */
const loading = { total: 0, done: 0, label: 'building the fleet…', ready: false };
function loadJob(label) {
  loading.total++;
  loading.label = label;
  paintLoading();
  let closed = false;
  return () => { // vale tanto para éxito como para error: el menú nunca se queda colgado
    if (closed) return;
    closed = true;
    loading.done++;
    paintLoading();
  };
}
function paintLoading() {
  const bar = document.getElementById('loadBar');
  const what = document.getElementById('loadWhat');
  if (!bar) return;
  const pct = loading.total ? Math.round((loading.done / loading.total) * 100) : 0;
  bar.style.width = `${pct}%`;
  what.textContent = loading.done >= loading.total ? 'ready' : loading.label;
  if (loading.total && loading.done >= loading.total && !loading.ready) {
    loading.ready = true;
    // margen para que three.js suba las mallas a la GPU. Con temporizador y NO
    // con requestAnimationFrame: el navegador lo congela en pestañas de fondo,
    // y quien cargara el juego en segundo plano se quedaba en esta pantalla.
    setTimeout(() => {
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('start').classList.remove('hidden');
      cgLoaded();
    }, 120);
  }
}

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

/* --------- decorado profundo del usuario: nebulosa y galaxia espiral ---------
   Son nubes de puntos (no mallas): se pintan como estrellas luminosas con
   mezcla aditiva. Deben caber dentro del plano lejano de la cámara (30 km). */
const starGlowTex = radialGlow([0.85, 0.92, 1.0], 0.22);        // estrella: núcleo pequeño
const gasGlowTex = radialGlow([0.55, 0.78, 1.0], 0.3, true);    // gas: sin núcleo caliente
function loadPointCloud(url, { position, rotation, scale = 1, size, color, tint, opacity = 1, gas = false }) {
  const done = loadJob('deep sky…');
  new OBJLoader().load(url, (root) => {
    done();
    root.traverse((o) => {
      if (!o.isPoints) return;
      const hasColor = !!o.geometry.getAttribute('color');
      o.material = new THREE.PointsMaterial({
        map: gas ? gasGlowTex : starGlowTex, size, sizeAttenuation: true,
        transparent: true, opacity, depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: hasColor,
        // con vertexColors el color del material multiplica: sirve de tinte
        color: hasColor ? (tint || 0xffffff) : color,
      });
    });
    root.position.set(position[0], position[1], position[2]);
    if (rotation) root.rotation.set(rotation[0], rotation[1], rotation[2]);
    root.scale.setScalar(scale);
    root.frustumCulled = false; // una nube tan grande no debe desaparecer por su centro
    world.add(root);
  }, undefined, done);
}
// galaxia espiral: lejana e inclinada para verle los brazos. Compacta a propósito
// — escalarla invadiría el campo de batalla y sus estrellas pasarían al lado del
// jugador como manchas gigantes (una galaxia se mira, no se atraviesa)
// (arriba y a babor: cuadrante despejado, sin planetas que la pisen)
// opacidad baja a propósito: con mezcla aditiva y brazos densos, cualquier valor
// alto satura a blanco puro y se pierden el núcleo y el degradado de los brazos
loadPointCloud('./assets/ENV_Galaxy_Spiral_01.obj', {
  position: [-9000, 11000, 6000], rotation: [-0.62, 0.5, 0.25], scale: 1,
  size: 250, opacity: 0.42, tint: 0xcfe0ff,
});
// nebulosa azul: cúmulo de gas bajo, a estribor
loadPointCloud('./assets/ENV_Nebula_Blue_01.obj', {
  position: [10000, -6000, 2000], rotation: [0.2, 0.8, 0], scale: 2.6, size: 420,
  color: 0x8fc8ff, opacity: 0.55, gas: true,
});

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

// los cascos de las capitales bloquean: esferas que siguen la forma del casco
// (las puntas estrechas — nada de parachoques fantasma delante de la proa)
const HULL_SPHERES_KIT = [[0, 0, -1000, 150], [0, 0, -500, 260], [0, 0, 0, 300], [0, 0, 500, 260], [0, 0, 1000, 150]];
/* Arco imperial: el casco son DOS cosas distintas — un núcleo esférico (con
   torre de mando arriba y hangar ventral abajo) y un aro plano de solo 400 m
   de grosor. Agruparlo todo por ángulo daba esferas de radio ~590 que envolvían
   cientos de metros de vacío sobre y bajo el aro: pared invisible en cielo
   despejado. Ahora el núcleo va en una pila vertical y el aro en esferas
   pequeñas encadenadas (radio medio 210): 91% de cobertura y 0% de volumen
   bloqueado a más de 300 m de geometría. */
const HULL_SPHERES_ORB = [
  [2, -269, 44, 359], [4, -26, 91, 457], [-6, 201, 63, 396], [-1, 452, -54, 323],
  [-1131, 44, 74, 131], [-1141, -3, -344, 131], [-251, -19, -641, 139], [0, -7, -662, 144],
  [252, -19, -641, 139], [1141, -3, -344, 131], [1130, 40, 74, 128], [1091, 19, 391, 221],
  [916, 21, 696, 219], [633, 29, 943, 173], [302, 21, 1094, 165], [0, 15, 1145, 167],
  [-302, 28, 1093, 166], [-636, 30, 944, 173], [-903, 12, 699, 208], [-1087, 23, 397, 228],
];
function buildCapitalColliders(cap, spheres) {
  for (let i = colliders.length - 1; i >= 0; i--) {
    if (colliders[i].cap === cap) { // fuera las del casco anterior
      const old = colliders[i].obj;
      if (old.parent) old.parent.remove(old);
      colliders.splice(i, 1);
    }
  }
  for (const [x, y, z, r] of spheres) {
    const proxy = new THREE.Object3D();
    cap.group.add(proxy);
    proxy.position.set(x, y, z);
    addCollider(proxy, r, cap);
  }
}
buildCapitalColliders(capitals.ally, HULL_SPHERES_KIT);
buildCapitalColliders(capitals.enemy, HULL_SPHERES_KIT);

// torretas: usa los TurretSocket_*/TurretGun_* del modelo y completa con soportes sintéticos
function initTurrets(cap) {
  const marks = [];
  cap.group.updateMatrixWorld(true);
  cap.group.traverse((o) => {
    if (!o.name || !/TurretSocket|TurretGun/.test(o.name)) return;
    if (!o.isMesh) { marks.push(o); return; } // marcadores vacíos del kit
    // en un OBJ los vértices van en coordenadas absolutas y el objeto tiene
    // transform identidad: la posición real está en el centro de su geometría
    o.geometry.computeBoundingBox();
    const c = o.geometry.boundingBox.getCenter(new THREE.Vector3());
    o.localToWorld(c);
    cap.group.worldToLocal(c);
    const p = new THREE.Object3D();
    p.position.copy(c);
    cap.group.add(p);
    marks.push(p);
  });
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
// extensión local del incendio previo a partirse (cada casco tiene su forma)
capitals.ally.burnExtent = [240, 150, 2100];
capitals.enemy.burnExtent = [240, 150, 2100];

/* ---------- capital enemiga: acorazado imperial del usuario (arco de 2,6 km) ----------
   Reemplaza el casco del kit en cuanto carga; si falla, el kit sigue en su sitio.
   Guarda un molde para que cada oleada traiga una capital enemiga NUEVA. */
let orbTemplate = null;
function installOrbHull(cap) {
  if (!orbTemplate) return false;
  for (const child of [...cap.group.children]) cap.group.remove(child);
  cap.group.add(orbTemplate.clone());
  cap.group.scale.setScalar(1);
  buildCapitalColliders(cap, HULL_SPHERES_ORB);
  initTurrets(cap);
  cap.burnExtent = [2400, 700, 1800]; // arco ancho: el incendio recorre las alas
  return true;
}
const capitalDone = loadJob('imperial flagship…');
new OBJLoader().load('./assets/SHIP_Capital_Imperial_Orb_01.obj', (obj) => {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const make = GUN_MAT_MAP[o.material && o.material.name];
    if (make) o.material = make();
  });
  orbTemplate = obj;
  installOrbHull(capitals.enemy);
  capitalDone();
}, undefined, capitalDone);
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

/* ======================= ELECCIÓN DE NAVE =======================
   Se sustituye solo el CUERPO visible, no la nave entera: los marcadores del
   kit (bocas de cañón, motores, punto de cámara) se quedan en su sitio, así
   que disparos, estelas y cámara funcionan igual con cualquier modelo. Todos
   vienen normalizados a 12 m de largo desde Blender. */
const SHIPS = [
  { id: 'kit', name: 'INTERCEPTOR', tag: 'kit · all-rounder', file: null, yaw: 0, scale: 1 },
  { id: 'fighterjet', name: 'FIGHTER JET X', tag: 'sleek · atmospheric', file: './assets/ships/ship-fighterjet.glb', yaw: 0, scale: 1 },
  // su morro también está en −X (66% más fino que la popa), igual que la KSS-X:
  // las tres salen del mismo generador y comparten convención de ejes
  { id: 'vanguard', name: 'OBSIDIAN VANGUARD', tag: 'heavy · armored', file: './assets/ships/ship-vanguard.glb', yaw: 90, scale: 1 },
  // eje largo en X tras el preproceso (12 de ancho por 8,4 de largo): volaba de
  // costado. El signo sale de medir el GROSOR de cada extremo: el morro es el
  // fino (aquí −X, un 67% más estrecho). Mirarla "simétrica desde atrás" no
  // sirve para el signo: lo es igual mirando al frente que hacia atrás
  { id: 'mothership', name: 'KSS-X', tag: 'exotic · alien hull', file: './assets/ships/ship-mothership.glb', yaw: 90, scale: 1 },
];
let currentShipId = 'kit';
let shipBody = null;                 // cuerpo añadido (null = el del kit)
const shipCache = new Map();
const kitMeshes = [];                // mallas propias del kit, para poder ocultarlas

function applyShip(id, onDone) {
  const spec = SHIPS.find((s) => s.id === id) || SHIPS[0];
  currentShipId = spec.id;
  if (!kitMeshes.length) ship.traverse((o) => { if (o.isMesh) kitMeshes.push(o); });
  const showKit = (v) => { for (const m of kitMeshes) m.visible = v; };
  if (shipBody) { ship.remove(shipBody); shipBody = null; }
  if (!spec.file) { showKit(true); onDone && onDone(); return; }
  const install = (src) => {
    shipBody = src.clone();
    shipBody.rotation.y = THREE.MathUtils.degToRad(spec.yaw || 0);
    shipBody.scale.setScalar(spec.scale || 1);
    ship.add(shipBody);
    showKit(false);
    onDone && onDone();
  };
  if (shipCache.has(spec.id)) { install(shipCache.get(spec.id)); return; }
  new GLTFLoader().load(spec.file, (g) => {
    shipCache.set(spec.id, g.scene);
    install(g.scene);
  }, undefined, () => { showKit(true); onDone && onDone(); }); // si falla, el del kit
}

/* ---- ascuas de daño: con el casco tocado, tu nave suelta chispas y humo ---- */
const emberTex = radialGlow([1.0, 0.6, 0.28], 0.3);
const emberTmp = new THREE.Vector3(); // propio: no compartir temporales entre sistemas
const embers = [];
for (let i = 0; i < 22; i++) {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: emberTex, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  spr.visible = false;
  scene.add(spr);
  embers.push({ spr, life: 0, total: 1, vel: new THREE.Vector3(), size: 1 });
}
let emberT = 0;
function spawnEmber() {
  const e = embers.find((x) => x.life <= 0);
  if (!e) return;
  e.total = 0.6 + Math.random() * 0.7;
  e.life = e.total;
  e.size = 0.9 + Math.random() * 1.6;
  // brota del casco y queda atrás: hereda tu velocidad y se dispersa
  e.spr.position.copy(ship.position)
    .add(emberTmp.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 6)
      .applyQuaternion(ship.quaternion));
  e.vel.copy(player.vel).multiplyScalar(0.55)
    .add(emberTmp.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, -6 - Math.random() * 8)
      .applyQuaternion(ship.quaternion));
  e.spr.visible = true;
}
function updateEmbers(dt) {
  // cuanto peor el casco, más ascuas (por debajo del 55% empieza a arder)
  const hurt = Math.max(0, 1 - player.hull / 55);
  if (!player.dead && started && hurt > 0) {
    emberT -= dt;
    if (emberT <= 0) { spawnEmber(); emberT = 0.1 - hurt * 0.07; }
  }
  for (const e of embers) {
    if (e.life <= 0) continue;
    e.life -= dt;
    const k = Math.max(0, e.life / e.total);
    e.spr.position.addScaledVector(e.vel, dt);
    e.spr.material.opacity = k * 0.9;
    e.spr.scale.setScalar(e.size * (1 + (1 - k) * 2.6)); // se expande al enfriarse
    if (e.life <= 0) { e.spr.visible = false; e.spr.material.opacity = 0; }
  }
}
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
// en móvil se juega en horizontal: si el navegador deja fijar la orientación,
// se fija (Android en pantalla completa); iOS la ignora y queda el aviso de girar
function lockLandscape() {
  if (!isTouch) return;
  try {
    const el2 = document.documentElement;
    if (el2.requestFullscreen) el2.requestFullscreen().then(() => {
      screen.orientation?.lock?.('landscape').catch(() => {});
    }).catch(() => {});
  } catch { /* navegador sin pantalla completa */ }
}
function lockPointer() {
  if (isTouch) return; // en táctil no hay pointer lock: manda el stick
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {}); // Chrome rechaza re-locks <1.25s tras Esc
}
document.getElementById('startBtn').onclick = () => {
  document.getElementById('start').classList.add('hidden');
  stat('play');
  enterAudio(); // el gesto del usuario desbloquea el audio del navegador
  lockLandscape();
  lockPointer();
  started = true;
  cgPlaying(true);
};

/* silencio de la plataforma: manda sobre cualquier ajuste del juego, así que
   se guarda aparte y se reaplica cada vez que el audio se recrea */
let platformMuted = false;
function setPlatformMute(v) {
  platformMuted = !!v;
  if (audio) audio.master.gain.value = platformMuted ? 0 : 0.9;
}
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
// pestaña oculta: rAF se pausa pero el AudioContext seguiría sonando (drone eterno).
// Al volver NO basta con resume(): el navegador puede exigir otro gesto y puede
// haber matado los bucles, así que se pasa por la recuperación completa.
document.addEventListener('visibilitychange', () => {
  if (!audio) return;
  if (document.hidden) audio.ctx.suspend();
  else resumeAudio();
});
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  sizeMarkers();
}
addEventListener('resize', onResize);
// iOS notifica el giro con dimensiones viejas: re-medir con retardo
addEventListener('orientationchange', () => { setTimeout(onResize, 250); setTimeout(onResize, 700); });

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
   por distancia al jugador. Se inicia con el gesto del botón de inicio.

   EL JUEGO SE QUEDABA MUDO. Tres razones distintas, y desde el sofá las tres se
   ven igual — silencio total, como si el audio estuviera roto:
     1) Autoplay. Un AudioContext creado fuera de un gesto nace 'suspended' y ya
        no sale de ahí solo. Le pasaba al INVITADO de una partida en red: entra
        en cabina por un mensaje del anfitrión, no por un clic suyo, así que
        beginMultiplayer() creaba el contexto sin gesto y nadie volvía a tocarlo.
     2) Interrupciones. Una llamada, bloquear el móvil o cambiar de app paran el
        contexto; en iOS resume() solo funciona dentro de otro gesto, y además
        las fuentes en bucle (el motor y la música) se quedan muertas aunque el
        contexto vuelva: el juego "arranca" pero sin banda sonora.
     3) El interruptor de silencio del iPhone, que calla TODO el WebAudio salvo
        que se declare la sesión de audio como reproducción.
   Ahora: cualquier gesto reintenta el desbloqueo mientras no suene, los bucles
   se reconstruyen tras una interrupción y, si aun así sigue mudo, el HUD lo dice
   en vez de dejar al piloto pensando que el juego está roto. */
const AC = window.AudioContext || window.webkitAudioContext;
let audio = null;
let sfxMuted = false;      // __sb.step() simula minutos en un instante: sin esto, cientos de nodos a la vez
let audioWanted = false;   // ya estamos en cabina: a partir de aquí hay que sonar
let musicFailed = false;   // la pista del usuario no cargó: toca la generativa
let audioInterrupted = false; // el sistema paró el contexto: al volver, bucles nuevos
let unlockArmed = false;
let audioBlocked = false;  // aviso del HUD ya dado, para no repetirlo cada frame
let audioBlockT = 0;

// Nada se programa con el contexto parado: mientras está suspendido
// ctx.currentTime está congelado, así que todo lo encolado sonaría de golpe —
// una escopetada de cien disparos— en cuanto el navegador lo reanudara.
function sfxOff() { return sfxMuted || !audio || audio.ctx.state !== 'running'; }

/* -------- desbloqueo: cualquier gesto vale mientras no esté sonando -------- */
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'mousedown', 'keydown'];
function onUnlockGesture() { resumeAudio(); }
function armAudioUnlock() {
  if (unlockArmed) return;
  unlockArmed = true;
  // en captura: los botones táctiles del HUD se comen sus propios eventos
  for (const ev of UNLOCK_EVENTS) addEventListener(ev, onUnlockGesture, { capture: true, passive: true });
}
function disarmAudioUnlock() {
  if (!unlockArmed) return;
  unlockArmed = false;
  for (const ev of UNLOCK_EVENTS) removeEventListener(ev, onUnlockGesture, { capture: true });
}
function resumeAudio() {
  // La música empieza ya en el menú, no al entrar en cabina. No puede sonar
  // antes: sin un gesto del usuario el navegador no deja crear audio. Así que
  // el primer toque en cualquier sitio —elegir nave, un botón, una tecla— la
  // arranca, y el resto del sistema (esperar a que baje la pista, recuperarse
  // de una interrupción) ya funcionaba colgado de esta misma bandera.
  audioWanted = true;
  initAudio();
  if (!audio) return;
  if (audio.ctx.state === 'running') {
    disarmAudioUnlock();
    if (!audio.musicTrack && !audio.music) {   // ya sonaba el contexto: engancha la música
      if (audio.musicTrackBuf) startUserMusic();
      else if (musicFailed) startMusic();
    }
    return;
  }
  armAudioUnlock(); // si este intento no cuaja, lo reintenta el próximo gesto
  const p = audio.ctx.resume();
  if (p && p.catch) p.catch(() => { /* hará falta otro gesto */ });
}
// entrar en cabina, por el menú o por la red: desde aquí sí queremos música
function enterAudio() {
  audioWanted = true;
  resumeAudio();
  if (!audio) return;
  if (audio.musicTrackBuf) startUserMusic();   // ya descargada mientras elegías nave
  else if (musicFailed) startMusic();
}
armAudioUnlock(); // el primer toque en cualquier sitio ya crea el contexto y precarga

function initAudio() {
  if (audio || !AC) return;
  // iOS: sin declarar la sesión como reproducción, el interruptor de silencio
  // del iPhone deja el juego entero mudo (Safari 16.4+)
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* no soportado */ }
  const ctx = new AC();
  // Limitador de salida. Los samples vienen flojos —la música pica a −12 dBFS y
  // se queda en −28 de RMS—, así que con el master a 0.45 la batalla salía a
  // −37 dBFS: en el altavoz de un móvil, eso es no oír nada. Ahora el master
  // sube al doble y es el limitador el que sujeta los picos, que con 184
  // tiradores y capitales reventando se solapan de sobra.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 4;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = platformMuted ? 0 : 0.9;
  master.connect(limiter);
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  // motor: ruido en banda que sigue al acelerador
  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'bandpass';
  engineFilter.frequency.value = 110;
  engineFilter.Q.value = 1.1;
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineFilter.connect(engineGain).connect(master);
  audio = {
    ctx, master, engineGain, engineFilter, noiseBuf, laserBudget: 2, engineSrc: null,
    music: null, musicTrack: null, laserBuf: null, explodeBuf: null, shieldBuf: null, musicTrackBuf: null,
  };
  startEngineDrone();
  // el navegador para y reanuda el contexto por su cuenta: aquí nos enteramos
  ctx.onstatechange = () => {
    if (ctx.state === 'interrupted') audioInterrupted = true; // Safari: llamada, bloqueo de pantalla…
    if (ctx.state === 'running') {
      disarmAudioUnlock();
      if (audioInterrupted) { audioInterrupted = false; restartAudioLoops(); }
    } else if (audioWanted) armAudioUnlock();
  };
  // samples del usuario; si alguno falla, queda el respaldo sintetizado
  const loadSample = (url, key, onOk, onFail) => fetch(url)
    .then((r) => r.arrayBuffer())
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => { audio[key] = decoded; onOk && onOk(); })
    .catch(() => { onFail && onFail(); });
  if (CLEAN_BUILD) {
    // versión para portales: nada de muestras ajenas. Suena el motor de audio
    // sintetizado que ya existe —blaster, explosiones, alarma— y la banda
    // sonora generativa, que es 100% de la casa
    musicFailed = true;
    if (audioWanted) startMusic();
    return;
  }
  loadSample('./assets/blaster-fire.mp3', 'laserBuf');
  loadSample('./assets/ship-explode.mp3', 'explodeBuf');
  loadSample('./assets/shield-down.mp3', 'shieldBuf');
  loadSample('./assets/flyby.mp3', 'flybyBuf');
  loadSample('./assets/battle-music.mp3', 'musicTrackBuf',
    () => { if (audioWanted) startUserMusic(); },                 // la pista del usuario, en bucle perfecto
    () => { musicFailed = true; if (audioWanted) startMusic(); }); // sin pista: banda sonora generativa
}

// El drone del motor es una fuente en bucle, y una interrupción del sistema la
// mata para siempre: por eso se monta aparte, para poder rehacerla.
function startEngineDrone() {
  if (!audio) return;
  const { ctx, noiseBuf, engineFilter } = audio;
  if (audio.engineSrc) {
    audio.engineSrc.onended = null; // la vieja no debe disparar el relevo
    try { audio.engineSrc.stop(); } catch { /* ya estaba parada */ }
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.connect(engineFilter);
  src.start();
  // un bucle no termina solo: si termina con el contexto sonando, lo mataron
  src.onended = () => {
    if (audio && audio.engineSrc === src && audio.ctx.state === 'running') startEngineDrone();
  };
  audio.engineSrc = src;
}

// tras una interrupción el contexto vuelve, pero motor y música siguen mudos:
// las fuentes en bucle no se reanudan, se reconstruyen
function restartAudioLoops() {
  if (!audio) return;
  startEngineDrone();
  if (audio.musicTrack) {
    audio.musicTrack.src.onended = null;
    try { audio.musicTrack.src.stop(); } catch { /* ya estaba parada */ }
    audio.musicTrack = null;
  }
  if (audio.music) {
    for (const o of audio.music.drones) { try { o.stop(); } catch { /* ya estaba parada */ } }
    audio.music = null;
  }
  if (!audioWanted) return;
  if (audio.musicTrackBuf) startUserMusic();
  else if (musicFailed) startMusic();
}

// música del usuario en bucle sin costuras para toda la partida
function startUserMusic() {
  if (!audio || audio.musicTrack || !audio.musicTrackBuf) return;
  const { ctx, master } = audio;
  const gain = ctx.createGain();
  // la pista pica a −12 dBFS, así que aguanta este empujón sin acercarse al techo
  gain.gain.value = 1.45; // bien presente ("no se escucha" a 0.42 ni a 0.75)
  gain.connect(master);
  const src = ctx.createBufferSource();
  src.buffer = audio.musicTrackBuf;
  src.loop = true;
  src.connect(gain);
  src.start();
  src.onended = () => { // igual que el motor: un bucle que acaba es un bucle muerto
    if (!audio || !audio.musicTrack || audio.musicTrack.src !== src) return;
    audio.musicTrack = null;
    if (audioWanted && audio.ctx.state === 'running') startUserMusic();
  };
  audio.musicTrack = { src, gain };
}

// whoosh de pasada cercana: una nave cruza rozándote a velocidad
let flybyCool = 0;
function sfxFlyby(vol) {
  if (sfxOff() || !audio.flybyBuf) return;
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
  if (sfxOff() || !audio.shieldBuf) return;
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
  if (sfxOff() || vol <= 0) return;
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
  if (sfxOff() || vol <= 0) return;
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
  if (sfxOff()) return;
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
  if (sfxOff()) return;
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
  if (sfxOff()) return;
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
    // serpenteo propio: frecuencia, fase y amplitud únicas por nave
    weaveF: 0.5 + Math.random() * 0.8,
    weavePh: Math.random() * Math.PI * 2,
    weaveAmp: 0.35 + Math.random() * 0.4,
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
const SWARM_PER_SIDE = 42;   // 50 por bando contando al jugador, héroes y élite
const ENEMY_SWARM_MAX = 160; // capacidad para el DOBLADO por oleadas (34·4, tope oleada 3+)
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
    // "emisivo" = emite luz DE VERDAD: intensidad alta Y color no negro.
    // (mirar solo la intensidad marcaba como brillo negro todo material recién
    // creado del kit — su emissiveIntensity por defecto es 1 con emisivo negro)
    const emisSum = mat.emissive ? mat.emissive.r + mat.emissive.g + mat.emissive.b : 0;
    const isGlow = emisSum > 0.05 && (mat.emissiveIntensity || 0) > 0.5;
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
function makeSwarmBatch(faction) { return makeSwarmBatchFrom(makeSwarmTemplate(faction), faction); }
function makeSwarmBatchFrom(template, faction) {
  // el bando enemigo reserva capacidad ×4: las oleadas doblan sus filas
  const capacity = faction === 'ally' ? SWARM_PER_SIDE : ENEMY_SWARM_MAX;
  const baked = bakeSwarmGeometry(template);
  const hull = new THREE.InstancedMesh(baked.hull, new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.25, roughness: 0.55, envMapIntensity: 1.0,
    // rescoldo por bando: el enjambre se lee contra el vacío igual que los héroes
    emissive: faction === 'ally' ? 0x16303c : 0x3c1a14, emissiveIntensity: 0.5,
  }), capacity);
  hull.frustumCulled = false; // las instancias cubren toda la batalla: sin culling por lote
  scene.add(hull);
  let glow = null;
  if (baked.glow) {
    glow = new THREE.InstancedMesh(baked.glow, new THREE.MeshBasicMaterial({ vertexColors: true }), capacity);
    glow.frustumCulled = false;
    scene.add(glow);
  }
  return { hull, glow };
}
const swarmBatches = { ally: makeSwarmBatch('ally'), enemy: makeSwarmBatch('enemy') };

/* ---------------- caza del enjambre: modelo Starflyer del usuario ----------------
   Venía con 99.918 triángulos: multiplicado por las ~200 instancias visibles
   serían 14 millones de vértices por fotograma. Reducido a 2.500 en Blender
   (y sin texturas, que el horneado descarta las UV igualmente). */
const SWARM_TINT = { ally: 0x8fa7b8, enemy: 0xb06a58 };
function replaceSwarmBatch(faction, source) {
  const tpl = source.clone();
  tpl.scale.setScalar(1.25); // algo mayores que el caza del kit: se leen mejor
  const tint = new THREE.Color(SWARM_TINT[faction]);
  tpl.traverse((o) => {
    if (!o.isMesh) return;
    o.material = new THREE.MeshStandardMaterial({
      color: tint, metalness: 0.35, roughness: 0.55,
      emissive: new THREE.Color(faction === 'ally' ? 0x16303c : 0x3c1a14), emissiveIntensity: 0.45,
    });
  });
  const old = swarmBatches[faction];
  const fresh = makeSwarmBatchFrom(tpl, faction);
  swarmBatches[faction] = fresh;
  if (old) { // fuera la malla anterior y su memoria de GPU
    for (const m of [old.hull, old.glow]) {
      if (!m) continue;
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
const swarmDone = CLEAN_BUILD ? null : loadJob('swarm fighters…');
if (!CLEAN_BUILD) new GLTFLoader().load('./assets/ships/swarm-starflyer.glb', (g) => {
  replaceSwarmBatch('ally', g.scene);
  replaceSwarmBatch('enemy', g.scene);
  swarmDone();
}, undefined, swarmDone); // si falla, se queda el caza del kit

/* ===================== CAÑONERAS ENEMIGAS (SHIP_Enemy_Gunship_01) =====================
   Naves pesadas de 24,5 m — el doble que un caza — con 4 cañones láser y pods de
   misiles. Se hornean a InstancedMesh igual que el enjambre: 15 naves de 12.834
   caras costarían ~2.000 draw calls como objetos sueltos; así cuestan 2. */
const GUNSHIP_PER_WAVE = 8, GUNSHIP_MAX = 40;
// posiciones locales medidas sobre el modelo (morro en +Z)
const GUN_MUZZLES = [[-7.30, 0.34, 8.68], [7.30, 0.34, 8.68], [-2.05, -2.01, 10.48], [2.05, -2.01, 10.48]];
const GUN_PODS = [[-4.5, -1.64, 1.6], [4.5, -1.64, 1.6]];
// fuera el detalle diminuto: 15 cañoneras a máxima densidad hunden el móvil
const GUN_DETAIL_CUT = /Greeble|PlateSeam|Vent_|Collar_|_Ring_|WarStripe|LeadingEdge|NavLight|Fin_[LR]$/;
// el OBJ nombra sus materiales como el kit: se remapean a la paleta real
const GUN_MAT_MAP = {
  MAT_Hull_Dark: MAT.hull_dark, MAT_Hull_Mid: MAT.hull_mid, MAT_Hull_Black: MAT.hull_black,
  MAT_Hull_Light: MAT.hull_light, MAT_Accent_Amber: MAT.accent, MAT_Cockpit_Glass: MAT.glass,
  MAT_Emissive_Red: MAT.emis_red, MAT_Emissive_EngineCore: MAT.emis_white,
  MAT_Emissive_EngineCore_Red: MAT.emis_red, MAT_Emissive_Aperture: MAT.emis_red,
};
function makeGunshipBatch(template) {
  const baked = bakeSwarmGeometry(template);
  const hull = new THREE.InstancedMesh(baked.hull, new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.3, roughness: 0.5, envMapIntensity: 1.0,
    emissive: 0x3c1a14, emissiveIntensity: 0.5,
  }), GUNSHIP_MAX);
  hull.frustumCulled = false;
  scene.add(hull);
  let glow = null;
  if (baked.glow) {
    glow = new THREE.InstancedMesh(baked.glow, new THREE.MeshBasicMaterial({ vertexColors: true }), GUNSHIP_MAX);
    glow.frustumCulled = false;
    scene.add(glow);
  }
  return { hull, glow };
}
// respaldo si el OBJ no carga: un caza enemigo agrandado — la misión siempre es ganable
function gunshipFallbackTemplate() {
  const t = enemyTemplate.clone();
  t.scale.setScalar(2.0);
  return t;
}
const gunshipDone = loadJob('enemy gunships…');
new OBJLoader().load(
  './assets/SHIP_Enemy_Gunship_01.obj',
  (obj) => {
    gunshipDone();
    const drop = [];
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (GUN_DETAIL_CUT.test(o.name)) { drop.push(o); return; }
      const make = GUN_MAT_MAP[o.material && o.material.name];
      if (make) o.material = make();
    });
    for (const o of drop) o.parent.remove(o);
    liftShipVisibility(obj, 'enemy'); // luces de posición: legible contra el vacío
    swarmBatches.gunship = makeGunshipBatch(obj);
  },
  undefined,
  () => { gunshipDone(); swarmBatches.gunship = makeGunshipBatch(gunshipFallbackTemplate()); },
);

const swarm = [];
function resetSwarmShip(s, immediate) {
  const home = s.faction === 'ally' ? alliedCapital.position : enemyCapital.position;
  s.obj.position.set(
    home.x + (Math.random() - 0.5) * 1600,
    home.y + 100 + (Math.random() - 0.5) * 800,
    home.z + (s.faction === 'ally' ? 1 : -1) * (immediate ? 700 + Math.random() * 2200 : 300),
  );
  s.vel.set(0, 0, 0);
  s.hp = s.isGunship ? 14 : 6; // la cañonera aguanta lo que dos escuadrillas
  s.alive = true;
  s.target = null;
  s.retarget = Math.random() * 2;
  s.nextShot = 2 + Math.random() * 3;
  if (s.isGunship) { s.burst = 0; s.burstCool = 0; s.nextMissile = 6 + Math.random() * 8; }
}
// de las 100 naves enemigas, 15 son cañoneras pesadas
const ENEMY_SWARM_BASE = SWARM_PER_SIDE - GUNSHIP_PER_WAVE; // 77 cazas ligeros
let enabledEnemySwarm = ENEMY_SWARM_BASE, enabledGunships = GUNSHIP_PER_WAVE;
for (const faction of ['ally', 'enemy']) {
  const count = faction === 'ally' ? SWARM_PER_SIDE : ENEMY_SWARM_MAX;
  for (let i = 0; i < count; i++) {
    const s = {
      obj: new THREE.Object3D(), faction, slot: i, batchKey: faction,
      vel: new THREE.Vector3(), hp: 3, alive: true, target: null,
      retarget: 0, nextShot: 0, orbitDir: Math.random() > 0.5 ? 1 : -1,
      weaveF: 0.5 + Math.random() * 0.9,
      weavePh: Math.random() * Math.PI * 2,
      weaveAmp: 0.35 + Math.random() * 0.45,
    };
    resetSwarmShip(s, true);
    if (faction === 'enemy' && i >= enabledEnemySwarm) s.alive = false; // reserva de oleadas futuras
    swarm.push(s);
  }
}
const gunships = [];
for (let i = 0; i < GUNSHIP_MAX; i++) {
  const g = {
    obj: new THREE.Object3D(), faction: 'enemy', slot: i, batchKey: 'gunship',
    isGunship: true, radius: 13,
    vel: new THREE.Vector3(), hp: 14, alive: true, target: null,
    retarget: 0, nextShot: 0, burst: 0, burstCool: 0, nextMissile: 0,
    orbitDir: Math.random() > 0.5 ? 1 : -1,
    weaveF: 0.28 + Math.random() * 0.35,   // pesadas: serpentean lento y amplio
    weavePh: Math.random() * Math.PI * 2,
    weaveAmp: 0.22 + Math.random() * 0.25,
  };
  resetSwarmShip(g, true);
  if (i >= enabledGunships) g.alive = false;
  gunships.push(g);
  swarm.push(g); // comparten IA, colisiones, radar, marcadores y conteo de bajas
}
// flotas FINITAS: 100 naves por bando y ni una más — cada baja acerca el final
function killSwarmShip(s, byPlayer) {
  s.alive = false;
  flash(s.obj.position, true, s.isGunship ? 46 : 22, s.isGunship ? 0.9 : 0.55);
  sfxExplosion(s.isGunship ? 2.4 : 1.2, gainFor(s.obj.position, s.isGunship ? 2200 : 1400));
  shakeFromBlast(s.obj.position, s.isGunship ? 0.75 : 0.4);
  if (s.faction === 'enemy') {
    if (byPlayer) message(s.isGunship ? 'ENEMY GUNSHIP DESTROYED' : 'SWARM FIGHTER DOWN');
    registerEnemyKill();
  }
}

const instMatrix = new THREE.Matrix4();
const oneScale = new THREE.Vector3(1, 1, 1), zeroScale = new THREE.Vector3(0, 0, 0);
function updateSwarmInstances() {
  for (const s of swarm) {
    const batch = swarmBatches[s.batchKey];
    if (!batch) continue; // las cañoneras esperan a que su modelo termine de cargar
    instMatrix.compose(s.obj.position, s.obj.quaternion, s.alive ? oneScale : zeroScale);
    batch.hull.setMatrixAt(s.slot, instMatrix);
    if (batch.glow) batch.glow.setMatrixAt(s.slot, instMatrix);
  }
  for (const b of [swarmBatches.ally, swarmBatches.enemy, swarmBatches.gunship]) {
    if (!b) continue;
    b.hull.instanceMatrix.needsUpdate = true;
    if (b.glow) b.glow.instanceMatrix.needsUpdate = true;
  }
}

function pickTarget(f) {
  let best = null, bestD = Infinity;
  const candidates = fighters.filter((o) => o.alive && o.faction !== f.faction);
  if (f.faction === 'enemy' && !player.dead) candidates.push(playerEntity);
  // los pilotos remotos también son blanco para el bando enemigo
  if (f.faction === 'enemy') for (const rp of remotePilots) if (rp.alive) candidates.push(rp);
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
  shakeFromBlast(f.obj.position, 0.45);
  scene.remove(f.obj);
  if (f.faction === 'enemy') {
    message('ENEMY INTERCEPTOR DOWN');
    registerEnemyKill();
  } else {
    message('ALLIED FIGHTER LOST');
  }
}

// la misión: aniquilar la flota enemiga COMPLETA de la oleada (cada oleada DOBLA sus filas)
let waveEnemyTotal = ENEMY_TOTAL + SWARM_PER_SIDE; // oleada 1: 100
function registerEnemyKill() {
  kills++;
  hud.kills.textContent = kills;
  if (kills >= waveEnemyTotal) endGame(true);
}

// el misil pega MUCHO más que el láser: un caza, del impacto; la capital, 150 al casco
function missileHit(target, pos) {
  if (target.isCapital) return; // el golpe al casco lo resuelven sus esferas de colisión
  if (target.isPilot) {         // otro jugador: duele, pero no lo borra de un golpe
    netHitPilot(target, 60);    // rompe el escudo y muerde el casco; dos misiles matan
    return;
  }
  if (target.isGunship) {       // blindada: hacen falta dos misiles (o 14 láseres)
    target.hp -= 8;
    if (target.hp <= 0) killSwarmShip(target, true);
    else flash(pos, true, 9, 0.25);
  } else if (target.slot !== undefined) {
    target.hp = 0;
    killSwarmShip(target, true);
  } else {
    damageFighter(target, 6, pos);
  }
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
/* cada oleada, el enemigo trae una capital NUEVA si perdió la anterior
   (la tuya no se repone: perderla pesa para el resto de la partida) */
function respawnEnemyCapital() {
  const cap = capitals.enemy;
  if (cap.alive) return;
  if (!cap.group.parent) world.add(cap.group); // breakApart la había retirado
  cap.hp = cap.maxHp;
  cap.alive = true;
  cap.dying = 0;
  cap.burnT = 0;
  if (cap.bar) cap.bar.style.width = '100%';
  if (!installOrbHull(cap)) {
    cap.group.add(buildCapitalShip({ length: 2600 }));
    buildCapitalColliders(cap, HULL_SPHERES_KIT);
    initTurrets(cap);
  }
  message('ENEMY FLAGSHIP ARRIVING');
}
function startNextWave() {
  wave++;
  if (wave === 2) stat('wave2');   // cuántos pasan de la primera oleada
  enemySpread = Math.max(0.07, 0.14 - 0.02 * (wave - 1));
  el('waveNum').textContent = wave;
  kills = 0;
  hud.kills.textContent = 0;
  clearProjectiles();
  // EL DOBLE de enemigos por oleada (tope ×4 en la 3+): enjambre, élite y cañoneras
  const mult = Math.min(Math.pow(2, wave - 1), 4);
  enabledEnemySwarm = Math.min(ENEMY_SWARM_BASE * mult, ENEMY_SWARM_MAX);
  enabledGunships = Math.min(GUNSHIP_PER_WAVE * mult, GUNSHIP_MAX);
  const eliteTarget = Math.min(ENEMY_TOTAL * mult, 32);
  let enemyElites = fighters.filter((f) => f.faction === 'enemy').length;
  while (enemyElites < eliteTarget) { spawnFighter('enemy', enemyElites, eliteTarget); enemyElites++; }
  waveEnemyTotal = enabledEnemySwarm + eliteTarget + enabledGunships;
  el('killTotal').textContent = waveEnemyTotal;
  for (let i = 0; i < GUNSHIP_MAX; i++) {
    if (i < enabledGunships) { if (!gunships[i].alive) resetSwarmShip(gunships[i], true); }
    else gunships[i].alive = false;
  }
  respawnEnemyCapital();
  for (const f of fighters) if (!f.alive) reviveFighter(f);
  let enemyIdx = 0;
  for (const s of swarm) {
    if (s.isGunship) continue; // las cañoneras ya se repusieron arriba
    if (s.faction === 'ally') {
      if (!s.alive) resetSwarmShip(s, true);
    } else {
      if (enemyIdx < enabledEnemySwarm && !s.alive) resetSwarmShip(s, true);
      enemyIdx++;
    }
  }
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

/* -------------------- misiles guiados (click derecho) --------------------
   FIJACIÓN POR CARGA: mantén la mira sobre un enemigo ~1 s para fijarlo
   (anillo de progreso en la mira); solo con fijación completa sale el misil,
   y entonces SÍ persigue. Sin fijación, el disparador avisa y no gasta. */
const missiles = [];
let missileAmmo = 8, missileCooldown = 0;
let lockTarget = null, lockProgress = 0, lockGrace = 0, lockAnnounced = false;
const enemyCapEntity = { obj: enemyCapital, isCapital: true, get alive() { return capitals.enemy.alive; } };
const LOCK_TIME = 1.05;

function lockCandidateOk(e, coneDeg, maxDist) {
  tv1.copy(e.obj.position).sub(ship.position);
  const d = tv1.length();
  if (d > maxDist) return false;
  fwd.set(0, 0, 1).applyQuaternion(ship.quaternion);
  return tv1.normalize().dot(fwd) > Math.cos(THREE.MathUtils.degToRad(coneDeg));
}
function updateLock(dt) {
  if (player.dead || !started) { lockTarget = null; lockProgress = 0; lockAnnounced = false; return; }
  // el objetivo actual conserva la fijación mientras siga en el cono (con gracia corta)
  // el bando puede cambiar con la fijación ya hecha (alguien se cambia de equipo,
  // o el anfitrión pasa a modo equipos): hay que revalidarlo, no solo el cono
  if (lockTarget && lockTarget.isPilot && isFriendly(lockTarget.id)) {
    lockTarget = null; lockProgress = 0; lockAnnounced = false;
  }
  if (lockTarget && lockTarget.alive
      && lockCandidateOk(lockTarget, lockTarget.isCapital ? 18 : 14, lockTarget.isCapital ? 3200 : 1600)) {
    lockGrace = 0.45;
    if (lockProgress < 1) {
      lockProgress = Math.min(1, lockProgress + dt / LOCK_TIME);
      if (lockProgress >= 1 && !lockAnnounced) { lockAnnounced = true; sfxLock(); message('TARGET LOCKED — FIRE MISSILE'); }
    }
    return;
  }
  if (lockTarget) {
    lockGrace -= dt;
    if (lockGrace > 0 && lockTarget.alive) return; // gracia: un quiebro no borra la fijación
    lockTarget = null; lockProgress = 0; lockAnnounced = false;
  }
  // nuevo candidato: el enemigo más alineado con la mira
  fwd.set(0, 0, 1).applyQuaternion(ship.quaternion);
  let best = null, bestDot = Math.cos(THREE.MathUtils.degToRad(14));
  const consider = (e, maxDist) => {
    tv1.copy(e.obj.position).sub(ship.position);
    const d = tv1.length();
    if (d > maxDist) return;
    const dot = tv1.normalize().dot(fwd);
    if (dot > bestDot) { bestDot = dot; best = e; }
  };
  for (const f of fighters) if (f.alive && f.faction === 'enemy') consider(f, 1600);
  for (const s of swarm) if (s.alive && s.faction === 'enemy') consider(s, 1600);
  // otros jugadores: fijables como cualquier enemigo (en equipos, los tuyos no)
  for (const rp of remotePilots) if (rp.alive && !isFriendly(rp.id)) consider(rp, 1600);
  if (!best && capitals.enemy.alive && lockCandidateOk(enemyCapEntity, 18, 3200)) best = enemyCapEntity;
  if (best) { lockTarget = best; lockProgress = dt / LOCK_TIME; lockGrace = 0.45; lockAnnounced = false; }
}
const missileGeo = new THREE.BoxGeometry(0.3, 0.3, 2.2);
const missileMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
const missileFlameTex = radialGlow([1.0, 0.75, 0.4], 0.32);

function launchMissile() {
  if (!started || player.dead || missileAmmo <= 0 || missileCooldown > 0) return;
  // sin fijación completa no hay misil: apunta y deja que la mira cargue
  if (!(lockTarget && lockTarget.alive && lockProgress >= 1)) {
    message('NO LOCK — HOLD AIM ON TARGET');
    return;
  }
  const target = lockTarget;
  missileCooldown = 1.1;
  missileAmmo--;
  if (hud.missiles) hud.missiles.textContent = missileAmmo;
  fwd.set(0, 0, 1).applyQuaternion(ship.quaternion);

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
    mesh: m, target, faction: 'ally',
    vel: fwd.clone().multiplyScalar(Math.max(90, player.vel.length() + 50)),
    life: 9,
  });
  message('MISSILE AWAY');
  sfxMissile();
}

/* misil de cañonera enemiga: más lento y de giro más blando que el tuyo —
   se puede esquivar volando en tangente, pero si conecta rompe el escudo */
const enemyMissileMat = new THREE.MeshBasicMaterial({ color: 0xffd0b0 });
const enemyMissileFlameTex = radialGlow([1.0, 0.55, 0.35], 0.32);
function launchEnemyMissile(origin, target) {
  if (!target || !target.alive) return;
  const m = new THREE.Mesh(missileGeo, enemyMissileMat);
  m.position.copy(origin);
  const dir = tv3.copy(target.obj.position).sub(origin).normalize();
  m.quaternion.setFromUnitVectors(zAxis, dir);
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({
    map: enemyMissileFlameTex, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flame.scale.setScalar(2.2);
  flame.position.z = -1.4;
  m.add(flame);
  scene.add(m);
  missiles.push({
    mesh: m, target, faction: 'enemy',
    vel: dir.clone().multiplyScalar(80),
    life: 9, turn: 1.7, maxSpeed: 150,
  });
  if (target.isPlayer) { message('MISSILE INBOUND — EVADE'); sfxMissile(); }
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
  addShake(center.distanceTo(ship.position) < 4000 ? 1.5 : 0.6); // 2,6 km de nave reventando
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

/* ========================= MULTIJUGADOR (P2P) =========================
   Estrella con anfitrión: él simula la flota de NPC y las capitales y reparte
   instantáneas; cada jugador manda SU vuelo (validarlo en el anfitrión daría
   goma elástica) y quien dispara resuelve sus propios impactos contra otros
   jugadores, que es lo que se siente honesto con 100 ms de latencia. */
const remotePilots = [];              // { id, name, obj, vel, alive, hull, kills, deaths, prev, next, t }
const pilotTint = [0x7fe7ff, 0xffc46f, 0x9dff7f, 0xff8fd0, 0xc9a0ff, 0xffe97f, 0x7fffe0, 0xff9f7f];
let mpActive = false, netSendT = 0, snapT = 0, snapSeq = 0;

const TEAM_COLOR = { blue: 0x4fb4ff, red: 0xff5a3c };
// en partida por equipos manda el color del bando; en todos contra todos, el suyo
function pilotColor(id, idx) {
  if (net.mode !== 'teams') return pilotTint[idx % pilotTint.length];
  return TEAM_COLOR[net.players.get(id)?.team === 'red' ? 'red' : 'blue'];
}
function tintPilot(rp) {
  const c = new THREE.Color(pilotColor(rp.id, rp.idx));
  rp.obj.traverse((o) => {
    if (!o.isMesh || !o.material.emissive) return;
    const n = o.material.name || '';
    if (n.includes('Emissive') || n.includes('EngineCore')) o.material.emissive.copy(c);
  });
}
/* cada piloto remoto vuela el casco que eligió: se descarga una sola vez y
   se comparte entre todos los que lleven el mismo */
function dressRemotePilot(rp) {
  const spec = SHIPS.find((s) => s.id === (net.players.get(rp.id)?.ship || 'kit')) || SHIPS[0];
  if (rp.shipId === spec.id) return;
  rp.shipId = spec.id;
  const swap = (src) => {
    if (rp.shipId !== spec.id) return;           // llegó tarde: ya eligió otra
    if (rp.body) rp.obj.remove(rp.body);
    for (const m of rp.kitMeshes) m.visible = !src;
    if (src) {
      rp.body = src.clone();
      rp.body.rotation.y = THREE.MathUtils.degToRad(spec.yaw || 0);
      rp.obj.add(rp.body);
    } else rp.body = null;
    tintPilot(rp);
  };
  if (!spec.file) { swap(null); return; }
  if (shipCache.has(spec.id)) { swap(shipCache.get(spec.id)); return; }
  new GLTFLoader().load(spec.file, (g) => { shipCache.set(spec.id, g.scene); swap(g.scene); },
    undefined, () => swap(null));
}
function makeRemotePilot(id, name, idx) {
  const obj = allyTemplate.clone();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.material.name || '';
    if (n.includes('Emissive') || n.includes('EngineCore')) o.material = o.material.clone();
  });
  scene.add(obj);
  const rp = {
    id, name, obj, idx, alive: true, hull: 100,
    vel: new THREE.Vector3(), kills: 0, deaths: 0,
    prevPos: obj.position.clone(), nextPos: obj.position.clone(),
    prevQ: obj.quaternion.clone(), nextQ: obj.quaternion.clone(),
    lerpT: 1, faction: 'ally', isPilot: true,
  };
  rp.kitMeshes = [];
  obj.traverse((o) => { if (o.isMesh) rp.kitMeshes.push(o); });
  rp.body = null;
  remotePilots.push(rp);
  tintPilot(rp);
  dressRemotePilot(rp);
  return rp;
}
// bandos: mismo color, sin fuego amigo
function teamOf(id) { return net.players.get(id)?.team === 'red' ? 'red' : 'blue'; }
function isFriendly(id) { return net.mode === 'teams' && teamOf(id) === teamOf(net.self); }
function pilotById(id) { return remotePilots.find((p) => p.id === id); }
function removeRemotePilot(id) {
  const i = remotePilots.findIndex((p) => p.id === id);
  if (i < 0) return;
  scene.remove(remotePilots[i].obj);
  remotePilots.splice(i, 1);
}

/* ---------------- instantánea de la flota (anfitrión → invitados) ----------------
   Solo posición: los cazas del enjambre se orientan en el invitado según su
   propio desplazamiento, que es hacia dónde vuelan igualmente. 8 bytes por nave
   en vez de los ~60 que costaría en JSON. */
/* Instantánea POR JUGADOR. Mandar la flota entera a todo el mundo costaba el
   92% del tráfico, y la mayoría son naves a kilómetros que ocupan dos píxeles.
   Ahora:
     · quién vive va en un mapa de bits (1 bit por nave): las bajas llegan
       siempre y al instante, aunque no se mande su posición;
     · las posiciones se priorizan por cercanía a ESE jugador — cerca en cada
       envío, media distancia por turnos, y muy lejos ni se molesta.
   El mapa de bits es imprescindible: antes "no venir en la lista" significaba
   "ha muerto", y con envíos parciales eso mataría media flota. */
const NEAR_R2 = 900 * 900, MID_R2 = 2500 * 2500;
let farPhase = 0;
function encodeFleetFor(eye) {
  const bits = Math.ceil(swarm.length / 8);
  const pos = [];
  for (let i = 0; i < swarm.length; i++) {
    const s = swarm[i];
    if (!s.alive) continue;
    const d2 = s.obj.position.distanceToSquared(eye);
    if (d2 < NEAR_R2) pos.push(i);                       // a la vista: siempre
    else if (d2 < MID_R2 && (i & 3) === farPhase) pos.push(i); // por turnos
  }
  const heroes = [];
  for (let i = 0; i < fighters.length; i++) if (fighters[i].alive) heroes.push(i);
  const buf = new ArrayBuffer(7 + bits + 2 + pos.length * 8 + 1 + heroes.length * 7 + 11);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, 2); o += 1;                       // formato 2
  v.setUint32(o, snapSeq, true); o += 4;
  v.setUint16(o, swarm.length, true); o += 2;
  for (let b = 0; b < bits; b++) {                // vivos/muertos
    let byte = 0;
    for (let k = 0; k < 8; k++) {
      const i = b * 8 + k;
      if (i < swarm.length && swarm[i].alive) byte |= 1 << k;
    }
    v.setUint8(o + b, byte);
  }
  o += bits;
  v.setUint16(o, pos.length, true); o += 2;
  for (const i of pos) {
    v.setUint16(o, i, true); o += 2;
    o = writePos(v, o, swarm[i].obj.position);
  }
  v.setUint8(o, heroes.length); o += 1;
  for (const i of heroes) {                        // sin cuaternión: el invitado
    v.setUint8(o, i); o += 1;                      // los orienta por su avance
    o = writePos(v, o, fighters[i].obj.position);
  }
  v.setUint16(o, Math.max(0, capitals.ally.hp), true); o += 2;
  v.setUint16(o, Math.max(0, capitals.enemy.hp), true); o += 2;
  v.setUint8(o, (capitals.ally.alive ? 1 : 0) | (capitals.enemy.alive ? 2 : 0)); o += 1;
  v.setUint16(o, kills, true); o += 2;
  v.setUint16(o, waveEnemyTotal, true); o += 2;
  return buf;
}
function decodeFleet(buf) {
  const v = new DataView(buf);
  let o = 0;
  if (v.getUint8(o) !== 2) return; // formato desconocido
  o += 1;
  const seq = v.getUint32(o, true); o += 4;
  if (seq < snapSeq) return; // instantánea vieja adelantada por la red
  snapSeq = seq;
  const total = v.getUint16(o, true); o += 2;
  const bits = Math.ceil(total / 8);
  for (let i = 0; i < total && i < swarm.length; i++) {   // vivos según el mapa
    const alive = (v.getUint8(o + (i >> 3)) >> (i & 7)) & 1;
    swarm[i].alive = !!alive;
  }
  o += bits;
  const n = v.getUint16(o, true); o += 2;
  for (let k = 0; k < n; k++) {
    const i = v.getUint16(o, true); o += 2;
    const s = swarm[i];
    if (!s) { o += 6; continue; }
    o = readPos(v, o, tv2);
    if (!s.netTo) { s.netTo = new THREE.Vector3().copy(tv2); s.obj.position.copy(tv2); }
    else s.netTo.copy(tv2);   // destino: el bucle interpola hacia él
  }
  const hn = v.getUint8(o); o += 1;
  const seenH = new Set();
  for (let k = 0; k < hn; k++) {
    const i = v.getUint8(o); o += 1;
    const f = fighters[i];
    if (!f) { o += 6; continue; }
    o = readPos(v, o, tv2);
    if (!f.netTo) { f.netTo = new THREE.Vector3().copy(tv2); f.obj.position.copy(tv2); }
    else f.netTo.copy(tv2);
    if (!f.alive) { f.alive = true; scene.add(f.obj); }
    seenH.add(i);
  }
  for (let i = 0; i < fighters.length; i++) {
    if (!seenH.has(i) && fighters[i].alive) { fighters[i].alive = false; scene.remove(fighters[i].obj); }
  }
  capitals.ally.hp = v.getUint16(o, true); o += 2;
  capitals.enemy.hp = v.getUint16(o, true); o += 2;
  const flags = v.getUint8(o); o += 1;
  for (const [cap, bit] of [[capitals.ally, 1], [capitals.enemy, 2]]) {
    const alive = !!(flags & bit);
    if (!alive && cap.alive) { cap.alive = false; cap.dying = 4.2; }
    if (cap.bar) cap.bar.style.width = `${Math.max(0, (cap.hp / cap.maxHp) * 100)}%`;
  }
  kills = v.getUint16(o, true); o += 2;
  waveEnemyTotal = v.getUint16(o, true); o += 2;
  hud.kills.textContent = kills;
  el('killTotal').textContent = waveEnemyTotal;
}
const zeroV = new THREE.Vector3();

/* -------------------- envío y recepción por fotograma -------------------- */
function netTick(dt) {
  if (!mpActive) return;
  netSendT -= dt;
  if (netSendT <= 0) {
    netSendT = 1 / 20; // 20 Hz: suficiente con interpolación
    netSend({
      t: 'p',
      p: [+ship.position.x.toFixed(1), +ship.position.y.toFixed(1), +ship.position.z.toFixed(1)],
      q: [+ship.quaternion.x.toFixed(3), +ship.quaternion.y.toFixed(3), +ship.quaternion.z.toFixed(3), +ship.quaternion.w.toFixed(3)],
      h: Math.round(player.hull), d: player.dead ? 1 : 0,
    });
  }
  if (net.role === 'host') {
    snapT -= dt;
    if (snapT <= 0) {
      snapT = 1 / 6;                 // 6 Hz: con interpolación no se nota menos
      snapSeq++;
      farPhase = (farPhase + 1) & 3; // rota qué naves de media distancia tocan
      for (const [id] of net.peers) {
        const rp = pilotById(id);
        sendTo(id, encodeFleetFor(rp ? rp.obj.position : ship.position));
      }
    }
  } else if (net.role === 'guest') {
    // la flota llega a 6 Hz: interpolar para que se vea continua
    const k = 1 - Math.exp(-9 * dt);
    for (const s of swarm) {
      if (!s.alive || !s.netTo) continue;
      tv1.copy(s.netTo).sub(s.obj.position);
      if (tv1.lengthSq() > 0.02) {
        lookM.lookAt(tv1, zeroV, s.obj.up);   // mirar hacia donde avanza
        s.obj.quaternion.slerp(lookQ.setFromRotationMatrix(lookM), Math.min(1, k * 1.5));
      }
      s.obj.position.lerp(s.netTo, k);
    }
    for (const f of fighters) {
      if (!f.alive || !f.netTo) continue;
      tv1.copy(f.netTo).sub(f.obj.position);
      if (tv1.lengthSq() > 0.02) {
        lookM.lookAt(tv1, zeroV, f.obj.up);
        f.obj.quaternion.slerp(lookQ.setFromRotationMatrix(lookM), Math.min(1, k * 1.5));
      }
      f.obj.position.lerp(f.netTo, k);
    }
  }
  // interpolación de los pilotos remotos entre instantáneas
  for (const rp of remotePilots) {
    rp.lerpT = Math.min(1, rp.lerpT + dt * 20);
    rp.obj.position.lerpVectors(rp.prevPos, rp.nextPos, rp.lerpT);
    rp.obj.quaternion.slerpQuaternions(rp.prevQ, rp.nextQ, rp.lerpT);
    rp.obj.visible = rp.alive;
  }
}

function onNetMessage(from, d) {
  if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) {
    if (net.role === 'guest') decodeFleet(d.buffer || d);
    return;
  }
  switch (d.t) {
    case 'p': { // estado de vuelo de un piloto
      // el anfitrión reenvía marcando el autor: sin esto, con 3+ jugadores el
      // receptor atribuiría todo al anfitrión y verías un solo piloto
      const src = d.from || from;
      if (src === net.self) return;
      const rp = pilotById(src) || (net.players.has(src)
        ? makeRemotePilot(src, net.players.get(src).name, [...net.players.keys()].indexOf(src)) : null);
      if (!rp) return;
      const info = net.players.get(src); // el nombre y el bando pueden haber cambiado
      if (info && info.name !== rp.name) rp.name = info.name;
      rp.prevPos.copy(rp.obj.position);
      rp.nextPos.set(d.p[0], d.p[1], d.p[2]);
      rp.prevQ.copy(rp.obj.quaternion);
      rp.nextQ.set(d.q[0], d.q[1], d.q[2], d.q[3]);
      rp.lerpT = 0;
      rp.hull = d.h;
      rp.alive = !d.d;
      if (net.role === 'host') netSend({ ...d, from }, from); // el anfitrión reparte
      break;
    }
    case 'shot': { // disparo ajeno: solo visual
      if ((d.from || from) === net.self) return;
      tv1.set(d.o[0], d.o[1], d.o[2]);
      tv2.set(d.v[0], d.v[1], d.v[2]);
      fireLaser(tv1.clone(), tv2.normalize().clone(), 350, 'ally');
      if (net.role === 'host') netSend({ ...d, from }, from);
      break;
    }
    case 'hit': { // alguien dice que te ha dado (quien dispara resuelve)
      // segundo cerrojo del fuego amigo: si el mensaje llega igualmente
      // (paquete en vuelo al cambiar de bando), aquí se descarta
      if (d.to === net.self && isFriendly(d.from || from)) return;
      if (d.to === net.self) { damagePlayer(d.dmg); if (player.dead) netSend({ t: 'died', by: d.from || from }); }
      else if (net.role === 'host') netSend(d, from);
      break;
    }
    case 'died': {
      const victim = net.players.get(d.from || from);
      const killer = net.players.get(d.by);
      if (killer) killer.kills = (killer.kills || 0) + 1;
      if (victim) victim.deaths = (victim.deaths || 0) + 1;
      message(`${killer ? killer.name : 'SOMEONE'} DOWNED ${victim ? victim.name : 'A PILOT'}`);
      if (net.role === 'host') { netSend({ ...d, from: d.from || from }, from); broadcastLobby(); }
      drawScore();
      break;
    }
    default: break;
  }
}

// tu disparo contra otro jugador lo resuelves tú y le mandas el daño
function netHitPilot(rp, dmg) {
  netSend({ t: 'hit', to: rp.id, dmg, from: net.self });
  flash(rp.obj.position, true, 5, 0.2);
}

function drawScore() {
  const box = el('score');
  if (!mpActive) { box.style.display = 'none'; return; }
  const row = (p) => {
    const me = p.id === net.self ? ' me' : '';
    const rp = pilotById(p.id);
    const dead = (p.id !== net.self && rp && !rp.alive) || (p.id === net.self && player.dead) ? ' dead' : '';
    return `<div class="${me}${dead}">${p.name} <b>${p.kills || 0}</b>/${p.deaths || 0}</div>`;
  };
  const all = [...net.players.values()].sort((a, b) => (b.kills || 0) - (a.kills || 0));
  if (net.mode !== 'teams') { box.innerHTML = all.map(row).join(''); return; }
  // por equipos: cada bando con su total arriba
  const parts = [];
  for (const [team, cls] of [['blue', 'tBlue'], ['red', 'tRed']]) {
    const side = all.filter((p) => (p.team === 'red' ? 'red' : 'blue') === team);
    if (!side.length) continue;
    const pts = side.reduce((s, p) => s + (p.kills || 0), 0);
    parts.push(`<div class="${cls} head">${team.toUpperCase()} <b>${pts}</b></div>` + side.map(row).join(''));
  }
  box.innerHTML = parts.join('<div class="gap"></div>');
}

/* al caer en multijugador vuelves al hangar: 3 s de espera y otra vez dentro */
let respawnT = 0;
function respawnPlayer() {
  player.dead = true;
  ship.visible = false;
  flash(ship.position, true, 34, 0.8);
  sfxExplosion(2.2, 1);
  addShake(1.2);
  respawnT = 3;
  const me = net.players.get(net.self);
  if (me) { me.deaths = (me.deaths || 0) + 1; if (net.role === 'host') broadcastLobby(); }
  message('SHIP LOST — RESPAWNING');
  drawScore();
}
function respawnTick(dt) {
  if (!mpActive || respawnT <= 0) return;
  respawnT -= dt;
  if (respawnT > 0) return;
  const home = capitals.ally.alive ? capitals.ally.group.position : new THREE.Vector3(-500, -140, -1100);
  ship.position.set(home.x + (Math.random() - 0.5) * 300, home.y + 200, home.z + 380);
  ship.quaternion.identity();
  player.vel.set(0, 0, 0);
  player.angVel.set(0, 0, 0);
  player.hull = 100;
  player.shield = 100;
  player.dead = false;
  ship.visible = true;
  missileAmmo = 8;
  if (hud.missiles) hud.missiles.textContent = missileAmmo;
  message('BACK IN THE FIGHT');
  drawScore();
}

/* ------------------------------ sala ------------------------------ */
function lobbyRefresh() {
  const teams = net.mode === 'teams';
  const list = el('playerList');
  const entries = [...net.players.values()];
  const sorted = teams
    ? entries.slice().sort((a, b) => (a.team === 'red' ? 1 : 0) - (b.team === 'red' ? 1 : 0))
    : entries;
  list.innerHTML = sorted.map((p) => {
    const side = teams ? (p.team === 'red' ? 'red' : 'blue') : '';
    const badge = teams ? (p.team === 'red' ? '◆ ' : '◆ ') : '';
    return `<li class="${p.ready ? 'ready' : ''} ${p.id === net.self ? 'me' : ''} ${side}">`
      + `${p.ready ? '✓' : '·'} ${badge}${p.name}${p.id === net.id ? ' (host)' : ''}</li>`;
  }).join('');
  const n = net.players.size;
  el('lobbyStatus').textContent = net.role === 'host'
    ? `${n}/8 pilots · ${teams ? 'teams — no friendly fire' : 'free for all'}`
    : `${n}/8 pilots · ${teams ? 'teams' : 'free for all'} · waiting for the host`;
  el('lobbyGo').textContent = net.role === 'host' ? 'LAUNCH' : (net.players.get(net.self)?.ready ? 'NOT READY' : 'READY');
  // el modo y la visibilidad los elige el anfitrión; el bando, cada uno
  el('modeRow').style.display = net.role === 'host' ? 'flex' : 'none';
  el('privacyRow').style.display = net.role === 'host' ? 'flex' : 'none';
  el('modeFfa').classList.toggle('on', !teams);
  el('modeTeams').classList.toggle('on', teams);
  el('teamRow').classList.toggle('hidden', !teams);
  el('teamBlue').classList.toggle('on', net.team !== 'red');
  el('teamRed').classList.toggle('on', net.team === 'red');
  drawScore();
}

function beginMultiplayer() {
  mpActive = true;
  stat('play'); stat('mp');   // aquí no se pasa por ENTER COCKPIT
  document.body.classList.add('mp');
  el('lobby').classList.add('hidden');
  document.getElementById('start').classList.add('hidden');
  // separar las salidas para que no aparezcan unos dentro de otros
  const idx = [...net.players.keys()].indexOf(net.self);
  ship.position.set(-80 + idx * 55, 60 + (idx % 3) * 30, -650 - (idx % 2) * 40);
  // ojo: al invitado le llega por la red, sin gesto suyo, así que el contexto
  // puede nacer suspendido — enterAudio() deja armado el desbloqueo al primer toque
  enterAudio();
  lockLandscape();
  lockPointer();
  started = true;
  cgPlaying(true);
  cgRoomClosed(); // arrancada la partida ya no entra nadie: fuera el botón de invitar
  drawScore();
  message(`${net.players.size} PILOTS IN THE FIELD`);
}

function wireLobby() {
  // `asHost` decide los mandos que solo tiene el anfitrión (modo de partida y
  // visibilidad de la sala): sin esto el invitado los veía hasta que llegaba la
  // primera lista del anfitrión, y parecía que podía cambiarlos
  const show = (title, hint, link, asHost) => {
    // se puede llegar a la sala sin pasar por BACK (enlace ?room=, invitación de
    // CrazyGames): si no se cierra aquí, la lista pública se queda sondeando
    // por debajo durante toda la partida
    closeRooms();
    el('lobbyTitle').textContent = title;
    el('lobbyHint').textContent = hint;
    el('lobbyStatus').textContent = '';   // no arrastrar el error de la sesión anterior
    el('linkRow').classList.toggle('hidden', !link);
    el('modeRow').style.display = asHost ? 'flex' : 'none';
    el('privacyRow').style.display = asHost ? 'flex' : 'none';
    el('lobby').classList.remove('hidden');
    document.getElementById('start').classList.add('hidden');
  };
  const nameOf = () => (el('nameBox').value || 'PILOT').toUpperCase().slice(0, 12);
  // al llegar la lista, refrescar nombres y colores de los que ya vuelan
  net.onLobby = () => {
    for (const rp of remotePilots) {
      const info = net.players.get(rp.id);
      if (info) { rp.name = info.name; tintPilot(rp); dressRemotePilot(rp); }
    }
    lobbyRefresh();
  };
  net.onMessage = onNetMessage;
  diag.onLog = () => { const b = el('netLog'); b.textContent = diag.log.join('\n'); b.scrollTop = b.scrollHeight; };

  /* Prueba de conexión: dice si el problema es tu red o la sala.
     1) ¿funciona WebRTC en este navegador? (bucle local)
     2) ¿se alcanzan los servidores STUN/TURN? (qué candidatos aparecen) */
  el('diagBtn').onclick = async () => {
    diag.log.length = 0;
    const say = (m) => { diag.log.push(m); diag.onLog(); };
    say('— connection test —');
    await refreshTurn(); // el propio test dice si el relé responde
    const kinds = new Set();
    let mdns = false;
    try {
      const cfg = iceConfig();
      const pc = new RTCPeerConnection(cfg);
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        kinds.add(e.candidate.type);
        // Chrome oculta tu IP local tras un nombre .local: si el otro extremo
        // no puede resolverlo, la vía directa muere y solo queda el relé
        if (e.candidate.type === 'host' && /[0-9a-f-]{30,}\.local/i.test(e.candidate.candidate)) mdns = true;
      };
      pc.createDataChannel('x');
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((res) => setTimeout(res, 7000));
      pc.close();
      say(`WebRTC: ${kinds.size ? 'funciona ✓' : 'sin candidatos ✗ (bloqueado por extensión, VPN o política)'}`);
      say(`candidatos: ${[...kinds].join(', ') || 'ninguno'}`);
      say(`  host  ${kinds.has('host') ? '✓' : '✗'}  red local${mdns ? ' (oculta tras mDNS)' : ''}`);
      say(`  srflx ${kinds.has('srflx') ? '✓' : '✗'}  STUN alcanzable`);
      say(`  relay ${kinds.has('relay') ? '✓' : '✗'}  relé TURN alcanzable`);
      say('');
      if (kinds.has('relay')) say('VEREDICTO: debería conectar en cualquier red ✓');
      else if (kinds.has('srflx')) {
        say('VEREDICTO: sin relé TURN. Conectará entre redes domésticas');
        say('permisivas, pero fallará tras NAT estricta o cortafuegos de');
        say('empresa. Pega un TURN abajo para que funcione siempre.');
      } else say('VEREDICTO: tu red no deja salir WebRTC ✗');
    } catch (e) { say('fallo al sondear: ' + e); }
  };

  /* Ajustes de relé: la clave de Metered va en el código (los invitados también
     la necesitan), pero se puede corregir aquí sin volver a desplegar. */
  const turnBox = el('turnBox');
  const keyBox = el('turnKeyBox');
  try { keyBox.value = localStorage.getItem('sb_turn_key') || ''; } catch { /* modo privado */ }
  turnBox.value = getTurn().map((s) => `${s.urls}|${s.username}|${s.credential}`).join('\n');
  el('saveTurnBtn').onclick = async () => {
    setTurn(turnBox.value);
    try {
      const k = keyBox.value.trim();
      if (k) localStorage.setItem('sb_turn_key', k); else localStorage.removeItem('sb_turn_key');
    } catch { /* modo privado */ }
    diag.log.length = 0;
    await refreshTurn();
    diag.onLog();
    el('lobbyStatus').textContent = 'Saved — run TEST CONNECTION to check the relay';
  };
  net.onStart = () => beginMultiplayer();
  net.onLeave = (id) => { removeRemotePilot(id); drawScore(); };
  net.onError = (msg) => { el('lobbyStatus').textContent = msg; };

  el('hostBtn').onclick = async () => {
    show('HOSTING', 'Share this link with your friends. Up to 8 pilots.', true, true);
    try {
      const id = await hostGame(nameOf());
      // en CrazyGames el enlace debe ser el suyo: abre el juego en su web y
      // además avisa a tus amigos de que tienes sala abierta
      const url = cgInviteLink(id) || `${location.origin}${location.pathname}?room=${id}`;
      cgRoomOpen(id);
      el('linkBox').value = url;
      el('lobbyHint').textContent = 'Share this link. Keep THIS tab open — you are the host.';
      announceRoom(true); // aparecer ya en PUBLIC GAMES, sin esperar al latido
      lobbyRefresh();
    } catch { el('lobbyStatus').textContent = 'Could not open the room'; }
  };
  el('joinBtn').onclick = () => {
    const room = prompt('Room code or link:');
    if (room) joinRoom(room.includes('room=') ? room.split('room=')[1].split(/[&#]/)[0] : room.trim());
  };

  /* -------- salas públicas --------
     P2P no tiene servidor de partida al que preguntar quién está jugando, así
     que los anfitriones se anuncian en /api/rooms y aquí se lee ese tablón. Se
     refresca solo cada 10 s mientras la pantalla está a la vista; al salir, el
     temporizador se apaga para no llamar al servidor de fondo. */
  let roomsTimer = null;
  async function paintRooms() {
    const list = el('roomList');
    const { rooms, disabled } = await listRooms();
    if (disabled) {
      el('roomsHint').textContent = 'The public room list is not available right now — '
        + 'you can still host and share the link, or join by code.';
      list.innerHTML = '<li class="empty">— LIST OFFLINE —</li>';
      return;
    }
    el('roomsHint').textContent = rooms.length
      ? 'Open rooms waiting for pilots. Pick one to jump in.'
      : 'No open rooms right now. Host one and your friends will see it here.';
    list.innerHTML = rooms.length
      ? rooms.map((r) => {
        const full = r.players >= r.max;
        return `<li class="${full ? 'full' : ''}" data-room="${r.id}">`
          + `<span class="rname">${r.name}'S GAME</span>`
          + `<span class="rmode">${r.mode === 'teams' ? 'TEAMS' : 'FREE FOR ALL'}</span>`
          + `<span class="rcount">${r.players}/${r.max}</span></li>`;
      }).join('')
      : '<li class="empty">— NO OPEN ROOMS —</li>';
  }
  // declarada como función, no como const: `show()` la usa y está definida antes
  function closeRooms() {
    clearInterval(roomsTimer); roomsTimer = null;
    el('rooms').classList.add('hidden');
  }
  const roomsOpen = () => !el('rooms').classList.contains('hidden');
  const pollRooms = () => {
    clearInterval(roomsTimer);
    roomsTimer = setInterval(paintRooms, 12000);
  };
  el('browseBtn').onclick = () => {
    el('rooms').classList.remove('hidden');
    document.getElementById('start').classList.add('hidden');
    el('roomList').innerHTML = '<li class="empty">— SCANNING —</li>';
    paintRooms();
    pollRooms();
  };
  // una pestaña olvidada en segundo plano no tiene por qué seguir preguntando
  document.addEventListener('visibilitychange', () => {
    if (!roomsOpen()) return;
    if (document.hidden) { clearInterval(roomsTimer); roomsTimer = null; }
    else { paintRooms(); pollRooms(); }
  });
  el('roomsRefresh').onclick = paintRooms;
  el('roomsBack').onclick = () => {
    closeRooms();
    document.getElementById('start').classList.remove('hidden');
  };
  el('roomList').onclick = (e) => {
    const li = e.target.closest('li[data-room]');
    if (!li || li.classList.contains('full')) return;
    closeRooms();
    if (!el('nameBox').value) el('nameBox').value = 'PILOT ' + Math.floor(Math.random() * 90 + 10);
    joinRoom(li.dataset.room);
  };
  const setPrivacy = (pub) => {
    setPublic(pub);
    el('roomPublic').classList.toggle('on', pub);
    el('roomPrivate').classList.toggle('on', !pub);
    el('lobbyHint').textContent = pub
      ? 'Listed in PUBLIC GAMES — anyone can drop in. Keep THIS tab open.'
      : 'Private: only this link gets people in. Keep THIS tab open.';
  };
  el('roomPublic').onclick = () => setPrivacy(true);
  el('roomPrivate').onclick = () => setPrivacy(false);
  el('copyBtn').onclick = () => {
    el('linkBox').select();
    navigator.clipboard?.writeText(el('linkBox').value);
    el('copyBtn').textContent = 'COPIED';
    setTimeout(() => { el('copyBtn').textContent = 'COPY'; }, 1200);
  };
  el('lobbyGo').onclick = () => {
    if (net.role === 'host') startMatch(1);
    else { const me = net.players.get(net.self); setReady(!(me && me.ready)); }
  };
  // el nombre viaja en cuanto lo cambias (antes solo se enviaba al entrar)
  el('nameBox').oninput = () => { if (net.role !== 'solo') setName(el('nameBox').value); };

  /* -------- carrusel de naves con vista 3D --------
     Escena propia y diminuta: así la nave gira sobre fondo limpio sin tocar la
     batalla, y solo dibuja mientras el menú está a la vista. */
  const canvas = el('shipCanvas');
  const pv = {
    renderer: new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }),
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(38, canvas.width / canvas.height, 0.1, 200),
    pivot: new THREE.Group(),
    idx: 0, model: null,
  };
  pv.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  pv.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  pv.renderer.toneMappingExposure = 1.25;
  pv.camera.position.set(0, 4.2, 17);
  pv.camera.lookAt(0, 0, 0);
  pv.scene.environment = envRig.env;
  pv.scene.add(pv.pivot);
  { // mismo rig de luces que la batalla, para que la nave se vea como se verá
    const k = new THREE.DirectionalLight(0xfff8f0, 3.6); k.position.set(6, 5, 8);
    const b = new THREE.DirectionalLight(0x3f6f9a, 1.2); b.position.set(-6, -2, -5);
    const r2 = new THREE.DirectionalLight(0x9fd0e8, 1.1); r2.position.set(-4, 3, -8);
    pv.scene.add(k, b, r2);
  }
  el('shipDots').innerHTML = SHIPS.map(() => '<i></i>').join('');
  const kitPreview = allyTemplate.clone(); // copia intacta del caza del kit para el visor
  window.__sbPreview = pv;                 // gancho de diagnóstico

  function showShip(i, updateGame = true) {
    pv.idx = (i + SHIPS.length) % SHIPS.length;
    const spec = SHIPS[pv.idx];
    el('shipName').textContent = spec.name;
    el('shipInfo').textContent = spec.file && !shipCache.has(spec.id) ? 'loading hull…' : spec.tag;
    [...el('shipDots').children].forEach((d, k) => d.classList.toggle('on', k === pv.idx));
    const place = (src) => {
      if (pv.idx !== SHIPS.indexOf(spec)) return;      // llegó tarde: ya pasó a otra
      if (pv.model) pv.pivot.remove(pv.model);
      pv.model = src.clone();
      pv.model.position.set(0, 0, 0);
      pv.model.rotation.y = THREE.MathUtils.degToRad(spec.yaw || 0);
      // el clon hereda la visibilidad del original: forzarla por si venía oculto
      pv.model.traverse((o) => { o.visible = true; });
      pv.pivot.add(pv.model);
      el('shipInfo').textContent = spec.tag;
    };
    // OJO: para el kit hay que clonar una copia LIMPIA, no la nave del jugador
    // (`ship`), que en ese momento ya lleva puesto el casco elegido antes: por
    // eso al volver atrás se seguía viendo la nave anterior
    if (!spec.file) place(kitPreview);
    else if (shipCache.has(spec.id)) place(shipCache.get(spec.id));
    else new GLTFLoader().load(spec.file, (g) => { shipCache.set(spec.id, g.scene); place(g.scene); },
      undefined, () => { el('shipInfo').textContent = 'could not load this hull'; });
    // setShip recuerda la elección aunque aún no haya sala: si se guardara solo
    // estando conectado, elegir nave antes de crear la partida no llegaría a nadie
    if (updateGame) { applyShip(spec.id); setShip(spec.id); }
  }
  el('shipPrev').onclick = () => showShip(pv.idx - 1);
  el('shipNext').onclick = () => showShip(pv.idx + 1);
  showShip(0, false);

  // bucle propio: solo mientras la pantalla de inicio está visible
  (function spin() {
    requestAnimationFrame(spin);
    if (document.getElementById('start').classList.contains('hidden')) return;
    pv.pivot.rotation.y += 0.008;
    pv.pivot.rotation.x = Math.sin(pv.pivot.rotation.y * 0.5) * 0.09;
    pv.renderer.render(pv.scene, pv.camera);
  })();
  el('modeFfa').onclick = () => setMode('ffa');
  el('modeTeams').onclick = () => setMode('teams');
  const pickTeam = (t) => { setTeam(t); lobbyRefresh(); };
  el('teamBlue').onclick = () => pickTeam('blue');
  el('teamRed').onclick = () => pickTeam('red');
  el('lobbyBack').onclick = () => {
    cgRoomClosed();
    cgRoomLeft();   // cerrar la sala no es salirse de ella: la plataforma
    netLeave();     // necesita las dos cosas para dejar de contarte dentro
    el('lobby').classList.add('hidden');
    document.getElementById('start').classList.remove('hidden');
  };

  async function joinRoom(id) {
    /* Se puede llegar aquí ya siendo anfitrión: CrazyGames avisa de una
       invitación en cualquier momento. Sin cerrar antes lo propio, la sala
       anterior seguiría anunciada y su par seguiría aceptando gente que
       aterrizaría en una partida que ya no existe. */
    if (net.role !== 'solo') { cgRoomClosed(); cgRoomLeft(); netLeave(); }
    show('JOINING', 'Connecting to the host…', false, false);
    try {
      await joinGame(id, nameOf());
      // también el invitado está en la sala: así su botón de invitar sirve
      // para traer a un tercero, que es lo que la plataforma espera
      cgRoomOpen(id);
      lobbyRefresh();
    } catch { el('lobbyStatus').textContent = 'Could not join that room'; }
  }
  /* Entrada automática a una sala, por tres vías:
       · ?room=<id> — el enlace normal
       · invitación de CrazyGames — un amigo te ha invitado
       · instant multiplayer — eres líder de una party: te abren sala al vuelo
     Las dos últimas son requisito suyo para aceptar un juego multijugador. */
  const autoName = () => { el('nameBox').value = 'PILOT ' + Math.floor(Math.random() * 90 + 10); };
  cgInit({
    onJoinRoom: (id) => { autoName(); joinRoom(id); },     // te invitan en caliente
    onMute: setPlatformMute,
  }).then(() => {
    const { room: cgRoom, instant } = cgStartupRoom();
    if (cgRoom) { autoName(); joinRoom(cgRoom); return; }
    if (instant) { autoName(); el('hostBtn').click(); }     // líder de party: sala directa
  });
  const room = new URLSearchParams(location.search).get('room');
  if (room) { autoName(); joinRoom(room); }
}

/* ============================== HUD ============================== */
const el = (id) => document.getElementById(id);
const hud = {
  speed: el('speed'), boost: el('boost'), kills: el('killCount'),
  shield: el('shieldBar').firstElementChild, hull: el('hullBar').firstElementChild,
  msg: el('msg'), allies: el('allyCount'), missiles: el('missileCount'),
  resupply: el('resupply'),
};
el('killTotal').textContent = waveEnemyTotal;
capitals.ally.bar = el('allyCapBar').firstElementChild;
capitals.enemy.bar = el('enemyCapBar').firstElementChild;
let kills = 0, msgTimer = 0;
function message(t) { hud.msg.textContent = t; hud.msg.style.opacity = 1; msgTimer = 2.6; }
// gancho de depuración (consola): estado de la batalla y daño directo a capitales
window.__sb = { capitals, damageCapital, damageFighter, killSwarmShip, launchMissile, damagePlayer, camera, embers, colliders,
  net, encodeFleetFor, decodeFleet, onNetMessage, remotePilots, makeRemotePilot, drawScore, applyShip, SHIPS,
  get shipBody() { return shipBody; },
  set snapSeq(v) { snapSeq = v; }, get snapSeq() { return snapSeq; },
  set mpActive(v) { mpActive = v; }, get mpActive() { return mpActive; }, fighters, swarm, gunships, swarmBatches, ship, touchStick, player, playerEntity, lasers,
  get shake() { return shake; }, get hitMarkT() { return hitMarkT; }, get missileAmmo() { return missileAmmo; }, set missileAmmo(v) { missileAmmo = v; }, get kills() { return kills; }, get t() { return clockTime; }, get audio() { return audio; },
  // por qué no se oye nada, de un vistazo desde la consola
  get audioState() { return { state: audio && audio.ctx.state, wanted: audioWanted, blocked: audioBlocked, unlockArmed, musicFailed, music: !!(audio && (audio.musicTrack || audio.music)) }; }, get flybyCool() { return flybyCool; }, get lock() { return { target: lockTarget, progress: lockProgress }; }, get missiles() { return missiles; }, get waveEnemyTotal() { return waveEnemyTotal; } };

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
  for (const rp of remotePilots) if (rp.alive) radarPlot(rp.obj.position, '#ffffff', true);
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

  /* marca de acierto: cuatro aspas en la mira cuando TU disparo conecta */
  if (hitMarkT > 0) {
    const k = Math.min(1, hitMarkT / 0.16);
    const cx = markC.width / 2, cy = markC.height / 2;
    const r0 = 9 + (1 - k) * 5, r1 = r0 + 8;
    mctx.strokeStyle = `rgba(255,255,255,${0.35 + k * 0.6})`;
    mctx.lineWidth = 2;
    mctx.beginPath();
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      mctx.moveTo(cx + sx * r0, cy + sy * r0);
      mctx.lineTo(cx + sx * r1, cy + sy * r1);
    }
    mctx.stroke();
  }

  mctx.lineWidth = 1.5;
  const mark = (pos, big, heavy) => {
    const d = pos.distanceTo(ship.position);
    // cerca gritan, lejos susurran: 92 hostiles con brackets a tope = muro de ruido
    if (!big && (d > (heavy ? 3600 : 2400) || d < 22)) return;
    tmp.copy(pos).project(camera);
    if (tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05) return;
    const sx = (tmp.x + 1) / 2 * markC.width;
    const sy = (1 - tmp.y) / 2 * markC.height;
    const s = big ? 34 : THREE.MathUtils.clamp((heavy ? 14000 : 6500) / d, heavy ? 9 : 4, heavy ? 40 : 26);
    const alpha = big ? 0.8 : THREE.MathUtils.clamp(1.1 - d / (heavy ? 3600 : 2400), heavy ? 0.3 : 0.12, 0.9);
    mctx.strokeStyle = `rgba(255,90,60,${alpha})`;
    const c = s * 0.4;
    mctx.beginPath();
    mctx.moveTo(sx - s, sy - s + c); mctx.lineTo(sx - s, sy - s); mctx.lineTo(sx - s + c, sy - s);
    mctx.moveTo(sx + s - c, sy - s); mctx.lineTo(sx + s, sy - s); mctx.lineTo(sx + s, sy - s + c);
    mctx.moveTo(sx + s, sy + s - c); mctx.lineTo(sx + s, sy + s); mctx.lineTo(sx + s - c, sy + s);
    mctx.moveTo(sx - s + c, sy + s); mctx.lineTo(sx - s, sy + s); mctx.lineTo(sx - s, sy + s - c);
    mctx.stroke();
    if (big || heavy) {
      mctx.fillStyle = `rgba(255,140,100,${alpha})`;
      mctx.font = '10px monospace';
      mctx.textAlign = 'center';
      mctx.fillText(big ? 'CAPITAL' : 'GUNSHIP', sx, sy - s - 6);
    }
  };
  for (const f of fighters) if (f.alive && f.faction === 'enemy') mark(f.obj.position, false);
  for (const s of swarm) if (s.alive && s.faction === 'enemy') mark(s.obj.position, false, s.isGunship);
  if (capitals.enemy.alive) mark(capitals.enemy.group.position, true);
  // otros pilotos: marco cuadrado con su nombre. Los tuyos en verde para no
  // confundirte a media maniobra; los rivales en blanco (o rojo si son enemigos)
  for (const rp of remotePilots) {
    if (!rp.alive) continue;
    tmp.copy(rp.obj.position).project(camera);
    if (tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05) continue;
    const sx = (tmp.x + 1) / 2 * markC.width, sy = (1 - tmp.y) / 2 * markC.height;
    const s = THREE.MathUtils.clamp(6500 / rp.obj.position.distanceTo(ship.position), 8, 30);
    const friend = isFriendly(rp.id);
    const col = friend ? 'rgba(120,255,170,0.85)'
      : net.mode === 'teams' ? 'rgba(255,110,80,0.9)' : 'rgba(255,255,255,0.85)';
    mctx.strokeStyle = col;
    mctx.lineWidth = 1.5;
    mctx.strokeRect(sx - s, sy - s, s * 2, s * 2);
    mctx.fillStyle = col;
    mctx.font = '10px monospace';
    mctx.textAlign = 'center';
    mctx.fillText(rp.name, sx, sy - s - 6);
  }

  /* fijación de misil: anillo de carga en la mira + rombo sobre el objetivo */
  if (lockTarget) {
    const locked = lockProgress >= 1;
    const cx = markC.width / 2, cy = markC.height / 2;
    mctx.lineWidth = 2.5;
    mctx.strokeStyle = locked ? 'rgba(255,70,50,0.95)' : 'rgba(255,200,90,0.9)';
    mctx.beginPath();
    mctx.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + lockProgress * Math.PI * 2);
    mctx.stroke();
    tmp.copy(lockTarget.obj.position).project(camera);
    if (tmp.z < 1) {
      const sx = (tmp.x + 1) / 2 * markC.width;
      const sy = (1 - tmp.y) / 2 * markC.height;
      const r = locked ? 15 : 10;
      mctx.beginPath();
      mctx.moveTo(sx, sy - r); mctx.lineTo(sx + r, sy);
      mctx.lineTo(sx, sy + r); mctx.lineTo(sx - r, sy);
      mctx.closePath();
      mctx.stroke();
    }
    if (locked) {
      mctx.font = '10px monospace';
      mctx.fillStyle = 'rgba(255,90,60,0.9)';
      mctx.textAlign = 'center';
      mctx.fillText('LOCKED', cx, cy + 48);
    }
  }
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
    addShake(0.9);
  }
  sfxHit();
  // sin escudo el casco encaja el golpe: se nota más
  addShake(THREE.MathUtils.clamp(amount / 45, 0.12, 0.7) * (player.shield > 0 ? 1 : 1.6));
  if (player.hull <= 0) endGame(false);
}
function endGame(victory) {
  if (player.dead) return;
  // en multijugador la muerte no acaba la partida: reapareces en tu capital
  if (mpActive && !victory) { respawnPlayer(); return; }
  player.dead = true;
  if (victory) stat('win');
  // iOS/Safari móvil NO tiene Pointer Lock: llamarla a pelo rompía endGame
  // entero (sin explosión y sin pantalla final — el bug reportado)
  if (document.exitPointerLock) document.exitPointerLock();
  document.getElementById('start').classList.add('hidden');
  if (!victory) {
    // tu nave estalla de verdad: bola de fuego, sonido y el casco desaparece
    flash(ship.position, true, 34, 0.8);
    sfxExplosion(2.2, 1);
    ship.visible = false;
  }
  cgPlaying(false);          // la plataforma sabe que hubo pausa
  if (victory) cgCelebrate();
  el('endTitle').textContent = victory ? 'VICTORY' : 'SHIP LOST';
  el('endText').innerHTML = victory
    ? `Wave ${wave} cleared — all ${waveEnemyTotal} enemy ships destroyed.<br>`
      + (capitals.enemy.alive ? 'The enemy capital withdraws… for now.' : 'Their capital is drifting wreckage.')
      + '<br>Next wave: TWICE the enemies.'
    : 'Your hull gave out. Space is unforgiving.';
  el('nextWaveBtn').classList.toggle('hidden', !victory);
  const show = () => el('end').classList.remove('hidden');
  if (victory) show();
  else setTimeout(show, 1200); // un segundo para ver tu propia explosión
}

/* ============================== bucle ============================== */
const fwd = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();
const lookM = new THREE.Matrix4(), lookQ = new THREE.Quaternion(), bankQ = new THREE.Quaternion();
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
let resupplyT = 0, wasDocked = false;
let clockTime = 0;
/* ---- impacto: sacudida de cámara y marca de acierto ---- */
const camBase = new THREE.Vector3();
let shake = 0, hitMarkT = 0;
function addShake(amount) { shake = Math.min(1.6, shake + amount); }
// una explosión cercana también se siente (cae con la distancia)
function shakeFromBlast(pos, power) {
  const d = pos.distanceTo(ship.position);
  if (d > 320) return;
  addShake(power * (1 - d / 320));
}
const clock = new THREE.Clock();

function update(dt) {
  clockTime += dt;
  const t = clockTime;
  refreshColliders();
  if (audio) {
    // El navegador puede negarse a sonar (autoplay, interrupción del sistema):
    // decirlo, que si no el juego parece roto y no hay manera de adivinarlo. Se
    // mide en reloj de pared y no en dt: con la batalla a tirones, dt va lento y
    // el aviso llegaría tarde justo cuando más falta hace.
    if (audio.ctx.state === 'running' || document.hidden || !audioWanted) {
      audioBlockT = 0;
      audioBlocked = false;
    } else if (!audioBlockT) {
      audioBlockT = performance.now();
    } else if (!audioBlocked && performance.now() - audioBlockT > 1500) { // margen: reanudar tarda
      audioBlocked = true;
      message(isTouch ? 'TAP THE SCREEN TO ENABLE SOUND' : 'CLICK TO ENABLE SOUND');
    }
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
    // (x·|y| = cero en vertical u horizontal puros, máximo en las esquinas;
    // pulgar a la DERECHA = gira a la derecha)
    const rollIn = ((keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0))
      + (isTouch ? touchStick.x * Math.abs(touchStick.y) * 2.8 : 0);
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
      if (mpActive) netSend({ t: 'shot', o: [+tmp.x.toFixed(1), +tmp.y.toFixed(1), +tmp.z.toFixed(1)],
        v: [+fwd.x.toFixed(3), +fwd.y.toFixed(3), +fwd.z.toFixed(3)] });
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

    /* ---- repostaje: acércate a tu capital y te reparan y rearman ----
       El casco NO se cura de otra forma, así que aparece una decisión real:
       seguir presionando o replegarse. Si pierdes tu capital, se acabó. */
    const home = capitals.ally;
    const docked = home.alive && ship.position.distanceTo(home.group.position) < 900;
    if (docked) {
      player.hull = Math.min(100, player.hull + dt * 7);
      player.shield = Math.min(100, player.shield + dt * 16);
      resupplyT += dt;
      if (resupplyT > 2.2 && missileAmmo < 8) {
        resupplyT = 0;
        missileAmmo++;
        if (hud.missiles) hud.missiles.textContent = missileAmmo;
        sfxLock();
      }
      if (!wasDocked) message('RESUPPLYING — REPAIR AND REARM');
    } else resupplyT = 0;
    if (docked !== wasDocked) {
      wasDocked = docked;
      hud.resupply.style.opacity = docked ? 1 : 0;
    }
  }

  /* ---- escuadrones (dormidos hasta entrar en cabina) ----
     En un invitado la flota NO se simula: sus posiciones llegan del anfitrión,
     que es el único árbitro. Simularla en paralelo divergería en segundos. */
  if (started && net.role !== 'guest') {
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
      // serpenteo: nadie vuela recto — curvas laterales y verticales propias
      tv1.crossVectors(toTarget, f.obj.up).normalize();
      const wv = Math.sin(t * f.weaveF + f.weavePh) * f.weaveAmp;
      desired.addScaledVector(tv1, wv);
      desired.y += Math.cos(t * f.weaveF * 0.7 + f.weavePh) * f.weaveAmp * 0.5;
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
      // OJO con el orden: Matrix4.lookAt(ojo, objetivo) construye una base de
      // CÁMARA, con +Z alejándose del objetivo. Pasando (objetivo, posición) el
      // +Z apunta AL objetivo, que es donde tienen el morro las naves. Con el
      // caza del kit, casi simétrico, no se notaba que volaban de espaldas.
      lookM.lookAt(f.target.obj.position, f.obj.position, f.obj.up);
      lookQ.setFromRotationMatrix(lookM);
      // escora en el viraje: rueda sobre su eje según el empuje lateral
      bankQ.setFromAxisAngle(zAxis, THREE.MathUtils.clamp(-(wv + (dist < 110 ? f.orbitDir * 0.5 : 0)) * 1.1, -1, 1));
      lookQ.multiply(bankQ);
      f.obj.quaternion.slerp(lookQ, 1 - Math.exp(-3 * dt));

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
      const orbitAt = s.isGunship ? 170 : 90; // la cañonera se queda a distancia y castiga
      const desired = tmp2.copy(toT);
      if (dist < orbitAt) desired.crossVectors(toT, s.obj.up).multiplyScalar(s.orbitDir).addScaledVector(toT, 0.2);
      // serpenteo individual del enjambre — el cielo se llena de curvas
      tv1.crossVectors(toT, s.obj.up).normalize();
      const wv = Math.sin(t * s.weaveF + s.weavePh) * s.weaveAmp;
      desired.addScaledVector(tv1, wv);
      desired.y += Math.cos(t * s.weaveF * 0.7 + s.weavePh) * s.weaveAmp * 0.5;
      s.vel.addScaledVector(desired.normalize(), (s.isGunship ? 13 : 24) * dt);
      s.vel.multiplyScalar(Math.exp(-0.5 * dt));
      const topSpeed = s.isGunship ? 25 : 42;
      if (s.vel.length() > topSpeed) s.vel.setLength(topSpeed);
      s.obj.position.addScaledVector(s.vel, dt);
      lookM.lookAt(s.target.obj.position, s.obj.position, s.obj.up); // +Z al objetivo (ver nota arriba)
      lookQ.setFromRotationMatrix(lookM);
      bankQ.setFromAxisAngle(zAxis, THREE.MathUtils.clamp(-(wv + (dist < orbitAt ? s.orbitDir * 0.5 : 0)) * 1.1, -1, 1));
      lookQ.multiply(bankQ);
      s.obj.quaternion.slerp(lookQ, 1 - Math.exp((s.isGunship ? -1.4 : -2.5) * dt));

      /* ---- CAÑONERA: 4 cañones en ráfaga + misiles guiados ---- */
      if (s.isGunship) {
        s.burstCool -= dt;
        s.nextShot -= dt;
        if (s.burst <= 0 && s.nextShot <= 0 && dist < 620) {
          s.burst = 4;              // una salva por cañón
          s.nextShot = 3.4 + Math.random() * 2.6;
        }
        if (s.burst > 0 && s.burstCool <= 0) {
          const mz = GUN_MUZZLES[4 - s.burst];
          tv2.set(mz[0], mz[1], mz[2]).applyQuaternion(s.obj.quaternion).add(s.obj.position);
          const dir = tv3.copy(s.target.obj.position).sub(tv2).normalize();
          dir.x += (Math.random() - 0.5) * enemySpread * 0.7; // más certera que un caza
          dir.y += (Math.random() - 0.5) * enemySpread * 0.7;
          fireLaser(tv2.clone(), dir.normalize().clone(), 260, 'enemy');
          flash(tv2, true, 2.5, 0.08);
          s.burst--;
          s.burstCool = 0.12;
        }
        s.nextMissile -= dt;
        if (s.nextMissile <= 0 && dist < 900) {
          s.nextMissile = 11 + Math.random() * 9;
          const pod = GUN_PODS[Math.random() < 0.5 ? 0 : 1];
          tv2.set(pod[0], pod[1], pod[2]).applyQuaternion(s.obj.quaternion).add(s.obj.position);
          launchEnemyMissile(tv2, s.target);
        }
        continue; // no usa el disparo genérico del enjambre
      }

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

  if (started) { checkFlybys(dt); updateLock(dt); }
  respawnTick(dt);
  netTick(dt);

  /* ---- capitales tocadas: incendio en cadena y despedazamiento ---- */
  for (const cap of [capitals.ally, capitals.enemy]) {
    if (cap.dying <= 0) continue;
    cap.dying -= dt;
    cap.burnT -= dt;
    if (cap.burnT <= 0) {
      cap.burnT = 0.12; // explosiones recorriendo el casco
      const bx = cap.burnExtent || [240, 150, 2100];
      tv1.set((Math.random() - 0.5) * bx[0], (Math.random() - 0.5) * bx[1], (Math.random() - 0.5) * bx[2]);
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
      const speed = Math.min(ms.maxSpeed || 240, ms.vel.length() + 130 * dt); // más rápido que tu turbo: no te adelantas a tu propio misil
      ms.vel.lerp(tmp.multiplyScalar(speed), 1 - Math.exp(-(ms.turn || 3.2) * dt)); // giro firme: alcanza incluso a un caza serpenteando
      ms.mesh.quaternion.setFromUnitVectors(tmp.set(0, 0, 1), tmp2.copy(ms.vel).normalize());
    }
    ms.mesh.position.addScaledVector(ms.vel, dt);
    ms.life -= dt;
    let done = ms.life <= 0;

    if (!done && hasTarget && !ms.target.isCapital
        && ms.mesh.position.distanceToSquared(ms.target.obj.position) < 14 * 14) {
      if (ms.faction === 'enemy') {
        // misil de cañonera: si te alcanza, duele de verdad
        if (ms.target.isPlayer) damagePlayer(48);
        else if (ms.target.slot !== undefined) killSwarmShip(ms.target, false);
        else damageFighter(ms.target, 6, ms.mesh.position);
      } else {
        missileHit(ms.target, ms.mesh.position); // un misil, una baja — élite o enjambre
        hitMarkT = 0.3;
      }
      flash(ms.mesh.position, true, 14, 0.35);
      sfxExplosion(1.6, gainFor(ms.mesh.position, 1600));
      done = true;
    }
    if (!done) {
      for (const c of colliders) {
        if (ms.mesh.position.distanceToSquared(c.pos) < c.r * c.r) {
          // cabezazo contra una capital rival: daño pesado de misil
          if (c.cap && c.cap.alive && c.cap.faction !== ms.faction) damageCapital(c.cap, 150, ms.mesh.position);
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
          if (l.isPlayer) hitMarkT = 0.16;
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
        if (segmentHitsSphere(segPrev, segStep, s.obj.position, s.isGunship ? 13 : hitR)) {
          s.hp--;
          if (s.hp <= 0) killSwarmShip(s, l.isPlayer);
          else flash(l.mesh.position, false, 5, 0.15);
          if (l.isPlayer) hitMarkT = 0.16;
          dead = true; break;
        }
      }
    }
    // duelo entre jugadores: quien dispara resuelve su impacto y manda el daño
    if (!dead && l.isPlayer && mpActive) {
      for (const rp of remotePilots) {
        if (!rp.alive || isFriendly(rp.id)) continue; // a los tuyos no se les dispara
        if (segmentHitsSphere(segPrev, segStep, rp.obj.position, 8)) {
          netHitPilot(rp, 12);
          hitMarkT = 0.16;
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
          if (c.cap && c.cap.alive && c.cap.faction !== l.faction) {
            damageCapital(c.cap, 1, l.mesh.position);
            if (l.isPlayer) hitMarkT = 0.16;
          }
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

  updateEmbers(dt);

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

  /* ---- cámara third-person (compensada por velocidad) ----
     La posición BASE se guarda aparte: si la sacudida se sumara a
     camera.position, el lerp del frame siguiente partiría de la posición
     temblada y el temblor se realimentaría hasta descuadrar la cámara. */
  const camT = 1 - Math.exp(-5 * dt);
  tmp.set(0, 4, -14).applyQuaternion(ship.quaternion).add(ship.position)
    .addScaledVector(player.vel, 1 / 5);
  camBase.lerp(tmp, camT);
  const fromShip = tmp2.copy(camBase).sub(ship.position);
  const d = fromShip.length();
  if (d < 9) camBase.copy(ship.position).addScaledVector(fromShip.normalize(), 9);
  else if (d > 34) camBase.copy(ship.position).addScaledVector(fromShip.normalize(), 34);
  camera.position.copy(camBase);
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 2.6);
    const s = shake * shake * 3.4; // decaimiento suave: golpe seco, no vibración
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
  }
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
  const dt = Math.min(clock.getDelta(), 0.05);
  hitMarkT = Math.max(0, hitMarkT - dt);
  update(dt);
  drawRadar();          // solo una vez por frame RENDERIZADO (no en __sb.step)
  drawMarkers();
  updateEnemyArrow();
  renderer.render(scene, camera);
}
wireLobby(); // aquí abajo: necesita el ayudante `el` del HUD, que se define antes

// simulación acelerada para pruebas: N segundos de batalla sin esperar al render
window.__sb.step = (seconds) => {
  sfxMuted = true;
  try { for (let i = 0, n = Math.round(seconds * 60); i < n; i++) update(1 / 60); }
  finally { sfxMuted = false; }
};
tick();
