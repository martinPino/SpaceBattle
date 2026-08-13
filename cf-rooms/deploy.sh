#!/usr/bin/env bash
# Publica el tablón de salas en Cloudflare y deja el juego apuntando a él.
#
#   1) npx wrangler login --use-keyring     (una vez; abre el navegador)
#   2) cf-rooms/deploy.sh
#
# El paso 2 despliega, lee la URL que devuelve Cloudflare y reescribe ROOMS_API
# en Web/net.js. Sin esto habría que copiar el subdominio a mano y es justo el
# tipo de detalle que se queda desactualizado.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD/.."
W="$ROOT/Web/net.js"

# Un token exportado en el shell PISA silenciosamente al login del navegador, y
# esta máquina mezcla cuenta personal y de trabajo: mejor verlo que descubrirlo
# desplegando en la cuenta equivocada.
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "⚠ CLOUDFLARE_API_TOKEN está exportado y tiene prioridad sobre 'wrangler login'."
  echo "  Si no es el que quieres, ejecuta:  unset CLOUDFLARE_API_TOKEN"
fi
echo "· cuenta activa:"
./node_modules/.bin/wrangler whoami 2>&1 | sed -n '1,12p'

echo
echo "· desplegando…"
OUT=$(./node_modules/.bin/wrangler deploy 2>&1) || { echo "$OUT"; exit 1; }
echo "$OUT" | tail -12

URL=$(printf '%s' "$OUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || { echo "✗ no encuentro la URL en la salida del deploy; revísala arriba"; exit 1; }

python3 - "$W" "$URL/rooms" <<'PY'
import re, sys
path, url = sys.argv[1], sys.argv[2]
s = open(path).read()
new, n = re.subn(r"const ROOMS_API = '[^']*';", f"const ROOMS_API = '{url}';", s)
assert n == 1, f"esperaba una definición de ROOMS_API, encontré {n}"
open(path, 'w').write(new)
print(f"  Web/net.js → ROOMS_API = {url}")
PY

echo
echo "✓ tablón publicado. Comprobación:"
curl -s "$URL/rooms"; echo
echo
echo "Recuerda reconstruir los paquetes de portales:  Tools/build-portal.sh"
