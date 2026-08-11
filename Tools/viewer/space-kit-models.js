// SPACE ASSET KIT — procedural model builders (preview mirror of Tools/Blender)
// Same seeds / same parameter names as the Blender generators.
import * as THREE from 'three';
import { rockMaps, hullMaps, planetDetail, starMaps, radialGlow, earthMaps } from './space-kit-textures.js';

/* per-asset tiling: clone the baked maps so texel density matches size */
function tiled(maps, tiles) {
  const out = {};
  for (const k in maps) {
    const t = maps[k].clone();
    t.needsUpdate = true;
    t.repeat.set(tiles[0], tiles[1]);
    out[k] = t;
  }
  return out;
}

/* ---------- deterministic noise ---------- */
function hash3(i, j, k, seed) {
  let n = (i * 374761393 + j * 668265263 + k * 1274126177 + seed * 9781) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, z, seed) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = sm(x - i), fy = sm(y - j), fz = sm(z - k);
  let r = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        r += w * hash3(i + dx, j + dy, k + dz, seed);
      }
  return r * 2 - 1;
}
function fbm(x, y, z, seed, oct = 5, lac = 2.03, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * vnoise(x * f, y * f, z * f, seed + o * 131);
    n += a; a *= gain; f *= lac;
  }
  return s / n;
}
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/* ---------- shared art direction ---------- */
export const MAT = {
  hull_dark: () => new THREE.MeshStandardMaterial({ name: 'MAT_Hull_Dark', color: 0x9fa7b0, metalness: 0.55, roughness: 0.46, ...hullMaps('dark'), envMapIntensity: 0.6 }),
  hull_mid: () => new THREE.MeshStandardMaterial({ name: 'MAT_Hull_Mid', color: 0xcdd4da, metalness: 0.5, roughness: 0.36, ...hullMaps('mid'), envMapIntensity: 0.7 }),
  hull_light: () => new THREE.MeshStandardMaterial({ name: 'MAT_Hull_Light', color: 0xe4e8ec, metalness: 0.3, roughness: 0.4, ...hullMaps('light'), envMapIntensity: 0.8 }),
  hull_black: () => new THREE.MeshStandardMaterial({ name: 'MAT_Hull_Black', color: 0x5c626a, metalness: 0.55, roughness: 0.6, ...hullMaps('black'), envMapIntensity: 0.7 }),
  accent: () => new THREE.MeshStandardMaterial({ name: 'MAT_Accent_Amber', color: 0xd8912a, metalness: 0.45, roughness: 0.44, normalMap: hullMaps('mid').normalMap, envMapIntensity: 1.0 }),
  glass: () => new THREE.MeshPhysicalMaterial({ name: 'MAT_Cockpit_Glass', color: 0x0a1420, metalness: 0.0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.2, emissive: 0x16283c, emissiveIntensity: 0.25 }),
  emis_cyan: () => new THREE.MeshStandardMaterial({ name: 'MAT_Emissive_Cyan', color: 0x0a2430, emissive: 0x39d6ff, emissiveIntensity: 2.8, roughness: 0.3 }),
  emis_white: () => new THREE.MeshStandardMaterial({ name: 'MAT_Emissive_EngineCore', color: 0xbfe9ff, emissive: 0xa8e4ff, emissiveIntensity: 4.0, roughness: 0.2 }),
  emis_red: () => new THREE.MeshStandardMaterial({ name: 'MAT_Emissive_Red', color: 0x2a0a0a, emissive: 0xff4a2a, emissiveIntensity: 2.4, roughness: 0.3 }),
  emis_green: () => new THREE.MeshStandardMaterial({ name: 'MAT_Emissive_Green', color: 0x0a2a12, emissive: 0x46ff7a, emissiveIntensity: 2.2, roughness: 0.3 }),
  rock: (palette = 'grey', tiles = [3, 2]) => new THREE.MeshStandardMaterial({
    name: `MAT_Rock_${palette}`, color: 0xffffff, metalness: palette === 'metal' ? 0.35 : 0.0,
    roughness: 1.0, vertexColors: true, ...tiled(rockMaps(palette), tiles),
    normalScale: new THREE.Vector2(1.7, 1.7), envMapIntensity: 0.03,
  }),
  ore: () => new THREE.MeshStandardMaterial({ name: 'MAT_Ore_Cyan', color: 0x1e4650, emissive: 0x2fd0e0, emissiveIntensity: 1.1, metalness: 0.5, roughness: 0.3 }),
};

function marker(name, pos, lookDir) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(pos[0], pos[1], pos[2]);
  if (lookDir) o.lookAt(new THREE.Vector3(pos[0] + lookDir[0], pos[1] + lookDir[1], pos[2] + lookDir[2]));
  return o;
}
function mesh(geo, mat, name) { const m = new THREE.Mesh(geo, mat); m.name = name; return m; }

/* geometry helper: hex/oct prism laid along +Z, front radius first */
function prism(rFront, rBack, len, seg, { sx = 1, sy = 1, phase = 0, z = 0, y = 0, x = 0 } = {}) {
  const g = new THREE.CylinderGeometry(rFront, rBack, len, seg, 1, false);
  if (phase) g.rotateY(phase);
  g.scale(sx, 1, sy);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/* ============================================================
   SHIP_Player_Fighter_01 — 12 m light interceptor, nose +Z
   ============================================================ */
export function buildPlayerFighter() {
  const G = new THREE.Group(); G.name = 'SHIP_Player_Fighter_01';
  const dark = MAT.hull_dark(), mid = MAT.hull_mid(), light = MAT.hull_light(),
    black = MAT.hull_black(), accent = MAT.accent(), glass = MAT.glass(),
    cyan = MAT.emis_cyan(), core = MAT.emis_white();

  /* --- Ship_Body --- */
  const body = new THREE.Group(); body.name = 'Ship_Body';
  body.add(mesh(prism(0.28, 1.05, 3.6, 6, { sx: 1.25, sy: 0.62, phase: Math.PI / 6, z: 4.0 }), dark, 'Body_Nose'));
  body.add(mesh(prism(1.05, 1.3, 4.2, 6, { sx: 1.3, sy: 0.68, phase: Math.PI / 6, z: 0.1 }), dark, 'Body_Mid'));
  body.add(mesh(prism(1.3, 1.05, 2.6, 6, { sx: 1.25, sy: 0.7, phase: Math.PI / 6, z: -3.3 }), mid, 'Body_Rear'));
  // dorsal spine + light panels
  body.add(mesh(prism(0.34, 0.5, 5.4, 4, { sx: 1.0, sy: 0.55, phase: Math.PI / 4, y: 0.72, z: 1.0 }), light, 'Body_Spine'));
  // chin / sensor block
  body.add(mesh(prism(0.42, 0.62, 2.2, 6, { sx: 1.1, sy: 0.6, phase: Math.PI / 6, y: -0.62, z: 3.0 }), black, 'Body_SensorPod'));
  // panel lines (thin inset strips) + vents
  for (let i = 0; i < 5; i++) {
    const z = 3.4 - i * 1.5;
    const pl = mesh(new THREE.BoxGeometry(2.7, 0.045, 0.09), black, `Body_PanelLine_${i + 1}`);
    pl.position.set(0, 0.44 - i * 0.02, z); G.add(pl);
  }
  for (let s = -1; s <= 1; s += 2) {
    for (let i = 0; i < 4; i++) {
      const v = mesh(new THREE.BoxGeometry(0.12, 0.22, 0.6), black, `Body_Vent_${s > 0 ? 'R' : 'L'}${i + 1}`);
      v.position.set(s * 1.32, 0.05, -1.2 - i * 0.42); G.add(v);
    }
    const strip = mesh(new THREE.BoxGeometry(0.5, 0.06, 2.2), accent, `Body_AccentStrip_${s > 0 ? 'R' : 'L'}`);
    strip.position.set(s * 0.95, 0.5, 2.0); G.add(strip);
  }
  G.add(body);

  /* --- Cockpit --- */
  const cockpit = new THREE.Group(); cockpit.name = 'Cockpit';
  const canopyG = new THREE.SphereGeometry(0.92, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.55);
  canopyG.scale(0.86, 0.72, 1.45); canopyG.translate(0, 0.62, 2.35);
  cockpit.add(mesh(canopyG, glass, 'Cockpit_Glass'));
  const frameG = new THREE.TorusGeometry(0.78, 0.06, 8, 32, Math.PI);
  frameG.rotateY(Math.PI / 2); frameG.rotateZ(-0.12); frameG.scale(1.45, 1, 0.9); frameG.translate(0, 0.6, 2.32);
  cockpit.add(mesh(frameG, black, 'Cockpit_Frame'));
  const hud = mesh(new THREE.BoxGeometry(0.5, 0.03, 0.3), cyan, 'Cockpit_HUD');
  hud.position.set(0, 0.72, 3.0); cockpit.add(hud);
  G.add(cockpit);

  /* --- Wings --- */
  function wingShape() {
    const s = new THREE.Shape();
    s.moveTo(0.85, 2.35); s.lineTo(3.05, 0.55); s.lineTo(4.45, -0.75);
    s.lineTo(4.45, -1.85); s.lineTo(2.6, -2.15); s.lineTo(0.85, -2.95);
    s.closePath(); return s;
  }
  function makeWing(side) {
    const g = new THREE.Group(); g.name = side > 0 ? 'Wing_R' : 'Wing_L';
    const eg = new THREE.ExtrudeGeometry(wingShape(), { depth: 0.34, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.06, bevelSegments: 2 });
    eg.rotateX(Math.PI / 2); eg.translate(0, 0.17, 0);
    if (side < 0) eg.scale(-1, 1, 1);
    const w = mesh(eg, dark, `${g.name}_Plate`);
    w.rotation.z = side * -0.14;
    g.add(w);
    // leading-edge light strip
    const le = mesh(new THREE.BoxGeometry(2.6, 0.07, 0.1), light, `${g.name}_LeadingEdge`);
    le.position.set(side * 2.5, 0.25, 1.05); le.rotation.y = side * 0.72; le.rotation.z = side * -0.14; g.add(le);
    // wingtip pylon + nav light
    const tip = mesh(prism(0.16, 0.3, 1.5, 6, { z: -0.7, x: side * 4.35, y: 0.16 }), mid, `${g.name}_TipPylon`);
    g.add(tip);
    const nav = mesh(new THREE.SphereGeometry(0.14, 12, 10), side > 0 ? MAT.emis_green() : MAT.emis_red(), `NavLight_${side > 0 ? 'R' : 'L'}`);
    nav.position.set(side * 4.35, 0.2, 0.1); g.add(nav);
    // under-wing hardpoint block
    const hp = mesh(new THREE.BoxGeometry(0.6, 0.3, 1.6), black, `${g.name}_Hardpoint`);
    hp.position.set(side * 2.55, -0.16, 0.1); hp.rotation.z = side * -0.14; g.add(hp);
    return g;
  }
  G.add(makeWing(1), makeWing(-1));

  /* --- Weapons --- */
  function makeWeapon(side) {
    const g = new THREE.Group(); g.name = side > 0 ? 'Weapon_R' : 'Weapon_L';
    const x = side * 1.95;
    g.add(mesh(prism(0.17, 0.28, 3.3, 8, { x, y: -0.05, z: 2.4 }), mid, `${g.name}_Barrel`));
    g.add(mesh(prism(0.34, 0.42, 1.2, 6, { x, y: -0.05, z: 0.5 }), black, `${g.name}_Breech`));
    const ring = new THREE.TorusGeometry(0.26, 0.055, 8, 20); ring.rotateX(Math.PI / 2); ring.translate(x, -0.05, 3.2);
    g.add(mesh(ring, accent, `${g.name}_Collar`));
    const muzzle = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12), cyan, `${g.name}_MuzzleGlow`);
    muzzle.rotation.x = Math.PI / 2; muzzle.position.set(x, -0.05, 4.02); g.add(muzzle);
    g.add(marker(side > 0 ? 'Muzzle_R' : 'Muzzle_L', [x, -0.05, 4.1], [0, 0, 1]));
    return g;
  }
  G.add(makeWeapon(1), makeWeapon(-1));

  /* --- Engines --- */
  function makeEngine(side) {
    const g = new THREE.Group(); g.name = side > 0 ? 'Engine_R' : 'Engine_L';
    const x = side * 1.7, zc = -3.6;
    g.add(mesh(prism(0.95, 1.02, 3.2, 12, { x, y: 0.05, z: zc + 0.4 }), dark, `${g.name}_Housing`));
    g.add(mesh(prism(1.02, 0.72, 1.0, 12, { x, y: 0.05, z: zc - 1.7 }), black, `${g.name}_Nozzle`));
    for (let i = 0; i < 3; i++) {
      const r = new THREE.TorusGeometry(1.0 + i * 0.02, 0.09, 8, 26); r.rotateX(Math.PI / 2);
      r.translate(x, 0.05, zc + 0.9 - i * 0.9);
      g.add(mesh(r, mid, `${g.name}_Ring_${i + 1}`));
    }
    // conduits along the housing
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const c = mesh(prism(0.09, 0.09, 2.6, 6, { x: x + Math.cos(a) * 0.98, y: 0.05 + Math.sin(a) * 0.98, z: zc + 0.4 }), light, `${g.name}_Conduit_${i + 1}`);
      g.add(c);
    }
    // glowing core, recessed
    const coreG = new THREE.CylinderGeometry(0.62, 0.5, 0.5, 24); coreG.rotateX(Math.PI / 2); coreG.translate(x, 0.05, zc - 2.05);
    g.add(mesh(coreG, core, `${g.name}_Core`));
    const halo = new THREE.TorusGeometry(0.72, 0.07, 8, 26); halo.rotateX(Math.PI / 2); halo.translate(x, 0.05, zc - 2.2);
    g.add(mesh(halo, cyan, `${g.name}_CoreHalo`));
    // intake at the front of the nacelle
    g.add(mesh(prism(0.55, 0.9, 0.7, 12, { x, y: 0.05, z: zc + 2.3 }), black, `${g.name}_Intake`));
    g.add(marker(side > 0 ? 'FX_Engine_R' : 'FX_Engine_L', [x, 0.05, zc - 2.4], [0, 0, -1]));
    return g;
  }
  G.add(makeEngine(1), makeEngine(-1));

  /* --- Tail fins --- */
  for (let s = -1; s <= 1; s += 2) {
    const fs = new THREE.Shape();
    fs.moveTo(-1.0, 0); fs.lineTo(0.9, 0); fs.lineTo(0.25, 1.35); fs.lineTo(-0.85, 1.0); fs.closePath();
    const fg = new THREE.ExtrudeGeometry(fs, { depth: 0.12, bevelEnabled: false });
    fg.rotateY(Math.PI / 2); fg.translate(s * 0.95, 0.55, -3.4);
    const f = mesh(fg, mid, s > 0 ? 'Fin_R' : 'Fin_L');
    f.rotation.z = s * 0.28; G.add(f);
  }

  /* --- Maneuvering thrusters --- */
  const th = [
    ['Thruster_L', [-2.2, 0.05, 2.9], [-1, 0, 0]],
    ['Thruster_R', [2.2, 0.05, 2.9], [1, 0, 0]],
    ['Thruster_Up', [0, 0.95, -1.4], [0, 1, 0]],
    ['Thruster_Down', [0, -0.72, -1.4], [0, -1, 0]],
  ];
  th.forEach(([n, p, d]) => {
    const c = new THREE.CylinderGeometry(0.2, 0.24, 0.28, 10);
    const m = mesh(c, black, `${n}_Nozzle`);
    m.position.set(...p);
    m.lookAt(new THREE.Vector3(p[0] + d[0], p[1] + d[1], p[2] + d[2]));
    m.rotateX(Math.PI / 2);
    const glow = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10), cyan, `${n}_Glow`);
    glow.position.copy(m.position).add(new THREE.Vector3(d[0] * 0.13, d[1] * 0.13, d[2] * 0.13));
    glow.quaternion.copy(m.quaternion);
    G.add(m, glow, marker(`FX_${n}`, p, d));
  });

  /* --- Unity technical empties --- */
  G.add(marker('CameraTarget', [0, 0.9, -1.2], [0, 0, 1]));
  G.add(marker('TargetPoint', [0, 0.1, 0], [0, 0, 1]));
  return G;
}

/* ============================================================
   ENV_Asteroid — procedural rock (seeded, crater + fracture)
   ============================================================ */
export function buildAsteroid({
  seed = 1, radius = 11, detail = 12, terrain_scale = 1.2, terrain_strength = 0.30,
  crater_count = 14, crater_size = 0.42, elongation = [1.0, 0.8, 1.25],
  fractures = 1, flats = 4, mineral_amount = 0, palette = 'grey', name = 'ENV_Asteroid_01',
  chunks_count = null,
} = {}) {
  const G = new THREE.Group(); G.name = name;
  const rnd = rng(seed * 7919 + 13);
  const craters = [];
  for (let i = 0; i < crater_count; i++) {
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    const big = rnd() > 0.72;
    craters.push({
      d: v,
      r: crater_size * (big ? 1.1 + rnd() * 0.8 : 0.25 + rnd() * 0.5),
      depth: (big ? 0.16 : 0.07) + rnd() * 0.09,
      floor: 0.35 + rnd() * 0.3,
    });
  }
  const grooves = [];
  for (let i = 0; i < fractures; i++) {
    grooves.push({
      n: new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize(),
      off: (rnd() - 0.5) * 0.7, w: 0.04 + rnd() * 0.07, depth: 0.12 + rnd() * 0.14,
    });
  }
  // planar truncations: what turns a lumpy blob into fractured rock
  const planes = [];
  for (let i = 0; i < flats; i++) {
    planes.push({
      n: new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize(),
      d: radius * (0.55 + rnd() * 0.3),
    });
  }

  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3(), d = new THREE.Vector3(), p = new THREE.Vector3();
  const colors = new Float32Array(pos.count * 3);
  const base = {
    grey: [1.0, 1.0, 1.0], dark: [0.88, 0.88, 0.92],
    red: [1.06, 0.9, 0.86], ice: [0.96, 1.0, 1.04], metal: [1.0, 0.98, 0.94],
  }[palette] || [1.0, 1.0, 1.0];

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    d.copy(v).normalize();
    // big lumps first — few octaves keeps the silhouette readable
    let h = fbm(d.x * terrain_scale, d.y * terrain_scale, d.z * terrain_scale, seed, 3, 1.9, 0.55) * terrain_strength;
    // detail only where the mask allows it: smooth plains next to rough ground
    const mask = Math.max(0, fbm(d.x * 1.7, d.y * 1.7, d.z * 1.7, seed + 411, 2) * 0.5 + 0.5);
    h += fbm(d.x * terrain_scale * 5.5, d.y * terrain_scale * 5.5, d.z * terrain_scale * 5.5, seed + 71, 3)
      * terrain_strength * 0.28 * mask;
    let cav = 0, rimMax = 0;
    for (const c of craters) {
      const ang = Math.acos(Math.min(1, Math.max(-1, d.dot(c.d))));
      if (ang < c.r * 1.2) {
        const t = ang / c.r;
        if (t < 1) {
          const bowl = -c.depth * Math.min(1, (1 - t) / c.floor);
          if (bowl < cav) cav = bowl;                       // deepest wins
        }
        rimMax = Math.max(rimMax, c.depth * 0.45 * Math.exp(-Math.pow((t - 0.97) * 10, 2)));
      }
    }
    cav += rimMax;
    let groove = 0;
    for (const g2 of grooves) {
      const dist = Math.abs(d.dot(g2.n) - g2.off);
      if (dist < g2.w) groove -= (1 - dist / g2.w) * g2.depth;
    }
    const r = radius * (1 + h + cav + groove);
    p.set(d.x * elongation[0], d.y * elongation[1], d.z * elongation[2]).normalize().multiplyScalar(r);
    let flatHit = 0;
    for (const pl of planes) {
      const dp = p.dot(pl.n);
      if (dp > pl.d) { p.addScaledVector(pl.n, (pl.d - dp) * 0.82); flatHit = 1; }
    }
    pos.setXYZ(i, p.x, p.y, p.z);

    // vertex colour modulates the baked albedo (never replaces it):
    // large-scale lightening on ridges, shadowing in bowls and grooves
    const shade = Math.max(0.55, Math.min(1.18, 0.94 + (h + cav + groove) * 0.85 + flatHit * 0.04));
    let cr = base[0] * shade, cg = base[1] * shade, cb = base[2] * shade;
    if (mineral_amount > 0) {
      const vein = fbm(d.x * 7.5, d.y * 7.5, d.z * 7.5, seed + 303, 3);
      const inCrack = (cav + groove) < -0.06;
      if (inCrack && vein > 0.55 - mineral_amount * 0.12) {
        const t = Math.min(1, (vein - 0.4) * 2.4) * 0.8;
        cr = cr * (1 - t) + 0.16 * t; cg = cg * (1 - t) + 0.86 * t; cb = cb * (1 - t) + 0.98 * t;
      }
    }
    colors[i * 3] = cr; colors[i * 3 + 1] = cg; colors[i * 3 + 2] = cb;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const rockMat = MAT.rock(palette, [Math.max(2, Math.round(radius / 11)), Math.max(1, Math.round(radius / 16))]);
  if (palette === 'ice') { rockMat.roughness = 0.62; rockMat.metalness = 0.08; rockMat.envMapIntensity = 1.1; }
  G.add(mesh(geo, rockMat, `${name}_LOD0`));

  // welded satellite boulders — breaks the "one blob" silhouette
  const chunks = chunks_count === null ? Math.round(1 + rnd() * 2) : chunks_count;
  for (let i = 0; i < chunks; i++) {
    const cr = radius * (0.14 + rnd() * 0.2);
    const cg2 = new THREE.IcosahedronGeometry(cr, 3);
    const cp = cg2.attributes.position;
    const cc = new Float32Array(cp.count * 3);
    for (let j = 0; j < cp.count; j++) {
      v.fromBufferAttribute(cp, j); d.copy(v).normalize();
      const hh = fbm(d.x * 2.5, d.y * 2.5, d.z * 2.5, seed + 500 + i * 17, 4) * 0.3;
      cp.setXYZ(j, d.x * cr * (1 + hh), d.y * cr * (1 + hh) * 0.85, d.z * cr * (1 + hh));
      const s2 = Math.max(0.6, Math.min(1.15, 0.95 + hh * 0.8));
      cc[j * 3] = base[0] * s2; cc[j * 3 + 1] = base[1] * s2; cc[j * 3 + 2] = base[2] * s2;
    }
    cg2.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    cg2.computeVertexNormals();
    const dir = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    const m = mesh(cg2, rockMat, `${name}_Chunk_${i + 1}`);
    m.position.copy(dir.multiplyScalar(radius * (0.82 + rnd() * 0.12)));
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    G.add(m);
  }

  if (mineral_amount > 0.5) {
    const ore = MAT.ore();
    for (let i = 0; i < 3; i++) {
      const dir = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      const c = mesh(new THREE.OctahedronGeometry(radius * 0.022 * (0.6 + rnd()), 0), ore, `${name}_Crystal_${i + 1}`);
      c.position.copy(dir.multiplyScalar(radius * 0.84));
      c.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      G.add(c);
    }
  }
  return G;
}

export const buildAsteroidMedium01 = () => buildAsteroid({
  seed: 20481, radius: 11, detail: 26, terrain_scale: 1.15, terrain_strength: 0.26,
  crater_count: 16, crater_size: 0.34, elongation: [1.0, 0.72, 1.32], fractures: 2,
  flats: 3, chunks_count: 0, palette: 'grey', name: 'ENV_Asteroid_Medium_01',
});

export const buildAsteroidLarge01 = () => buildAsteroid({
  seed: 88117, radius: 46, detail: 30, terrain_scale: 0.9, terrain_strength: 0.26,
  crater_count: 34, crater_size: 0.42, elongation: [1.28, 0.7, 1.0], fractures: 4,
  flats: 6, chunks_count: 0, mineral_amount: 0.85, palette: 'dark',
  name: 'ENV_Asteroid_Large_01',
});

/* ============================================================
   ENV_Planet — terrestrial / gas giant / ringed
   ============================================================ */
function planetSurface({ seed, radius, segments, ocean_level, palette, terrain_strength = 0.012, bands = false }) {
  const geo = new THREE.SphereGeometry(radius, segments, segments / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); d.copy(v).normalize();
    let h;
    if (bands) {
      const lat = d.y;
      h = Math.sin(lat * 14 + fbm(d.x * 1.2, d.y * 5.0, d.z * 1.2, seed, 4) * 2.6) * 0.5 + 0.5;
      const storm = fbm(d.x * 3.2, d.y * 8.0, d.z * 3.2, seed + 44, 4);
      h = h * 0.75 + storm * 0.25 + 0.5 * 0;
    } else {
      h = fbm(d.x * 2.1, d.y * 2.1, d.z * 2.1, seed, 6) * 0.5 + 0.5;
      h += fbm(d.x * 7.5, d.y * 7.5, d.z * 7.5, seed + 91, 4) * 0.12;
    }
    const c = palette(h, Math.abs(d.y), d);
    cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
    if (!bands) {
      const land = Math.max(0, h - ocean_level);
      const r = radius * (1 + land * terrain_strength);
      pos.setXYZ(i, d.x * r, d.y * r, d.z * r);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return geo;
}

function cloudLayer(radius, seed, density = 0.5, color = [1, 1, 1], segments = 96) {
  const geo = new THREE.SphereGeometry(radius, segments, segments / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 4);
  const v = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); d.copy(v).normalize();
    let n = fbm(d.x * 3.4, d.y * 3.4, d.z * 3.4, seed + 7, 5) * 0.5 + 0.5;
    n += fbm(d.x * 9, d.y * 9, d.z * 9, seed + 19, 3) * 0.18;
    const a = Math.max(0, Math.min(1, (n - (1 - density)) * 2.6));
    cols[i * 4] = color[0]; cols[i * 4 + 1] = color[1]; cols[i * 4 + 2] = color[2]; cols[i * 4 + 3] = a;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 4));
  const mat = new THREE.MeshStandardMaterial({
    name: 'MAT_Planet_Clouds', vertexColors: true, transparent: true,
    roughness: 1, metalness: 0, depthWrite: false,
  });
  return mesh(geo, mat, 'Planet_Clouds');
}

function atmosphere(radius, color, opacity = 0.28) {
  const g = new THREE.SphereGeometry(radius, 64, 32);
  const m = new THREE.MeshBasicMaterial({
    name: 'MAT_Planet_Atmosphere', color, transparent: true, opacity,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return mesh(g, m, 'Planet_Atmosphere');
}

export function buildPlanetEarthLike({ seed = 4211, radius = 60, ocean_level = 0.52, cloud_density = 0.55 } = {}) {
  const G = new THREE.Group(); G.name = 'ENV_Planet_EarthLike_01';
  const maps = earthMaps(seed, ocean_level);
  const mat = new THREE.MeshPhysicalMaterial({
    name: 'MAT_Planet_Surface', map: maps.map, bumpMap: maps.bumpMap,
    bumpScale: radius * 0.007, roughnessMap: maps.roughnessMap, roughness: 1.0,
    metalness: 0.0, envMapIntensity: 0.15,
    specularIntensity: 0.35,   // caps GGX energy: tight dim glint, no bloom
  });
  G.add(mesh(new THREE.SphereGeometry(radius, 128, 64), mat, 'Planet_Surface_LOD0'));
  // clouds: alpha-mapped shell, lit, casts believable soft brightness
  const cmat = new THREE.MeshStandardMaterial({
    name: 'MAT_Planet_Clouds', color: 0xffffff, alphaMap: maps.cloudsMap,
    transparent: true, depthWrite: false, roughness: 1.0, metalness: 0,
    opacity: 1.0, envMapIntensity: 0,
  });
  G.add(mesh(new THREE.SphereGeometry(radius * 1.012, 96, 48), cmat, 'Planet_Clouds'));
  // atmosphere: fresnel rim (bright at the limb, transparent at center)
  const amat = new THREE.MeshBasicMaterial({
    name: 'MAT_Planet_Atmosphere', color: 0x4f9dff, transparent: true,
    blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
  });
  amat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vN; varying vec3 vV;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vN; varying vec3 vV;')
      .replace('#include <dithering_fragment>',
        'float d = abs(dot(normalize(vN), normalize(vV)));\n' +
        'float rim = smoothstep(0.0, 0.55, 1.0 - d);\n' +          // wide soft haze
        'rim *= exp(-(1.0 - d) * 2.2) * 1.15;\n' +                 // fade outward
        'gl_FragColor.a *= rim;\n#include <dithering_fragment>');
  };
  G.add(mesh(new THREE.SphereGeometry(radius * 1.07, 64, 32), amat, 'Planet_Atmosphere'));
  return G;
}

export function buildPlanetGasGiant({ seed = 9021, radius = 90, tint = [1, 0.72, 0.42] } = {}) {
  const G = new THREE.Group(); G.name = 'ENV_Planet_GasGiant_01';
  const pal = (h) => {
    const b = 0.35 + h * 0.6;
    return [Math.min(1, tint[0] * b), Math.min(1, tint[1] * b), Math.min(1, tint[2] * b)];
  };
  const surf = planetSurface({ seed, radius, segments: 192, ocean_level: 0, palette: pal, bands: true });
  const mat = new THREE.MeshStandardMaterial({
    name: 'MAT_GasGiant_Surface', vertexColors: true, roughness: 1.0, metalness: 0,
    normalMap: planetDetail().normalMap, normalScale: new THREE.Vector2(0.35, 0.35),
  });
  G.add(mesh(surf, mat, 'GasGiant_Surface_LOD0'));
  // great storm
  const storm = new THREE.SphereGeometry(radius * 1.004, 48, 24, 0, 0.5, 1.05, 0.28);
  const stormMat = new THREE.MeshStandardMaterial({ name: 'MAT_GasGiant_Storm', color: 0xd15b33, roughness: 1 });
  G.add(mesh(storm, stormMat, 'GasGiant_Storm'));
  G.add(atmosphere(radius * 1.04, 0xffb073, 0.22));
  return G;
}

export function buildPlanetRinged({ seed = 3307, radius = 78, ring_count = 4 } = {}) {
  const G = new THREE.Group(); G.name = 'ENV_Planet_Ringed_01';
  const p = buildPlanetGasGiant({ seed, radius, tint: [0.85, 0.82, 0.62] });
  p.name = 'Ringed_Body'; G.add(p);
  const rnd = rng(seed);
  const rings = new THREE.Group(); rings.name = 'Planet_Rings';
  let r0 = radius * 1.35;
  for (let i = 0; i < ring_count; i++) {
    const w = radius * (0.1 + rnd() * 0.3);
    const g = new THREE.RingGeometry(r0, r0 + w, 160, 1);
    g.rotateX(-Math.PI / 2);
    const shade = 0.5 + rnd() * 0.45;
    const m = new THREE.MeshStandardMaterial({
      name: `MAT_Ring_Band_${i + 1}`, color: new THREE.Color(shade * 0.85, shade * 0.8, shade * 0.68),
      transparent: true, opacity: 0.35 + rnd() * 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0.1,
    });
    rings.add(mesh(g, m, `Ring_Band_${i + 1}`));
    r0 += w + radius * (0.04 + rnd() * 0.09);
  }
  rings.rotation.z = 0.24;
  G.add(rings);
  return G;
}

export function buildMoonRocky({ seed = 5150, radius = 18 } = {}) {
  const G = buildAsteroid({
    seed, radius, detail: 20, terrain_scale: 1.3, terrain_strength: 0.05,
    crater_count: 44, crater_size: 0.3, elongation: [1, 0.98, 1], fractures: 0,
    flats: 0, chunks_count: 0, palette: 'grey', name: 'ENV_Moon_Rocky_01',
  });
  // moons keep a near-spherical silhouette: drop the welded boulders
  [...G.children].forEach((c) => { if (/Chunk/.test(c.name)) G.remove(c); });
  return G;
}

/* ============================================================
   ENV_Star_Yellow_01 — photosphere + corona + prominences
   ============================================================ */
export function buildStar({ seed = 777, radius = 120, tint = [1.0, 0.82, 0.42], name = 'ENV_Star_Yellow_01' } = {}) {
  const G = new THREE.Group(); G.name = name;
  // photosphere: near-white disc; limb darkening via vertex color (real stars
  // dim and warm toward the edge)
  const geo = new THREE.SphereGeometry(radius, 96, 48);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    cols[i * 3] = 1; cols[i * 3 + 1] = 1; cols[i * 3 + 2] = 1;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mat = new THREE.MeshBasicMaterial({ name: 'MAT_Star_Photosphere', map: starMaps(tint).map, vertexColors: true });
  // limb darkening shader chunk: darken + warm toward the silhouette edge
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.limbTint = { value: new THREE.Vector3(tint[0], tint[1] * 0.72, tint[2] * 0.4) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vN; varying vec3 vV;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vN; varying vec3 vV; uniform vec3 limbTint;')
      .replace('#include <dithering_fragment>',
        'float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);\n' +
        'float limb = 0.35 + 0.65 * pow(mu, 0.55);\n' +      // darkening
        'gl_FragColor.rgb = mix(limbTint * gl_FragColor.rgb, gl_FragColor.rgb, limb);\n' +
        'gl_FragColor.rgb *= limb;\n#include <dithering_fragment>');
  };
  G.add(mesh(geo, mat, 'Star_Photosphere_LOD0'));
  // corona: camera-facing glow sprites with a real radial falloff
  const glowTex = radialGlow(tint, 0.3);
  [[2.3, 0.85, 'Star_Glow_Inner'], [4.2, 0.4, 'Star_Glow_Outer']].forEach(([sc, op, nm]) => {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      name: `MAT_${nm}`, map: glowTex, transparent: true, opacity: op,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    spr.name = nm;
    spr.scale.setScalar(radius * sc);
    G.add(spr);
  });
  return G;
}

/* ============================================================
   ENV_Nebula_Blue_01 — layered volumetric puffs
   ============================================================ */
export function buildNebula({ seed = 611, extent = 420, puffs = 110, colors = [[0.16, 0.36, 1.0], [0.12, 0.66, 0.85], [0.42, 0.24, 1.0], [0.05, 0.1, 0.3]] } = {}) {
  const G = new THREE.Group(); G.name = 'ENV_Nebula_Blue_01';
  const rnd = rng(seed);
  // gas billboards: soft radial sprites, never hard-edged geometry
  const mats = colors.map((c, i) => new THREE.SpriteMaterial({
    name: `MAT_Nebula_${i + 1}`, map: radialGlow(c, 0.3, true), transparent: true,
    opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  for (let i = 0; i < puffs; i++) {
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6) * extent;
    const m = new THREE.Sprite(mats[i % mats.length]);
    m.name = `Nebula_Puff_${i + 1}`;
    m.position.set(Math.cos(a) * r, (rnd() - 0.5) * extent * 0.45, Math.sin(a) * r * 0.7);
    const s = extent * (0.16 + rnd() * 0.38);
    m.scale.set(s, s * (0.55 + rnd() * 0.45), 1);
    G.add(m);
  }
  // embedded stars
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 900; i++) {
    sp.push((rnd() - 0.5) * extent * 2.4, (rnd() - 0.5) * extent * 1.2, (rnd() - 0.5) * extent * 2.4);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const pts = new THREE.Points(starGeo, new THREE.PointsMaterial({ name: 'MAT_Nebula_Stars', size: extent * 0.006, color: 0xdfeaff, transparent: true, opacity: 0.85 }));
  pts.name = 'Nebula_Stars';
  G.add(pts);
  return G;
}

/* ============================================================
   Skybox_DeepSpace — starfield dome (preview of the baked skybox)
   ============================================================ */
export function buildStarfieldDome({ seed = 31, radius = 900, count = 6000 } = {}) {
  const rnd = rng(seed);
  const g = new THREE.BufferGeometry();
  const p = [], c = [], s = [];
  const temps = [[0.65, 0.75, 1.0], [0.85, 0.9, 1.0], [1, 1, 1], [1, 0.92, 0.72], [1, 0.72, 0.5], [1, 0.5, 0.42]];
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r2 = Math.sqrt(1 - u * u);
    p.push(Math.cos(a) * r2 * radius, u * radius, Math.sin(a) * r2 * radius);
    const t = temps[Math.floor(Math.pow(rnd(), 1.6) * temps.length)];
    const b = 0.35 + Math.pow(rnd(), 3) * 0.65;
    c.push(t[0] * b, t[1] * b, t[2] * b);
    s.push(b);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  const m = new THREE.PointsMaterial({ name: 'MAT_Skybox_Stars', size: radius * 0.004, vertexColors: true, sizeAttenuation: true });
  const pts = new THREE.Points(g, m);
  pts.name = 'Skybox_DeepSpace_Stars';
  const G = new THREE.Group(); G.name = 'ENV_Skybox_DeepSpace';
  G.add(pts);
  return G;
}

/* ============================================================
   SHIP_Capital_Dreadnought_01 — original 2.6 km enemy capital ship
   (map element / mission objective, not playable)
   ============================================================ */
export function buildCapitalShip({ seed = 3100, length = 2600 } = {}) {
  const G = new THREE.Group(); G.name = 'SHIP_Capital_Dreadnought_01';
  const dark = MAT.hull_dark(), mid = MAT.hull_mid(), black = MAT.hull_black(),
    light = MAT.hull_light(), red = MAT.emis_red();
  const core = new THREE.MeshStandardMaterial({
    name: 'MAT_Emissive_EngineCore_Red', color: 0xffd0c0, emissive: 0xff5a30,
    emissiveIntensity: 3.4, roughness: 0.2,
  });
  const L = length / 2600;                       // master scale
  const rnd = rng(seed);

  /* --- keel: three tapering hull segments --- */
  const hull = new THREE.Group(); hull.name = 'Hull';
  hull.add(mesh(prism(30 * L, 120 * L, 700 * L, 8, { sx: 1.9, sy: 0.55, z: 900 * L }), dark, 'Hull_Prow'));
  hull.add(mesh(prism(120 * L, 150 * L, 1000 * L, 8, { sx: 2.1, sy: 0.62, z: 50 * L }), dark, 'Hull_Mid'));
  hull.add(mesh(prism(150 * L, 110 * L, 700 * L, 8, { sx: 1.9, sy: 0.66, z: -800 * L }), mid, 'Hull_Stern'));
  // hammerhead prow crossbar
  const ham = mesh(prism(46 * L, 46 * L, 420 * L, 8, { sy: 0.7 }), mid, 'Hull_Hammerhead');
  ham.rotation.y = Math.PI / 2; ham.position.set(0, 0, 1240 * L); hull.add(ham);
  for (let s = -1; s <= 1; s += 2) {
    const tip = mesh(prism(18 * L, 40 * L, 130 * L, 6), black, `Hammerhead_Tip_${s > 0 ? 'R' : 'L'}`);
    tip.rotation.y = s * Math.PI / 2; tip.position.set(s * 210 * L, 0, 1240 * L); hull.add(tip);
    // lateral armor skirts along the mid hull
    const skirt = mesh(new THREE.BoxGeometry(60 * L, 90 * L, 1500 * L), dark, `Armor_Skirt_${s > 0 ? 'R' : 'L'}`);
    skirt.position.set(s * 300 * L, -20 * L, 0); skirt.rotation.z = s * 0.35; hull.add(skirt);
  }
  G.add(hull);

  /* --- terraced superstructure (city blocks) --- */
  const sup = new THREE.Group(); sup.name = 'Superstructure';
  let w = 320 * L;
  for (let t = 0; t < 4; t++) {
    const b = mesh(new THREE.BoxGeometry(w, 34 * L, (900 - t * 160) * L), t % 2 ? mid : dark, `Terrace_${t + 1}`);
    b.position.set(0, (70 + t * 32) * L, (-150 - t * 90) * L);
    sup.add(b);
    w *= 0.68;
  }
  // command tower
  const tower = mesh(prism(26 * L, 44 * L, 120 * L, 6, { sy: 0.8 }), mid, 'Command_Tower');
  tower.rotation.x = -Math.PI / 2; tower.position.set(0, 240 * L, -560 * L); sup.add(tower);
  const bridge = mesh(new THREE.BoxGeometry(150 * L, 26 * L, 60 * L), light, 'Command_Bridge');
  bridge.position.set(0, 310 * L, -560 * L); sup.add(bridge);
  const bridgeGlass = mesh(new THREE.BoxGeometry(130 * L, 8 * L, 62 * L), red, 'Bridge_Windows');
  bridgeGlass.position.set(0, 306 * L, -559 * L); sup.add(bridgeGlass);
  // sensor masts
  for (let s = -1; s <= 1; s += 2) {
    const mast = mesh(prism(3 * L, 8 * L, 170 * L, 6), light, `Sensor_Mast_${s > 0 ? 'R' : 'L'}`);
    mast.rotation.x = -Math.PI / 2; mast.position.set(s * 70 * L, 400 * L, -560 * L); sup.add(mast);
  }
  G.add(sup);

  /* --- greebles: turrets + city lights along the spine --- */
  const det = new THREE.Group(); det.name = 'Details';
  for (let i = 0; i < 14; i++) {
    const z = (820 - i * 130) * L, s = i % 2 ? 1 : -1;
    const base = mesh(new THREE.CylinderGeometry(16 * L, 20 * L, 14 * L, 8), black, `Turret_Base_${i + 1}`);
    base.position.set(s * (120 + rnd() * 120) * L, (52 + (i < 8 ? 30 : 60)) * L * (i < 8 ? 1 : 0.6), z);
    det.add(base);
    const gun = mesh(prism(3.5 * L, 5 * L, 60 * L, 6, { z: 30 * L }), mid, `Turret_Gun_${i + 1}`);
    gun.position.copy(base.position).add(new THREE.Vector3(0, 10 * L, 0));
    gun.rotation.y = s * 0.5 + (rnd() - 0.5);
    det.add(gun);
  }
  // running lights: emissive strips down the flanks
  for (let s = -1; s <= 1; s += 2) {
    for (let i = 0; i < 9; i++) {
      const strip = mesh(new THREE.BoxGeometry(4 * L, 5 * L, 90 * L), red, `RunningLight_${s > 0 ? 'R' : 'L'}${i + 1}`);
      strip.position.set(s * (335 - i * 6) * L, -30 * L, (850 - i * 210) * L);
      det.add(strip);
    }
  }
  // ventral hangar slot
  const hangar = mesh(new THREE.BoxGeometry(140 * L, 30 * L, 420 * L), black, 'Ventral_Hangar');
  hangar.position.set(0, -95 * L, 150 * L); det.add(hangar);
  const hangarGlow = mesh(new THREE.BoxGeometry(120 * L, 4 * L, 400 * L), red, 'Hangar_Glow');
  hangarGlow.position.set(0, -110 * L, 150 * L); det.add(hangarGlow);
  G.add(det);

  /* --- engine block: 5 nozzles --- */
  const eng = new THREE.Group(); eng.name = 'Engines';
  const xs = [-220, -110, 0, 110, 220];
  xs.forEach((x, i) => {
    const r = (i === 2 ? 74 : 56) * L;
    eng.add(mesh(prism(r, r * 0.82, 130 * L, 12, { x: x * L, z: -1210 * L }), black, `Engine_Nozzle_${i + 1}`));
    const c = mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.5, 30 * L, 16), core, `Engine_Core_${i + 1}`);
    c.rotation.x = Math.PI / 2; c.position.set(x * L, 0, -1268 * L);
    eng.add(c);
    eng.add(marker(`FX_Engine_${i + 1}`, [x * L, 0, -1285 * L], [0, 0, -1]));
  });
  G.add(eng);

  G.add(marker('CameraTarget', [0, 260 * L, -900 * L], [0, 0, 1]));
  G.add(marker('TargetPoint', [0, 40 * L, 0], [0, 0, 1]));
  for (let i = 0; i < 4; i++) G.add(marker(`TurretSocket_${i + 1}`, [(i % 2 ? 1 : -1) * 200 * L, 90 * L, (500 - i * 300) * L], [0, 1, 0]));
  return G;
}

/* ============================================================
   Asteroid field + demo composition
   ============================================================ */
export function buildAsteroidField({ seed = 2024, count = 34, radius = 220, size_min = 3, size_max = 16 } = {}) {
  const G = new THREE.Group(); G.name = 'ENV_AsteroidField_01';
  const rnd = rng(seed);
  const protos = [0, 1, 2, 3].map((i) => buildAsteroid({
    seed: seed + i * 977, radius: 1, detail: 6, terrain_scale: 1.2, terrain_strength: 0.3,
    crater_count: 6, crater_size: 0.4, elongation: [1, 0.75 + rnd() * 0.4, 1.1 + rnd() * 0.4],
    flats: 4, chunks_count: 0,
    palette: ['grey', 'dark', 'grey', 'metal'][i], name: `Field_Proto_${i}`,
  }));
  for (let i = 0; i < count; i++) {
    const p = protos[i % protos.length].clone();
    p.name = `Field_Rock_${String(i + 1).padStart(2, '0')}`;
    const a = rnd() * Math.PI * 2;
    const rr = radius * (0.25 + Math.pow(rnd(), 0.7) * 0.75);
    p.position.set(Math.cos(a) * rr, (rnd() - 0.5) * radius * 0.22, Math.sin(a) * rr);
    const s = size_min + Math.pow(rnd(), 2.2) * (size_max - size_min);
    p.scale.setScalar(s);
    p.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
    G.add(p);
  }
  return G;
}

export function buildDemoScene() {
  const G = new THREE.Group(); G.name = 'DEMO_VerticalSlice';
  const ship = buildPlayerFighter();
  ship.position.set(0, 0, 40); ship.scale.setScalar(1.6);
  G.add(ship);

  const a1 = buildAsteroidMedium01(); a1.position.set(-46, -6, 6); G.add(a1);
  const a2 = buildAsteroidLarge01(); a2.position.set(120, -22, -140); G.add(a2);
  const field = buildAsteroidField({ count: 26, radius: 260, size_max: 10 });
  field.position.set(-60, -20, -220); G.add(field);

  const planet = buildPlanetEarthLike({ radius: 220 });
  planet.position.set(-320, 40, -900); G.add(planet);

  const gas = buildPlanetRinged({ radius: 150 });
  gas.position.set(520, 90, -1200); G.add(gas);

  const moon = buildMoonRocky({ radius: 46 });
  moon.position.set(-90, 120, -700); G.add(moon);

  const star = buildStar({ radius: 90 });
  star.position.set(900, 260, -2200); G.add(star);

  const neb = buildNebula({ extent: 900, puffs: 80 });
  neb.position.set(-1900, 260, -3000); G.add(neb);

  const sky = buildStarfieldDome({ radius: 3200, count: 5000 });
  G.add(sky);
  return G;
}

export const CATALOG = [
  { id: 'player', label: 'SHIP_Player_Fighter_01', meta: '12 m · caza ligero · nose +Z', build: buildPlayerFighter },
  { id: 'capital', label: 'SHIP_Capital_Dreadnought_01', meta: '2.600 m · nave capital enemiga · 5 motores', build: () => buildCapitalShip({}) },
  { id: 'ast_med', label: 'ENV_Asteroid_Medium_01', meta: '≈22 m · seed 20481', build: buildAsteroidMedium01 },
  { id: 'ast_lrg', label: 'ENV_Asteroid_Large_01', meta: '≈100 m · seed 88117 · vetas minerales', build: buildAsteroidLarge01 },
  { id: 'field', label: 'ENV_AsteroidField_01', meta: '34 rocas · 4 prototipos instanciados', build: () => buildAsteroidField({}) },
  { id: 'earth', label: 'ENV_Planet_EarthLike_01', meta: 'r 60 · biomas horneados, nubes, atmósfera', build: () => buildPlanetEarthLike({}) },
  { id: 'gas', label: 'ENV_Planet_GasGiant_01', meta: 'r 90 · bandas + gran tormenta', build: () => buildPlanetGasGiant({}) },
  { id: 'ring', label: 'ENV_Planet_Ringed_01', meta: 'r 78 · 4 bandas de anillos', build: () => buildPlanetRinged({}) },
  { id: 'moon', label: 'ENV_Moon_Rocky_01', meta: 'r 18 · 40 cráteres', build: () => buildMoonRocky({}) },
  { id: 'star', label: 'ENV_Star_Yellow_01', meta: 'r 120 · limb darkening + corona', build: () => buildStar({}) },
  { id: 'nebula', label: 'ENV_Nebula_Blue_01', meta: '110 billboards + estrellas embebidas', build: () => buildNebula({}) },
  { id: 'sky', label: 'ENV_Skybox_DeepSpace', meta: '6.000 estrellas · temperatura variable', build: () => buildStarfieldDome({}) },
  { id: 'demo', label: 'DEMO_VerticalSlice', meta: 'composición completa a escala', build: buildDemoScene },
];
