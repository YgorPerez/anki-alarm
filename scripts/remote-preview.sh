#!/usr/bin/env bash
# Publishes a local page at a temporary public https link (Cloudflare Quick
# Tunnel, no account), to open it on a phone or send it to someone. See
# docs/agents/remote-preview.md.
#
#   scripts/remote-preview.sh <folder> [port]   # serves a repo folder (default port 8765)
#   scripts/remote-preview.sh --port <port>     # tunnels a server already running on 127.0.0.1:<port>
#   scripts/remote-preview.sh stop              # takes down the server, proxy and tunnel

set -euo pipefail

STATE=/tmp/anki-alarm-remote-preview
BIN="$HOME/.local/bin/cloudflared"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$STATE"

stop() {
  for name in tunnel proxy server; do
    if [[ -f "$STATE/$name.pid" ]]; then
      kill "$(cat "$STATE/$name.pid")" 2>/dev/null || true
      rm -f "$STATE/$name.pid"
    fi
  done
}

if [[ "${1:-}" == stop ]]; then
  stop
  echo "Server, proxy and tunnel stopped."
  exit 0
fi
if [[ $# -lt 1 ]]; then
  sed -n '6,8p' "$0" >&2
  exit 1
fi

# cloudflared: the one on PATH or an official binary downloaded to ~/.local/bin.
CF="$(command -v cloudflared || true)"
if [[ -z "$CF" ]]; then
  if [[ ! -x "$BIN" ]]; then
    case "$(uname -m)" in
      x86_64) ARCH=amd64 ;;
      aarch64 | arm64) ARCH=arm64 ;;
      *) echo "Architecture $(uname -m) has no binary planned here." >&2; exit 1 ;;
    esac
    echo "Downloading cloudflared ($ARCH) to $BIN..." >&2
    mkdir -p "$(dirname "$BIN")"
    curl -fsSL -o "$BIN" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH"
    chmod +x "$BIN"
  fi
  CF="$BIN"
fi

# One run at a time: the previous one goes down before the new one comes up.
stop

FOLDER=""
if [[ "$1" == --port ]]; then
  # The target server may only accept local Host/Origin headers, so a small
  # proxy rewrites them; the tunnel points at the proxy.
  TARGET="${2:?--port needs a port}"
  PORT=$((TARGET + 1))
  python3 -I "$ROOT/scripts/host-proxy.py" "$PORT" "$TARGET" >"$STATE/proxy.log" 2>&1 &
  echo $! >"$STATE/proxy.pid"
else
  FOLDER="$(cd "$ROOT/$1" && pwd)"
  PORT="${2:-8765}"
  # The server only listens on 127.0.0.1; whoever comes from outside goes through the tunnel.
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$FOLDER" >"$STATE/server.log" 2>&1 &
  echo $! >"$STATE/server.pid"
fi

rm -f "$STATE/tunnel.log"
"$CF" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" >"$STATE/tunnel.log" 2>&1 &
echo $! >"$STATE/tunnel.pid"

URL=""
for _ in $(seq 60); do
  URL="$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$STATE/tunnel.log" | head -1 || true)"
  [[ -n "$URL" ]] && break
  sleep 0.5
done
if [[ -z "$URL" ]]; then
  echo "The tunnel returned no link within 30 s. Log at $STATE/tunnel.log:" >&2
  tail -20 "$STATE/tunnel.log" >&2
  stop
  exit 1
fi

echo "$URL" >"$STATE/url"
if [[ -n "$FOLDER" ]]; then
  echo "Folder: ${FOLDER#"$ROOT"/}"
  for f in "$FOLDER"/*.html; do
    [[ -e "$f" ]] && echo "$URL/$(basename "$f")"
  done
else
  echo "$URL/"
fi
