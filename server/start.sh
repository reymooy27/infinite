#!/bin/sh
set -e

# Start tailscaled in background with userspace networking
tailscaled --tun=userspace-networking --state=/data/tailscaled.state &

# Wait for tailscaled to be ready
echo "[start] Waiting for tailscaled..."
for i in $(seq 1 30); do
  if tailscale status >/dev/null 2>&1; then
    echo "[start] tailscaled ready"
    break
  fi
  sleep 1
done

# Authenticate with Tailscale
echo "[start] Authenticating with Tailscale..."
tailscale up --authkey="$TAILSCALE_AUTH_KEY" --accept-routes --socks5-server=127.0.0.1:1055
echo "[start] Tailscale authenticated"

# Wait for SOCKS5 proxy on port 1055
echo "[start] Waiting for Tailscale SOCKS5 proxy..."
for i in $(seq 1 10); do
  if curl -s --socks5 127.0.0.1:1055 http://100.100.100.100 >/dev/null 2>&1 || nc -z 127.0.0.1 1055 2>/dev/null; then
    echo "[start] SOCKS5 proxy ready on 127.0.0.1:1055"
    break
  fi
  sleep 1
done

echo "[start] Starting app..."
exec npx tsx index.ts