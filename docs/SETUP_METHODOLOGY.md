# Remote Access Setup Methodology
*Rocky Linux 10.x — maintained by Smith 🛠️*

---

## Overview

Three pillars of remote access:
| Service | Protocol | Port | Auth |
|---------|----------|------|------|
| OpenSSH (sshd) | SSH | 22 (TCP) | Public key only |
| NoMachine | NX | 4000 (TCP+UDP) | NX credentials |
| Tailscale | WireGuard | 41641 (UDP) + DERP fallback | OAuth device auth |

All three are systemd-managed, enabled for boot (`systemctl enable`), and protected by firewalld.

---

## 1. Tailscale

### Installation
```bash
# Install from tailscale repo
dnf install -y tailscale
systemctl enable --now tailscaled
tailscale up --operator=$(whoami)
```

### Auth Persistence
Tailscale stores auth state in `/var/lib/tailscale/tailscaled.state`. Once authenticated, `WantRunning=true` is persisted there — the daemon reconnects automatically on reboot or network changes without re-auth.

Check: `tailscale debug prefs | grep WantRunning` should show `true`.

### DNS Fix (Critical)
Tailscale manages `/etc/resolv.conf` for MagicDNS. If the file gets an immutable flag set by another tool, Tailscale will log a DNS error but remain connected. To fix:

```bash
# Check for immutable flag
lsattr /etc/resolv.conf

# Remove it (as root)
chattr -i /etc/resolv.conf
```

After removal, Tailscale will update the file on its next DNS refresh cycle.

### Systemd Drop-in (Resilience)
Create `/etc/systemd/system/tailscaled.service.d/10-resilience.conf`:
```ini
[Service]
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
```
This upgrades from `on-failure` to `always` so the daemon restarts on any exit including clean stops.

### Verification
```bash
tailscale status          # Shows connected peers and IPs
tailscale netcheck        # DERP relay, UDP connectivity, latency
tailscale ip -4           # This machine's Tailscale IPv4
systemctl status tailscaled
```

---

## 2. NoMachine (nxserver)

### Installation
Download `.rpm` from https://www.nomachine.com/download/linux and install:
```bash
rpm -i nomachine_<version>_x86_64.rpm
systemctl enable nxserver
systemctl start nxserver
```

### Firewall
```bash
firewall-cmd --permanent --add-port=4000/tcp
firewall-cmd --permanent --add-port=4000/udp
firewall-cmd --reload
```

### Service Config
The unit file at `/usr/lib/systemd/system/nxserver.service` has `Restart=always`. Add `RestartSec` via drop-in:

Create `/etc/systemd/system/nxserver.service.d/10-resilience.conf`:
```ini
[Service]
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
```

### Dependency Ordering
The NX unit file includes:
```
After = syslog.target network.target network-online.target sshd.service
Wants = network-online.target
```
This ensures NX only starts after full network is ready — correct for a remote desktop service.

### Verification
```bash
systemctl status nxserver
/usr/sbin/ss -tlnp | grep 4000    # Should show 0.0.0.0:4000 and [::]:4000
/usr/NX/bin/nxserver --status     # Requires root
```

---

## 3. SSH / Termius

### Security Posture (key-only)
Ensure `/etc/ssh/sshd_config` (or drop-ins in `/etc/ssh/sshd_config.d/`) contain:
```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
```

Verify: `sshd -T | grep -E '(passwordauthentication|permitrootlogin|pubkeyauthentication)'`

### Authorized Keys
Store authorized keys in `~/.ssh/authorized_keys`. Avoid duplicates — they're harmless but create confusion:
```bash
# Deduplicate while preserving order
awk '!seen[$0]++' ~/.ssh/authorized_keys > /tmp/ak && mv /tmp/ak ~/.ssh/authorized_keys
```

### Systemd Drop-in (Resilience)
The default Rocky Linux sshd unit has `RestartSec=42s` — too slow for recovery. Override:

Create `/etc/systemd/system/sshd.service.d/10-resilience.conf`:
```ini
[Service]
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
```

### Firewall
```bash
firewall-cmd --list-services     # Should include 'ssh'
# If missing:
firewall-cmd --permanent --add-service=ssh
firewall-cmd --reload
```

### Verification
```bash
systemctl status sshd
/usr/sbin/ss -tlnp | grep :22
journalctl -u sshd -n 20
```

---

## 4. Reboot Resilience Checklist

After any system change, verify:
```bash
# All three enabled for boot
systemctl is-enabled tailscaled sshd nxserver

# All three currently running
systemctl is-active tailscaled sshd nxserver

# Ports listening
/usr/sbin/ss -tlnp | grep -E '(22|4000)'

# Tailscale connected
tailscale status | grep -v offline

# Firewall allows access
firewall-cmd --list-all
```

### Simulate Post-Reboot State
```bash
# Restart all three in dependency order
systemctl restart tailscaled
sleep 5
systemctl restart sshd
systemctl restart nxserver

# Verify
systemctl status tailscaled sshd nxserver
```

---

## 5. Quick Fix Script

If any service needs re-hardening (e.g., after OS update reverts drop-ins):
```bash
sudo bash ~/.openclaw/workspace/docs/fix-remote-access.sh
```

This script:
1. Removes immutable flag from `/etc/resolv.conf` (fixes Tailscale DNS)
2. Creates systemd drop-ins for resilience
3. Reloads systemd
4. Verifies all services are active

---

## Known Issues & Notes

| Issue | Cause | Fix |
|-------|-------|-----|
| Tailscale DNS health warning | `/etc/resolv.conf` immutable flag | `chattr -i /etc/resolv.conf` as root |
| `tailscale` reports OFF in openclaw status | Possible stale status check at boot | Run `tailscale status` to verify actual state |
| `ss` command not in default PATH | Use `/usr/sbin/ss` explicitly | Or `export PATH=$PATH:/usr/sbin` |

---

*Last updated: 2026-03-09 by Smith*
