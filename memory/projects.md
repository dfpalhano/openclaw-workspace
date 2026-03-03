# memory/projects.md — App Ideas & Projects
# Load when: nestd, Lodgr, Jess, Echo, Forma, Forte, app ideas, SaaS discussion
# ⚠️ All ideas are confidential — do not share

## nestd.life
- **Concept**: Lifestyle platform for finding compatible housemates. "Create your own family — in clicks."
- NOT a room listing site — about finding your people, chosen family
- Target: both seekers AND people with rooms to fill
- Growth: organic only, no paid ads
- Domain: nestd.life (owned, ~$15/yr GoDaddy)
- Trademark: NESTD clear — register via IP Australia (~$250, after domain)
- Income target: $50k+/year to be worth pursuing
- **Landing page**: ~/projects/nestd-landing/index.html — built 3 Mar (commit 357432f)
  - Design: off-white #FAFAF8, terracotta #C4714A, sage #6B7F6E, Plus Jakarta Sans
  - Sections: Hero → How it works → Why nestd → Testimonials → Waitlist → Footer
  - Waitlist form (client-side only, no backend yet)
  - Next: deploy to Vercel free tier, point nestd.life domain

## Lodgr
- Productised version of Mission Control's financial tracking
- Tiers: $29 / $59 / $99 per month
- Target market: small property managers like Diego
- MC dashboard ID: p18

## Jess Bot
- Flatmates.com.au auto-reply bot
- File: `/home/diegopalhano/projects/jess-bot/jess-v2.js`
- Status: running, sending messages, 35 pending approvals
- MC dashboard ID: p19
- See decisions.md for full architecture

## Echo Bot
- WhatsApp-only auto-draft bot
- `...` activation (per-chat only)
- Every outgoing message requires Telegram approval
- Designed, not yet built — waiting for Jess to stabilise
- Separate codebase from Jess

## Other Projects (MC dashboard)
- Forma: p11
- AI Psychologist: p12
- Property Sourcing Tracker: p13
- Maintenance Crew Network: p14
- Staff Retention & Onboarding: p15
- Forte: p16

## Coding Tools
- Claude Code: /home/diegopalhano/.npm-global/bin/claude (working ✅)
- Codex CLI v0.107.0: installed but requires ChatGPT Pro to run (NOT working with sk-proj- key)
- Use Claude Code for overnight coding tasks

## Deployment
- Mission Control: mc.inspectionsxraytesting.com.au (Cloudflare Tunnel)
- nestd.life: Vercel free tier (not yet deployed)
- Vercel connect: `npx vercel` in ~/projects/nestd-landing
