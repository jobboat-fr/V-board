#!/bin/sh
set -eu

# Blocks accidental public access to a Docker-published TCP port by inserting
# a DOCKER-USER rule. Docker keeps this chain across container restarts.
#
# Usage:
#   sudo AZZCO_BLOCK_PUBLIC_PORT=63118 ./scripts/security/harden-docker-published-port.sh
#
# Optional:
#   AZZCO_PUBLIC_IFACE=eth0     # override auto-detected public interface

PORT="${AZZCO_BLOCK_PUBLIC_PORT:-${1:-63118}}"
IFACE="${AZZCO_PUBLIC_IFACE:-}"

case "$PORT" in
    *[!0-9]*|"") echo "invalid port: $PORT" >&2; exit 2 ;;
esac

if [ -z "$IFACE" ]; then
    IFACE="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i == "dev") {print $(i+1); exit}}')"
fi

if [ -z "$IFACE" ]; then
    echo "could not detect public interface; set AZZCO_PUBLIC_IFACE" >&2
    exit 2
fi

iptables -N DOCKER-USER 2>/dev/null || true

if ! iptables -C DOCKER-USER -i "$IFACE" -p tcp -m conntrack --ctstate NEW --dport "$PORT" -j DROP 2>/dev/null; then
    iptables -I DOCKER-USER 1 -i "$IFACE" -p tcp -m conntrack --ctstate NEW --dport "$PORT" -j DROP
fi

iptables -S DOCKER-USER
