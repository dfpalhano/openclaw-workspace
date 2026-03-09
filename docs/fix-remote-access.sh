#!/usr/bin/env bash
# fix-remote-access.sh
# Harden and ensure persistent remote access: Tailscale, NoMachine, SSH
# Run as: sudo bash fix-remote-access.sh
# Rocky Linux 10.x — Smith 🛠️ — 2026-03-09

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; }
info() { echo -e "      $*"; }

if [[ $EUID -ne 0 ]]; then
  fail "Must be run as root: sudo bash $0"
  exit 1
fi

echo ""
echo "===== Remote Access Hardening Script ====="
echo "===== $(date)                      ====="
echo ""

# ── 1. Fix /etc/resolv.conf immutable flag (blocks Tailscale DNS updates) ──────
echo "-- [1/5] Tailscale DNS: removing immutable flag from /etc/resolv.conf --"
if lsattr /etc/resolv.conf 2>/dev/null | grep -q '^....i'; then
  chattr -i /etc/resolv.conf
  ok "Removed immutable flag from /etc/resolv.conf"
  info "Tailscale will now be able to manage MagicDNS entries"
else
  ok "/etc/resolv.conf is not immutable — no action needed"
fi

# ── 2. Tailscale: upgrade restart policy to Restart=always ─────────────────────
echo ""
echo "-- [2/5] Tailscale: create systemd drop-in for always-restart policy --"
mkdir -p /etc/systemd/system/tailscaled.service.d
cat > /etc/systemd/system/tailscaled.service.d/10-resilience.conf <<'EOF'
# Smith resilience drop-in — 2026-03-09
[Service]
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
EOF
ok "Created /etc/systemd/system/tailscaled.service.d/10-resilience.conf"

# ── 3. SSH: tighten restart timing (42s default is too slow) ───────────────────
echo ""
echo "-- [3/5] SSH: reduce RestartSec from 42s to 5s --"
mkdir -p /etc/systemd/system/sshd.service.d
cat > /etc/systemd/system/sshd.service.d/10-resilience.conf <<'EOF'
# Smith resilience drop-in — 2026-03-09
[Service]
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
EOF
ok "Created /etc/systemd/system/sshd.service.d/10-resilience.conf"

# ── 4. NoMachine: add RestartSec (currently missing, defaults to 100ms) ────────
echo ""
echo "-- [4/5] NoMachine: add RestartSec=5 to existing Restart=always --"
mkdir -p /etc/systemd/system/nxserver.service.d
cat > /etc/systemd/system/nxserver.service.d/10-resilience.conf <<'EOF'
# Smith resilience drop-in — 2026-03-09
[Service]
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
EOF
ok "Created /etc/systemd/system/nxserver.service.d/10-resilience.conf"

# ── 5. Reload and verify ────────────────────────────────────────────────────────
echo ""
echo "-- [5/5] Reload systemd and verify services --"
systemctl daemon-reload
ok "systemd daemon-reload done"

sleep 1

# Verify all 3 services are still running
SERVICES=(tailscaled sshd nxserver)
ALL_OK=true
for svc in "${SERVICES[@]}"; do
  if systemctl is-active --quiet "$svc"; then
    ok "$svc is active"
  else
    fail "$svc is NOT active — attempting restart"
    systemctl restart "$svc" && ok "$svc restarted successfully" || { fail "$svc failed to restart!"; ALL_OK=false; }
  fi
  info "  Restart policy: $(systemctl show "$svc" --property=Restart --value)"
  info "  RestartSec:     $(systemctl show "$svc" --property=RestartUSec --value)"
done

# Verify tailscale connectivity
echo ""
echo "-- Tailscale connectivity check --"
if tailscale status 2>&1 | grep -q "100\."; then
  ok "Tailscale connected: $(tailscale ip -4 2>/dev/null || echo 'see tailscale status')"
else
  warn "Tailscale not showing connected — check: tailscale status"
fi

# Verify NX port
echo ""
echo "-- NoMachine port 4000 check --"
if /usr/sbin/ss -tlnp 2>/dev/null | grep -q ':4000'; then
  ok "NoMachine listening on port 4000"
else
  warn "NoMachine port 4000 not visible in ss output — check: /usr/NX/bin/nxserver --status"
fi

# Verify SSH
echo ""
echo "-- SSH health check --"
if /usr/sbin/ss -tlnp 2>/dev/null | grep -q ':22'; then
  ok "SSH listening on port 22"
fi
if sshd -T 2>/dev/null | grep -qi "passwordauthentication no"; then
  ok "SSH: PasswordAuthentication is off (key-only)"
else
  warn "SSH: PasswordAuthentication status unclear — check sshd_config manually"
fi

echo ""
echo "===== Done ====="
if $ALL_OK; then
  echo -e "${GREEN}All services hardened and running.${NC}"
else
  echo -e "${RED}One or more services had issues — review output above.${NC}"
fi
echo ""
echo "Verify Tailscale DNS health (should clear after resolv.conf fix):"
echo "  tailscale status"
echo ""
echo "Full service status:"
echo "  systemctl status tailscaled nxserver sshd"
