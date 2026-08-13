#!/usr/bin/env bash
# Batería del tablón de salas. Por defecto contra el wrangler dev local;
# con un argumento, contra la URL que se le pase (para probar el desplegado).
#   test-worker.sh                              → http://127.0.0.1:8792
#   test-worker.sh https://xxx.workers.dev      → el Worker publicado
B="${1:-http://127.0.0.1:8792}"
RUN="t$$-$(date +%s)"          # ids propios de esta ejecución: no dependemos de
                               # un tablón vacío ni pisamos salas reales
fails=0
chk() { if [ "$2" = "$3" ]; then echo "✓ $1"; else echo "✗ $1"; echo "    esperado: $2"; echo "    obtenido: $3"; fails=$((fails+1)); fi; }
post() { curl -s -X POST -H 'Content-Type: text/plain' -d "$1" "$B/rooms"; }
code() { curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: text/plain' -d "$1" "$B/rooms"; }
get()  { curl -s "$B/rooms"; }
py()   { python3 -c "import sys,json;d=json.load(sys.stdin);R={r['id']:r for r in d['rooms']};A='$RUN-aaa';E='$RUN-evil';W='$RUN-weird';print($1)"; }

chk "el tablón no trae salas de esta prueba" "0" "$(get | py "len([k for k in R if k.startswith('$RUN')])")"

post '{"id":"'$RUN'-aaa","secret":"s1","seq":1,"name":"MARTIN","players":3,"max":8,"mode":"teams"}' >/dev/null
chk "sala anunciada aparece"  "True"   "$(get | py "A in R")"
chk "contador de jugadores"   "3"      "$(get | py "R[A]['players']")"
chk "modo conservado"         "teams"  "$(get | py "R[A]['mode']")"
chk "el secreto no es público" "False" "$(get | py "any('secret' in r for r in d['rooms'])")"

post '{"id":"'$RUN'-aaa","secret":"s1","seq":2,"name":"MARTIN","players":6,"max":8,"mode":"teams"}' >/dev/null
sleep 9
chk "el latido actualiza, no duplica" "1|6" "$(get | py "str(len([k for k in R if k.startswith('$RUN')]))+'|'+str(R[A]['players'])")"

post '{"id":"'$RUN'-evil","secret":"s2","seq":1,"name":"<img src=x onerror=alert(1)>","players":1}' >/dev/null
chk "nombre sin < > \" ' \\" "True" "$(get | py "all(c not in R[E]['name'] for c in '<>\"\\'\\\\')")"
chk "nombre recortado a 14"  "True" "$(get | py "len(R[E]['name'])<=14")"

post '{"id":"'$RUN'-weird","secret":"s3","seq":1,"name":"X","players":999,"max":-3,"mode":"nonsense"}' >/dev/null
chk "players acotado a 8"     "8"    "$(get | py "R[W]['players']")"
chk "max acotado a [2,8]"     "True" "$(get | py "2<=R[W]['max']<=8")"
chk "modo desconocido → ffa"  "ffa"  "$(get | py "R[W]['mode']")"
chk "orden por jugadores" "True" "$(get | py "[r['players'] for r in d['rooms']]==sorted([r['players'] for r in d['rooms']],reverse=True)")"

# --- propiedad ---
chk "un extraño no cierra la sala ajena" "403" "$(code '{"id":"'$RUN'-aaa","secret":"HACKER","seq":9,"closed":true}')"
chk "ni la falsea"                       "403" "$(code '{"id":"'$RUN'-aaa","secret":"HACKER","seq":9,"name":"PWNED","players":1}')"
chk "sin secreto tampoco"                "403" "$(code '{"id":"'$RUN'-aaa","seq":9,"closed":true}')"
chk "sigue intacta" "MARTIN" "$(get | py "R[A]['name']")"

# --- orden de los avisos ---
post '{"id":"'$RUN'-aaa","secret":"s1","seq":10,"closed":true}' >/dev/null
post '{"id":"'$RUN'-aaa","secret":"s1","seq":9,"name":"MARTIN","players":6}' >/dev/null   # rezagado
sleep 9
chk "un latido rezagado no resucita la sala" "False" "$(get | py "A in R")"
post '{"id":"'$RUN'-aaa","secret":"s1","seq":11,"name":"MARTIN","players":2}' >/dev/null
sleep 9
chk "reabrir a propósito sí funciona" "True" "$(get | py "A in R")"

# --- validación y límites ---
chk "POST sin id → 400"     "400" "$(code '{"name":"X"}')"
chk "JSON inválido → 400"   "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: text/plain' -d 'no soy json' $B/rooms)"
chk "ruta desconocida → 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' $B/otra-cosa)"
chk "método no admitido → 405" "405" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $B/rooms)"
chk "preflight OPTIONS → 204" "204" "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS $B/rooms)"
python3 -c "print('x'*4000)" > /tmp/sb-big.txt
chk "cuerpo de 4 KB → 413" "413" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: text/plain' --data-binary @/tmp/sb-big.txt $B/rooms)"

hdrs=$(curl -s -D- -o /dev/null -H 'Origin: https://games.crazygames.com' $B/rooms)
has() { printf '%s' "$hdrs" | grep -qi "$1" && echo True || echo False; }
chk "CORS abierto"                    "True" "$(has 'access-control-allow-origin: \*')"
chk "el navegador no cachea la lista" "True" "$(has 'cache-control: no-store')"
chk "preflight cacheado 24 h"         "True" "$(curl -s -D- -o /dev/null -X OPTIONS $B/rooms | grep -qi 'access-control-max-age: 86400' && echo True || echo False)"

# limpieza: solo lo nuestro, y con su secreto
for pair in "aaa:s1" "evil:s2" "weird:s3"; do
  post "{\"id\":\"$RUN-${pair%%:*}\",\"secret\":\"${pair##*:}\",\"seq\":999999,\"closed\":true}" >/dev/null
done

echo; [ $fails -eq 0 ] && echo "Todo correcto" || echo "$fails FALLOS"
exit $fails
