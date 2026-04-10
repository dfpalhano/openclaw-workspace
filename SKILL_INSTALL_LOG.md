# Skill Installation Log

All skills inspected via `claw-skill-guard` before install. Log maintained per session.

---

## Legend
- ✅ Installed
- ⏸️ Pending decision
- ❌ Rejected
- 🔴 CRITICAL | 🟡 HIGH | 🟠 MEDIUM | 🟢 LOW | ✅ SAFE

---

## Session: 2026-02-27

### Installed without scan (pre-policy)
| Skill | Status | Notes |
|---|---|---|
| agent-tinman | ✅ | Installed before scan policy |
| claw-skill-guard | ✅ | Security scanner itself |
| local-approvals | ✅ | Installed before scan policy |
| plansuite | ✅ | Installed before scan policy |
| super-skills | ✅ | Installed before scan policy |
| soul-guardian | ✅ | Installed before scan policy |
| context-recovery | ✅ | Flagged — 3 confirms obtained |
| file-search | ✅ | Installed before scan policy |
| ripgrep | ✅ | Installed before scan policy |
| authensor-gateway | ✅ | Installed before scan policy |
| api-credentials-hygiene | ✅ | Installed before scan policy |
| glitchward-shield | ✅ | Installed before scan policy |
| csv-pipeline | ✅ | Installed before scan policy |
| appraisal-ai | ✅ | Installed before scan policy |
| timer | ✅ | Installed before scan policy |
| google-web-search | ✅ | Installed before scan policy |
| searxng | ✅ | Installed before scan policy |
| excel-weekly-dashboard | ✅ | Installed before scan policy |
| design-assets | ✅ | Installed before scan policy |
| ui-ux-design | ✅ | Installed before scan policy |
| senior-frontend | ✅ | Installed before scan policy |
| 1password | ✅ | Installed before scan policy |
| bitwarden | ✅ | Installed before scan policy |
| mspot-generator | ✅ | Installed before scan policy |
| bookkeeping-basics | ✅ | Installed before scan policy |
| expense-tracker-pro | ✅ | Installed before scan policy |
| markdown-converter | ✅ | Installed before scan policy |
| sheetsmith | ✅ | Installed before scan policy |
| upstage-document-parse | ✅ | Installed before scan policy |
| gog | ✅ | Installed before scan policy |
| confluence | ✅ | Installed before scan policy |
| backend-patterns | ✅ | Installed before scan policy |
| agentlens | ✅ | Installed before scan policy |

### Scanned and installed
| Skill | Scanner Result | Status | Notes |
|---|---|---|---|
| anthropic-frontend-design | ✅ SAFE | ✅ Installed | |
| create-content | ✅ SAFE | ✅ Installed | |
| daily-report | ✅ SAFE | ✅ Installed | |
| mineru-pdf | ✅ SAFE | ✅ Installed | |
| md-2-pdf | ✅ SAFE | ✅ Installed | |
| skill-scaffold | ✅ SAFE | ✅ Installed | |
| uv-global | ✅ SAFE | ✅ Installed | |
| serper | 🟢 LOW | ✅ Installed | API key + scraping — legitimate use |
| invoice-generator | 🟢 LOW | ✅ Installed | PDF binary — low risk |
| google-calendar | 🟢 LOW | ✅ Installed | OAuth API — legitimate |
| google-sheet | 🟢 LOW | ✅ Installed | OAuth + service account |
| opengraph-io-skill | 🟠 MEDIUM | ✅ Installed | curl to opengraph.io API only |
| dashboard | 🟠 MEDIUM | ✅ Installed | curl to Stripe API — legitimate |
| glance | 🟠 MEDIUM | ✅ Installed | curl to local Glance instance |
| canva | 🟠 MEDIUM | ✅ Installed | curl to Canva API — legitimate |
| confidant | 🟠 MEDIUM | ✅ Installed | Credential wizard — reviewed |
| agentskills-io | 🟠 MEDIUM | ✅ Installed | Publish skills externally |
| buildlog | 🟠 MEDIUM | ✅ Installed | Session capture — reviewed |

### Scanned — pending decision
| Skill | Scanner Result | Status | Notes |
|---|---|---|---|
| ai-pdf-builder | 🟡 HIGH (2) + 🟠 MEDIUM (2) | ⏸️ Pending | npm binary execution patterns |
| brainz-calendar | 🟡 HIGH (1) | ⏸️ Pending | Shell execution via gcalcli |
| mission-control | 🟡 HIGH (2) + 🟠 MEDIUM (1) | ⏸️ Pending | Spawns local server process |
| cron-scheduling | 🟠 MEDIUM (5) | ⏸️ Deferred | Writes systemd/cron config — owner decision |
| api-dev | 🟠 MEDIUM (12) | ⏸️ Deferred | Broad curl/server patterns — owner decision |

### Rejected
| Skill | Scanner Result | Status | Reason |
|---|---|---|---|
| safe-exec | 🔴 CRITICAL (1) | ❌ Rejected | Critical pattern detected |
| ecap-security-auditor | 🔴 CRITICAL (2) + 🟡 HIGH (3) + 🟠 MEDIUM (11) | ❌ Rejected | Multiple critical patterns |

### Not found in registry
| Skill | Status |
|---|---|
| heimdall | ❌ Not found |
| secure-install | ❌ Not found |
| beautiful-mermaid | ❌ Not found |
| playwright-cli | ❌ Not found |
| agent-observability-dashboard | ❌ Not found |
| canvas-design | ❌ Not found |
| artifacts-builder | ❌ Not found |
| marketing-ideas | ❌ Not found |
| launch-strategy | ❌ Not found |
| budget-variance-analyzer | ❌ Not found |
| docx | ❌ Not found |
| docx-skill | ❌ Not found |
| xlsx | ❌ Not found |

---

*Policy active from 2026-02-27: All future skills scanned with claw-skill-guard before install.*

## 2026-02-27

| Skill | Action | Reason |
|---|---|---|
| youtube-iu | ❌ REJECTED (CRITICAL) | SKILL.md instructs downloading password-protected ZIP + running unknown executable — malware delivery pattern |
| youtube-transcript | ❌ REJECTED (HIGH) | VirusTotal flagged; uses residential IP proxy / WireGuard VPN for transcript fetching |

**Alternative:** Installed `youtube-transcript-api` (pip) directly. Clean, no proxy, handles transcripts natively.

- 07-04-2026 — duxiaoxiong/memu-engine-for-OpenClaw — SAFE — inspected SKILL.md and scanned with claw-skill-guard, no suspicious patterns found. Status: approved for install.
## 2026-04-10 11:02:06Z — archon
- Source: https://github.com/coleam00/archon
- Action: force-install attempted via upstream install script
- Risk: CRITICAL
- Reason flagged: includes multiple curl-pipe-to-shell install commands (bun.sh, claude.ai/install.sh, archon.diy/install)
- Result: installed to ~/.local/bin/archon after 3 explicit confirmations

