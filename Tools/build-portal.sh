#!/usr/bin/env bash
# Empaqueta la versión para portales de juegos (itch.io, CrazyGames, Poki).
#
# Diferencias con la que corre en Vercel:
#   · sin muestras de sonido ni caza del enjambre ajenos — suena el motor
#     sintetizado y vuela el caza procedural del kit (todo original)
#   · three.js incluido dentro: los portales sirven el juego desde su propio
#     dominio y no quieren que dependa de una CDN de terceros
#   · sin los scripts de analítica de Vercel, que allí no existen
#   · index.html en la RAÍZ del zip, que es lo que exige itch.io
#
# Uso: Tools/build-portal.sh   →   dist/space-battle-portal.zip
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
OUT="$ROOT/dist/portal"
THREE_VER="0.184.0"

rm -rf "$OUT" && mkdir -p "$OUT/vendor/addons" "$OUT/assets/ships"

# --- three.js y los cargadores que usa el juego ---
# Se siguen las importaciones en cadena: three.module.js tira de three.core.js,
# GLTFLoader de SkeletonUtils… ir añadiéndolas a mano se rompe en cada versión.
echo "· descargando three.js $THREE_VER (siguiendo importaciones)"
python3 - "$OUT" "$THREE_VER" <<'PY'
import os, re, sys, urllib.request
out, ver = sys.argv[1], sys.argv[2]
CDN = f"https://unpkg.com/three@{ver}"
# destino local -> url remota
seeds = {
    "vendor/three.module.js": f"{CDN}/build/three.module.js",
    "vendor/addons/utils/BufferGeometryUtils.js": f"{CDN}/examples/jsm/utils/BufferGeometryUtils.js",
    "vendor/addons/loaders/OBJLoader.js": f"{CDN}/examples/jsm/loaders/OBJLoader.js",
    "vendor/addons/loaders/GLTFLoader.js": f"{CDN}/examples/jsm/loaders/GLTFLoader.js",
}
done, pending, n = set(), list(seeds.items()), 0
IMPORT = re.compile(r"""(?:from|import)\s+['"](\.[^'"]+)['"]""")
while pending:
    local, url = pending.pop()
    if local in done:
        continue
    done.add(local)
    dst = os.path.join(out, local)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    src = urllib.request.urlopen(url, timeout=60).read().decode()
    open(dst, "w").write(src)
    n += 1
    for rel in set(IMPORT.findall(src)):
        if rel.startswith("three"):        # lo resuelve el importmap
            continue
        nxt_local = os.path.normpath(os.path.join(os.path.dirname(local), rel))
        nxt_url = urllib.parse_url if False else urllib.request.urljoin(url, rel)
        pending.append((nxt_local, nxt_url))
print(f"  {n} archivos de three.js incluidos")
PY

# --- código del juego y modelos propios ---
cp "$ROOT/Web/game.js" "$ROOT/Web/net.js" "$OUT/"

# El multijugador SÍ viaja al portal, pero sin regalar nada: PeerJS se incluye
# dentro (nada de CDN de terceros) y el relé se pide a tu endpoint de Vercel por
# URL absoluta, así el secreto de Cloudflare se queda en tu servidor y solo
# viajan credenciales temporales. Las claves de Metered se borran del paquete.
echo "· incluyendo PeerJS"
python3 - "$OUT" <<'PY'
import os, re, sys, urllib.request
out = sys.argv[1]
pending, done, n = [("vendor/peerjs.js", "https://esm.sh/peerjs@1.5.4")], set(), 0
IMPORT = re.compile(r"""(?:from|import)\s*['"]([^'"]+)['"]""")
while pending:
    local, url = pending.pop()
    if local in done:
        continue
    done.add(local)
    dst = os.path.join(out, local)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    src = urllib.request.urlopen(url, timeout=60).read().decode()
    n += 1
    # cada dependencia se guarda con nombre plano y se reescribe la referencia
    for ref in set(IMPORT.findall(src)):
        if not (ref.startswith("/") or ref.startswith("http") or ref.startswith(".")):
            continue
        abs_url = urllib.request.urljoin(url, ref)
        name = "vendor/" + re.sub(r"[^A-Za-z0-9._-]", "_", abs_url.split("/")[-1] or "dep.js")
        if not name.endswith(".js"):
            name += ".js"
        src = src.replace(f"'{ref}'", f"'./{os.path.basename(name)}'").replace(f'"{ref}"', f'"./{os.path.basename(name)}"')
        pending.append((name, abs_url))
    open(dst, "w").write(src)
print(f"  {n} archivos de PeerJS incluidos")
PY
python3 - "$OUT/net.js" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
s = s.replace("import Peer from 'https://esm.sh/peerjs@1.5.4';",
              "import Peer from './vendor/peerjs.js';")
# el relé se pide al endpoint de Vercel, que es quien guarda el secreto
s = s.replace("const TURN_API = '/api/turn';",
              "const TURN_API = 'https://space-battle-sand.vercel.app/api/turn';")
# fuera las claves de Metered: no deben viajar en un paquete que se distribuye
s = re.sub(r"const METERED_APP = '[^']*';", "const METERED_APP = '';", s)
s = re.sub(r"const METERED_KEY = '[^']*';", "const METERED_KEY = '';", s)
s = re.sub(r"const FREE_TURN = \[[^\]]*\];", "const FREE_TURN = [];", s, flags=re.S)
open(p, 'w').write(s)
print('  net.js: relé por tu endpoint, sin credenciales en el paquete')
PY
mkdir -p "$OUT/Tools/viewer"
cp "$ROOT/Tools/viewer/"*.js "$OUT/Tools/viewer/"
# solo los modelos originales: fuera el caza del enjambre con IP ajena
cp "$ROOT/Web/assets/SHIP_Enemy_Gunship_01.obj" \
   "$ROOT/Web/assets/SHIP_Capital_Imperial_Orb_01.obj" \
   "$ROOT/Web/assets/ENV_Nebula_Blue_01.obj" \
   "$ROOT/Web/assets/ENV_Galaxy_Spiral_01.obj" "$OUT/assets/"
cp "$ROOT/Web/assets/ships/ship-"*.glb "$OUT/assets/ships/"

# --- index.html: raíz del zip, importmap local, bandera de versión limpia ---
python3 - "$ROOT/Web/index.html" "$OUT/index.html" <<'PY'
import re, sys
src, dst = sys.argv[1], sys.argv[2]
html = open(src).read()
html = html.replace('"https://unpkg.com/three@0.184.0/build/three.module.js"', '"./vendor/three.module.js"')
html = html.replace('"https://unpkg.com/three@0.184.0/examples/jsm/"', '"./vendor/addons/"')
# fuera la analítica de Vercel: en un portal no existe ese endpoint
html = re.sub(r'\s*<script defer src="/_vercel/[^"]+"></script>', '', html)
# bandera antes del módulo, para que game.js la vea al arrancar
html = html.replace('<script type="module" src="./game.js"></script>',
                    '<script>window.SB_CLEAN = true;</script>\n'
                    '<script type="module" src="./game.js"></script>')
open(dst, 'w').write(html)
print('  index.html reescrito: three.js local, sin analítica, versión limpia')
PY

# el juego carga el visor con ../Tools/viewer/…; desde la raíz del zip sobra el ..
python3 - "$OUT/game.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace("'../Tools/viewer/", "'./Tools/viewer/")
open(p, 'w').write(s)
print('  rutas del visor ajustadas a la raíz del zip')
PY

mkdir -p "$ROOT/dist"
( cd "$OUT" && zip -qr "$ROOT/dist/space-battle-portal.zip" . )
echo "✓ dist/space-battle-portal.zip  ($(du -h "$ROOT/dist/space-battle-portal.zip" | cut -f1))"
