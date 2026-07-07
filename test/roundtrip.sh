#!/usr/bin/env bash
# NarChat — izole roundtrip test koşucusu.
# e2e_roundtrip.py KENDİ sunucusunu başlatmaz; bu sarmalayıcı izole port + mktemp veri
# ile bir sunucu kaldırır, PyNaCl'lı venv ile testi koşar, sonra temizler.
# Canlı veri/'ye ASLA dokunmaz. Çalıştır:  bash test/roundtrip.sh
set -euo pipefail
KOK="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${NARCHAT_VENV:-/tmp/narchat-e2e-venv}"
PORT="${NARCHAT_PORT:-8105}"
VERI="$(mktemp -d /tmp/narchat-rt-XXXXXX)"

# 1) PyNaCl'lı venv (yoksa kur)
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" -q install pynacl
fi

# 2) izole sunucu
NARCHAT_PORT="$PORT" NARCHAT_VERI="$VERI" python3 "$KOK/mesaj_server.py" >/dev/null 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true; rm -rf "$VERI"' EXIT
for i in $(seq 1 50); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/api/ben" && break || sleep 0.1
done

# 3) test
NARCHAT_PORT="$PORT" "$VENV/bin/python" "$KOK/test/e2e_roundtrip.py"
