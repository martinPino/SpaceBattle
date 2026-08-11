// SPACE ASSET KIT — procedural PBR texture bakery (canvas → three textures)
// Mirrors the node groups in Tools/Blender/sk_materials.py.
import * as THREE from 'three';

/* ---------- noise (same hash as the model generators) ---------- */
function hash2(i, j, seed) {
  let n = (i * 374761393 + j * 668265263 + seed * 9781) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
const sm = (t) => t * t * (3 - 2 * t);
function vn2(x, y, seed) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = sm(x - i), fy = sm(y - j);
  const a = hash2(i, j, seed), b = hash2(i + 1, j, seed);
  const c = hash2(i, j + 1, seed), d = hash2(i + 1, j + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
// tileable value noise: wrap the lattice at `period`
function vn2t(x, y, seed, period) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = sm(x - i), fy = sm(y - j);
  const w = (a, b) => hash2(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const a = w(i, j), b = w(i + 1, j), c = w(i, j + 1), d = w(i + 1, j + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
function fbm2(x, y, seed, oct = 5, period = 8) {
  let a = 0.5, s = 0, n = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    s += a * vn2t(x * f, y * f, seed + o * 137, period * f);
    n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}
function rng(seed) { let s = seed >>> 0 || 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function canvas(size, h = size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = h;
  return c;
}
function texFrom(cv, { srgb = false, repeat = [1, 1] } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
/** Sobel a height array into a tangent-space normal map. */
function normalFromHeight(h, w, ht, strength = 2.4) {
  const cv = canvas(w, ht);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, ht);
  const at = (x, y) => h[((y + ht) % ht) * w + ((x + w) % w)];
  for (let y = 0; y < ht; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
function grayTex(arr, w, ht, lo = 0, hi = 1) {
  const cv = canvas(w, ht);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, ht);
  for (let i = 0; i < arr.length; i++) {
    const v = Math.max(0, Math.min(1, lo + arr[i] * (hi - lo))) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
const memo = (fn) => { let v; return (...a) => (v === undefined ? (v = fn(...a)) : v); };

/* ============================================================
   ROCK — regolith: fine grain, micro-craters, hairline cracks
   ============================================================ */
export const rockMaps = (() => {
  const cache = new Map();
  return function rockMaps(palette = 'grey', seed = 11, S = 512) {
    const key = palette + seed;
    if (cache.has(key)) return cache.get(key);
    const rnd = rng(seed * 31 + 5);
    const N = S * S;
    const height = new Float32Array(N);
    const rough = new Float32Array(N);
    const albedo = canvas(S);
    const actx = albedo.getContext('2d');
    const img = actx.createImageData(S, S);

    const tint = {
      grey: [130, 128, 124], dark: [92, 92, 96], red: [140, 90, 68],
      ice: [186, 204, 218], metal: [116, 112, 105],
    }[palette] || [124, 122, 119];

    // impact craters: composited with min/max (never stacked) so the
    // surface reads as distinct impacts instead of rippled foam
    const craters = [];
    for (let i = 0; i < 30; i++) craters.push({ x: rnd() * S, y: rnd() * S, r: 6 + Math.pow(rnd(), 2.0) * 78, deep: 0.55 + rnd() * 0.45 });
    // hairline cracks as polylines
    const cracks = [];
    for (let i = 0; i < 16; i++) {
      const pts = [];
      let x = rnd() * S, y = rnd() * S, a = rnd() * 6.28;
      for (let k = 0; k < 12; k++) { pts.push([x, y]); a += (rnd() - 0.5) * 1.1; x += Math.cos(a) * 22; y += Math.sin(a) * 22; }
      cracks.push(pts);
    }
    const crackMask = (() => {
      const cv = canvas(S);
      const c = cv.getContext('2d');
      c.fillStyle = '#000'; c.fillRect(0, 0, S, S);
      c.strokeStyle = '#fff'; c.lineCap = 'round';
      cracks.forEach((pts) => {
        c.lineWidth = 0.6 + rnd() * 1.1;
        c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
      });
      return c.getImageData(0, 0, S, S).data;
    })();

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const u = x / S * 8, v = y / S * 8;
        let h = fbm2(u, v, seed, 6, 8);                       // regolith grain
        h += fbm2(u * 6, v * 6, seed + 91, 3, 48) * 0.4;       // fine dust
        h += fbm2(u * 22, v * 22, seed + 143, 2, 176) * 0.22;  // gravel speckle
        let dent = 0, rim = 0, floor = 0;
        for (const c of craters) {
          let dx = Math.abs(x - c.x), dy = Math.abs(y - c.y);
          dx = Math.min(dx, S - dx); dy = Math.min(dy, S - dy);
          const d = Math.hypot(dx, dy);
          if (d < c.r * 1.25) {
            const t = d / c.r;
            if (t < 1) {
              const bowl = -c.deep * (1 - t * t) * 0.85;
              if (bowl < dent) { dent = bowl; floor = Math.max(floor, 1 - t); }
            }
            rim = Math.max(rim, Math.exp(-Math.pow((t - 0.98) * 11, 2)) * c.deep * 0.5);
          }
        }
        const crack = crackMask[i * 4] / 255;
        h = h * 0.5 + dent + rim - crack * 0.3;
        height[i] = h;

        // albedo: large-scale regolith patches + fresh bright rims + dark floors
        const patch = fbm2(u * 0.45, v * 0.45, seed + 511, 3, 4);
        const grit = fbm2(u * 3.2, v * 3.2, seed + 88, 3, 26);
        let shade = 0.86 + (patch - 0.5) * 0.42 + (grit - 0.5) * 0.16;
        shade += rim * 0.55 - floor * 0.24;
        let r = tint[0] * shade, g = tint[1] * shade, b = tint[2] * shade;
        if (palette === 'metal' && fbm2(u * 2.2, v * 2.2, seed + 707, 3, 18) > 0.62) {
          r = r * 0.5 + 150 * 0.5; g = g * 0.5 + 140 * 0.5; b = b * 0.5 + 120 * 0.5; // metallic fleck
        }
        const o = i * 4;
        img.data[o] = Math.min(255, r * (1 - crack * 0.24));
        img.data[o + 1] = Math.min(255, g * (1 - crack * 0.24));
        img.data[o + 2] = Math.min(255, b * (1 - crack * 0.24));
        img.data[o + 3] = 255;
        rough[i] = 0.86 + (1 - Math.max(0, Math.min(1, h + 0.5))) * 0.12;
      }
    }
    actx.putImageData(img, 0, 0);
    const out = {
      map: texFrom(albedo, { srgb: true, repeat: [3, 2] }),
      normalMap: texFrom(normalFromHeight(height, S, S, 3.2), { repeat: [3, 2] }),
      roughnessMap: texFrom(grayTex(rough, S, S), { repeat: [3, 2] }),
    };
    cache.set(key, out);
    return out;
  };
})();

/* ============================================================
   HULL — panel plates, seams, rivets, brushed metal, wear
   ============================================================ */
export const hullMaps = (() => {
  const cache = new Map();
  return function hullMaps(variant = 'dark', seed = 3) {
    if (cache.has(variant)) return cache.get(variant);
    const S = 1024;
    const rnd = rng(seed * 977 + 3);
    const base = { dark: [56, 61, 68], mid: [116, 123, 132], light: [196, 201, 206], black: [22, 24, 28] }[variant] || [56, 61, 68];
    const cv = canvas(S);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    ctx.fillRect(0, 0, S, S);

    // plate patchwork: each plate a slightly different value
    const plates = [];
    (function split(x, y, w, h, depth) {
      if (depth === 0 || w < 70 || h < 70) { plates.push([x, y, w, h]); return; }
      if (w > h) { const c = w * (0.32 + rnd() * 0.36); split(x, y, c, h, depth - 1); split(x + c, y, w - c, h, depth - 1); }
      else { const c = h * (0.32 + rnd() * 0.36); split(x, y, w, c, depth - 1); split(x, y + c, w, h - c, depth - 1); }
    })(0, 0, S, S, 5);
    plates.forEach(([x, y, w, h]) => {
      const d = (rnd() - 0.5) * 26;
      ctx.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d})`;
      ctx.fillRect(x, y, w, h);
    });
    // brushed streaks
    for (let i = 0; i < 2600; i++) {
      const y = rnd() * S, len = 30 + rnd() * 260, a = (rnd() - 0.5) * 40;
      ctx.strokeStyle = `rgba(255,255,255,${0.012 + rnd() * 0.02})`;
      ctx.lineWidth = 0.6 + rnd();
      ctx.beginPath(); ctx.moveTo(rnd() * S, y); ctx.lineTo(rnd() * S + len, y + a); ctx.stroke();
    }
    // seams
    const seams = [];
    plates.forEach(([x, y, w, h]) => {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2.2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      seams.push([x, y, w, h]);
      // inner detail: a vent grille or a hatch on some plates
      if (rnd() > 0.62 && w > 110 && h > 90) {
        const gx = x + w * 0.2, gy = y + h * 0.25, gw = w * 0.6, gh = h * 0.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.4;
        ctx.strokeRect(gx, gy, gw, gh);
        const bars = 3 + Math.floor(rnd() * 5);
        for (let b = 0; b < bars; b++) {
          const yy = gy + (gh / bars) * (b + 0.5);
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2.6;
          ctx.beginPath(); ctx.moveTo(gx + 4, yy); ctx.lineTo(gx + gw - 4, yy); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(gx + 4, yy + 2); ctx.lineTo(gx + gw - 4, yy + 2); ctx.stroke();
        }
      }
      // rivet rows along the plate edge
      if (rnd() > 0.35) {
        const n = Math.floor(w / 26);
        for (let r = 0; r < n; r++) {
          const rx = x + 14 + r * 26, ry = y + 9;
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(rx, ry, 2.4, 0, 6.3); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.arc(rx - 0.6, ry - 0.8, 1.5, 0, 6.3); ctx.fill();
        }
      }
    });
    // subtle grime + micro scratches
    for (let i = 0; i < 90; i++) {
      const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 120;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(20,18,16,${0.05 + rnd() * 0.07})`);
      g.addColorStop(1, 'rgba(20,18,16,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
    }
    for (let i = 0; i < 320; i++) {
      ctx.strokeStyle = `rgba(230,235,240,${0.03 + rnd() * 0.06})`;
      ctx.lineWidth = 0.5 + rnd() * 0.7;
      const x = rnd() * S, y = rnd() * S;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 60); ctx.stroke();
    }

    // height / roughness from the same drawing (luminance of seams & rivets)
    const data = ctx.getImageData(0, 0, S, S).data;
    const h = new Float32Array(S * S);
    const rgh = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      const l = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) / 255;
      h[i] = l;
      rgh[i] = 0.28 + (1 - l) * 0.5;
    }
    const out = {
      map: texFrom(cv, { srgb: true, repeat: [2, 2] }),
      normalMap: texFrom(normalFromHeight(h, S, S, 2.2), { repeat: [2, 2] }),
      roughnessMap: texFrom(grayTex(rgh, S, S), { repeat: [2, 2] }),
    };
    cache.set(variant, out);
    return out;
  };
})();

/* ============================================================
   PLANET / STAR detail maps (equirect UVs from SphereGeometry)
   ============================================================ */
export const planetDetail = memo(() => {
  const S = 512;
  const h = new Float32Array(S * S);
  const rgh = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = fbm2(x / S * 10, y / S * 10, 55, 6, 10);
      h[i] = n;
      rgh[i] = 0.55 + n * 0.4;
    }
  }
  return {
    normalMap: texFrom(normalFromHeight(h, S, S, 1.5), { repeat: [6, 3] }),
    roughnessMap: texFrom(grayTex(rgh, S, S), { repeat: [6, 3] }),
  };
});

export const starMaps = memo((tint = [1, 0.82, 0.42]) => {
  const S = 1024, H = 512;
  const cv = canvas(S, H);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // fine granulation only — subtle, no sunspots, no streaks
      const gran = fbm2(x / S * 160, y / H * 80, 9, 3, 160);
      const cell = fbm2(x / S * 46, y / H * 23, 21, 3, 46);
      const b = 0.88 + gran * 0.09 + cell * 0.07;
      const o = i * 4;
      // white-hot core color: tint only barely shows through
      img.data[o] = Math.min(255, 255 * (0.92 + tint[0] * 0.08) * b);
      img.data[o + 1] = Math.min(255, 255 * (0.82 + tint[1] * 0.16) * b);
      img.data[o + 2] = Math.min(255, 255 * (0.62 + tint[2] * 0.3) * b);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = texFrom(cv, { srgb: true, repeat: [1, 1] });
  return { map: t, emissiveMap: t };
});

/* ============================================================
   EARTH-LIKE PLANET — baked equirect albedo/bump/roughness + clouds
   ============================================================ */
export const earthMaps = (() => {
  const cache = new Map();
  return function earthMaps(seed = 4211, ocean_level = 0.52) {
    if (cache.has(seed)) return cache.get(seed);
    const S = 2048, H = 1024;
    const cv = canvas(S, H);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, H);
    const height = new Float32Array(S * H);
    const rough = new Float32Array(S * H);
    const mix = (a, b, t) => a + (b - a) * t;
    const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
    // spherical sampling so noise has no seam and no polar pinch
    for (let y = 0; y < H; y++) {
      const lat = (y / H - 0.5) * Math.PI;           // -pi/2..pi/2
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < S; x++) {
        const lon = (x / S) * Math.PI * 2;
        const px = cl * Math.cos(lon), py = sl, pz = cl * Math.sin(lon);
        const i = y * S + x;
        // continents: broad fbm + ridged detail
        let h = fbm3(px * 1.35, py * 1.35, pz * 1.35, seed, 5) * 0.5 + 0.5;
        h += (fbm3(px * 4.2, py * 4.2, pz * 4.2, seed + 91, 4)) * 0.18;
        const ridge = 1 - Math.abs(fbm3(px * 6.5, py * 6.5, pz * 6.5, seed + 55, 4));
        const land = h - ocean_level;
        const moist = fbm3(px * 2.6, py * 2.6, pz * 2.6, seed + 203, 3) * 0.5 + 0.5;
        const absLat = Math.abs(sl);                  // 0 eq .. 1 pole
        let c, r;
        if (land < 0) {
          // ocean: vivid satellite blue, brighter toward shelves
          const t = Math.min(1, -land * 9);
          c = lerp3([0.10, 0.34, 0.62], [0.035, 0.14, 0.42], t);
          // tight glint: low roughness = small GGX lobe (energy capped by
          // specularIntensity on the material)
          r = 0.13 + fbm3(px * 34, py * 34, pz * 34, seed + 505, 2) * 0.05;
          height[i] = 0.42;
        } else {
          const alt = Math.min(1, land * 5.5);
          const mountain = Math.max(0, ridge - 0.62) * 2.2 * alt;
          // biomes: latitude x moisture
          const desert = [0.68, 0.55, 0.33], savanna = [0.46, 0.42, 0.20];
          const forest = [0.12, 0.27, 0.09], taiga = [0.15, 0.24, 0.12];
          const tundra = [0.42, 0.40, 0.34];
          let base;
          if (absLat < 0.28) base = lerp3(desert, forest, moist);
          else if (absLat < 0.55) base = lerp3(savanna, forest, moist);
          else if (absLat < 0.75) base = lerp3(tundra, taiga, moist);
          else base = tundra;
          // coastal sand strip
          if (land < 0.015) base = lerp3([0.55, 0.48, 0.33], base, land / 0.015);
          // rock + snow on peaks
          if (mountain > 0.25) base = lerp3(base, [0.36, 0.33, 0.30], Math.min(1, (mountain - 0.25) * 2.4));
          if (mountain > 0.55 || absLat > 0.92 - alt * 0.1) base = [0.87, 0.89, 0.92];
          // shore blend: fade land into shelf water over the first texels
          if (land < 0.006) base = lerp3([0.10, 0.34, 0.62], base, 0.35 + (land / 0.006) * 0.65);
          c = base;
          r = 0.88;
          height[i] = 0.5 + alt * 0.4 + mountain * 0.25;
        }
        // polar ice with noisy edge
        const iceEdge = 0.86 + fbm3(px * 7, py * 7, pz * 7, seed + 71, 5) * 0.09;
        if (absLat > iceEdge) { c = [0.90, 0.93, 0.96]; r = 0.5; height[i] = Math.max(height[i], 0.55); }
        const o = i * 4;
        img.data[o] = c[0] * 255; img.data[o + 1] = c[1] * 255; img.data[o + 2] = c[2] * 255;
        img.data[o + 3] = 255;
        rough[i] = r;
      }
    }
    ctx.putImageData(img, 0, 0);
    // clouds: domain-warped wisps + explicit cyclone swirls (satellite look)
    const ccv = canvas(S, H);
    const cctx = ccv.getContext('2d');
    const cimg = cctx.createImageData(S, H);
    const crnd = rng(seed * 17 + 3);
    const cyclones = [];
    for (let k = 0; k < 6; k++) {
      const cLat = (0.15 + crnd() * 0.75) * (crnd() > 0.5 ? 1 : -1);  // mid-latitudes
      const cLon = crnd() * Math.PI * 2;
      const c = [Math.cos(cLat) * Math.cos(cLon), Math.sin(cLat), Math.cos(cLat) * Math.sin(cLon)];
      const up = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let t1 = [c[1] * up[2] - c[2] * up[1], c[2] * up[0] - c[0] * up[2], c[0] * up[1] - c[1] * up[0]];
      const l1 = Math.hypot(...t1); t1 = t1.map(v => v / l1);
      const t2 = [c[1] * t1[2] - c[2] * t1[1], c[2] * t1[0] - c[0] * t1[2], c[0] * t1[1] - c[1] * t1[0]];
      cyclones.push({ c, t1, t2, R: 0.15 + crnd() * 0.15, spin: crnd() > 0.5 ? 1 : -1, str: 0.9 + crnd() * 0.4 });
    }
    for (let y = 0; y < H; y++) {
      const lat = (y / H - 0.5) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < S; x++) {
        const lon = (x / S) * Math.PI * 2;
        const px = cl * Math.cos(lon), py = sl, pz = cl * Math.sin(lon);
        // domain warp: makes the streaks curl instead of banding
        const wx = fbm3(px * 2.6 + 7.1, py * 2.6, pz * 2.6, seed + 900, 3);
        const wy = fbm3(px * 2.6, py * 2.6 + 13.7, pz * 2.6, seed + 930, 3);
        const wz = fbm3(px * 2.6, py * 2.6, pz * 2.6 + 29.3, seed + 960, 3);
        const qx = px + wx * 0.5, qy = py + wy * 0.3, qz = pz + wz * 0.5;
        // zonal wisps: stretched along longitude, fine filament detail
        let n = fbm3(qx * 2.0, qy * 6.5, qz * 2.0, seed + 700, 5) * 0.5 + 0.5;
        n += fbm3(qx * 6, qy * 20, qz * 6, seed + 811, 3) * 0.3;
        // S-curve remap: real opaque whites (smoothstep, not linear+pow)
        const ss = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
        let a = ss(0.45, 0.72, n);
        // cyclones: bright spiral arms + solid core, independent of base noise
        for (const cy of cyclones) {
          const dotc = px * cy.c[0] + py * cy.c[1] + pz * cy.c[2];
          const d = Math.acos(Math.max(-1, Math.min(1, dotc)));
          if (d < cy.R) {
            const u = px * cy.t1[0] + py * cy.t1[1] + pz * cy.t1[2];
            const v = px * cy.t2[0] + py * cy.t2[1] + pz * cy.t2[2];
            const ang = Math.atan2(v, u);
            const t = d / cy.R;
            const arm = 0.5 + 0.5 * Math.sin(ang * 2 * cy.spin + t * 9.0 + seed);
            const sw = (Math.exp(-t * 1.9) + arm * Math.exp(-t * 1.1) * 0.8) * cy.str;
            // fray the arm edges with the fine noise, but never cap them by it
            a = Math.max(a, Math.min(1, sw * 0.85 * (0.75 + n * 0.35)));
          }
        }
        // alphaMap samples the GREEN channel: bake coverage into RGB, alpha=255
        const o = (y * S + x) * 4;
        const cov = a * 255;
        cimg.data[o] = cov; cimg.data[o + 1] = cov; cimg.data[o + 2] = cov;
        cimg.data[o + 3] = 255;
      }
    }
    cctx.putImageData(cimg, 0, 0);
    const cloudTex = new THREE.CanvasTexture(ccv);
    cloudTex.colorSpace = THREE.SRGBColorSpace;
    const out = {
      map: texFrom(cv, { srgb: true }),
      bumpMap: texFrom(grayTex(height, S, H)),
      roughnessMap: texFrom(grayTex(rough, S, H)),
      cloudsMap: cloudTex,
    };
    cache.set(seed, out);
    return out;
  };
})();

// 3D-domain fbm used by the planet bake (seamless on the sphere)
function hash3t(i, j, k, seed) {
  let n = (i * 374761393 + j * 668265263 + k * 1274126177 + seed * 9781) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function vn3(x, y, z, seed) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = sm(x - i), fy = sm(y - j), fz = sm(z - k);
  let r = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        r += w * hash3t(i + dx, j + dy, k + dz, seed);
      }
  return r * 2 - 1;
}
function fbm3(x, y, z, seed, oct = 4) {
  let a = 0.5, s = 0, n = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    s += a * vn3(x * f + 31.7, y * f + 11.3, z * f + 47.9, seed + o * 137);
    n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}

/* radial falloff sprite: the building block for glows and gas billboards */
export const radialGlow = (() => {
  const cache = new Map();
  return function radialGlow(rgb = [1, 1, 1], core = 0.35, soft = false) {
    const key = rgb.join() + core + soft;
    if (cache.has(key)) return cache.get(key);
    const S = 256;
    const cv = canvas(S);
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    const c = (a, mul = 1) => 'rgba(' + Math.round(rgb[0] * 255 * mul) + ',' +
      Math.round(rgb[1] * 255 * mul) + ',' + Math.round(rgb[2] * 255 * mul) + ',' + a + ')';
    if (soft) {                       // gas: no hot core, long tail
      g.addColorStop(0, c(0.5));
      g.addColorStop(0.35, c(0.26));
      g.addColorStop(0.7, c(0.08));
      g.addColorStop(1, c(0));
    } else {                          // star glow: white-hot core
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(core, c(0.8));
      g.addColorStop(0.65, c(0.18));
      g.addColorStop(1, c(0));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, t);
    return t;
  };
})();

/* ============================================================
   ENVIRONMENT — equirect space HDR-ish: key star, nebula, stars.
   Without it, metalness has nothing to reflect and reads as plastic.
   ============================================================ */
export function makeSpaceEnvironment(renderer) {
  const S = 1024, H = 512;
  const cv = canvas(S, H);
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a1020'); g.addColorStop(0.5, '#05070d'); g.addColorStop(1, '#0c0a12');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, H);
  const rnd = rng(4242);
  // nebula washes
  [['#1f4fd8', 0.5], ['#7a2fd8', 0.35], ['#0f8fa8', 0.3], ['#d8632f', 0.22]].forEach(([c, a]) => {
    for (let i = 0; i < 6; i++) {
      const x = rnd() * S, y = rnd() * H, r = 120 + rnd() * 320;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = a * 0.28; ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
    }
  });
  ctx.globalAlpha = 1;
  // key star: the bright source metals will mirror
  const kx = S * 0.72, ky = H * 0.3;
  const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, 190);
  kg.addColorStop(0, '#ffffff'); kg.addColorStop(0.08, '#fff3d8');
  kg.addColorStop(0.3, 'rgba(255,210,150,0.35)'); kg.addColorStop(1, 'rgba(255,180,110,0)');
  ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(kx, ky, 190, 0, 6.3); ctx.fill();
  // cool bounce opposite
  const bx = S * 0.2, by = H * 0.66;
  const bg = ctx.createRadialGradient(bx, by, 0, bx, by, 260);
  bg.addColorStop(0, 'rgba(90,150,220,0.5)'); bg.addColorStop(1, 'rgba(40,70,120,0)');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, 260, 0, 6.3); ctx.fill();
  // stars
  for (let i = 0; i < 2600; i++) {
    const b = Math.pow(rnd(), 3);
    ctx.fillStyle = `rgba(${220 + b * 35},${228 + b * 27},255,${0.25 + b * 0.75})`;
    ctx.fillRect(rnd() * S, rnd() * H, 1 + b * 1.6, 1 + b * 1.6);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  return { env, background: tex };
}
