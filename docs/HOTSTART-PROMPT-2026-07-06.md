Resuming EnergyLink FLEX. First read the cumulative handoff at
/Users/mike/dev/EnergyLinkFlex/docs/HANDOFF-2026-07-06.md and the project memory (MEMORY.md
auto-loads; start with project_status.md "COMMIT STATE" block, then offline_lab_findings.md
punchlist). Trust them — don't re-derive.

One-line context: over two sessions we fixed the DATA PIPELINE (never the model) and shipped
the whole offline-provable engine — parse (crash fixed) → dim extraction (0→37) → AI pre-scan
→ multi-dim parametric stretch → auto dim re-valuing → per-view spatial scoping with a safety
net that never renders a corrupt drawing → clean white-paper render. All verified offline
(vitest 64/64, tsc, lint, and a golden harness on the REAL customer drawing) and committed as
3 commits on branch wip/dwg-ai-stretch-checkpoint (NOT pushed).

Work from the LOCAL clone /Users/mike/dev/EnergyLinkFlex (branch wip/dwg-ai-stretch-checkpoint)
— NEVER the Google Drive copy (FUSE mount won't boot the dev server). Dev server = port 3002.
The lab at ~/dev/elf-lab holds the real DWG/SVG, linkedom, and the golden-harness runner
(register.mjs).

Guardrails: commit/push ONLY when I ask; never push main (prod deploy). The auth.ts dev-login
shortcut is reverted (needed to run the app locally — re-add it or use real creds, then revert
again before any commit). DEV_LOGIN_EMAIL is in gitignored .env.local. No customer .dwg/.svg in
the repo. BLUF, no em-dashes, decide-and-act on reversible work, one question at a time.

Where we're picking up — the only thing between here and customer-ready is AI creds (OIDC
expired ~2026-03-14) for the live run + in-browser QA. Immediate options (see handoff "Next
steps"):
  1. Restore AI creds (vercel login + vercel env pull, PRESERVE NEXTAUTH_URL=3002; or
     AI_GATEWAY_API_KEY; or an Anthropic key + @ai-sdk/anthropic), then run the live pre-scan
     on Opus 4.8 and work the browser QA checklist
     (docs/superpowers/plans/2026-07-06-spatial-scoping-QA.md).
  2. AI-cascade value validation follow-up (small, offline): reject nonsensical LLM dim values
     before they reach the stretch engine (safety net already catches mirror/collapse). Sites:
     svg-drawing-canvas.tsx ~L784/788, nl-bar.tsx ~L103/112/119.

Start by confirming the git state (recent history on wip/dwg-ai-stretch-checkpoint includes
the 3 feature commits 8d4ef6c / ca7599a / 16b0346, possibly with a docs commit on top) and
npm test green, then give me a SHORT plan for whichever direction I pick before writing any
code. Ask me which direction if it's not obvious.
