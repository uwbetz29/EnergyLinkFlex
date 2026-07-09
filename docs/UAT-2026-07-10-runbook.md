# EnergyLink FLEX — Hands-on UAT Runbook (2026-07-10)

Customer: EnergyLink engineer, hands-on (they drive). App is live on prod.

- **URL:** https://energylinkflex.vercel.app
- **Login:** `energylink` / `Linder`
- **Demo project:** "QA — 24081 Sheet 2" (GA drawing) — id `215a08eb-403d-41c7-b0f9-0fd6cceecac2`
- **Reset between runs:** `node scripts/qa/reset-demo.mjs` then RELOAD the tab (clears all dim edits + markups back to the base drawing).

---

## Pre-flight (do 10 min before they join)

1. `cd /Users/mike/dev/EnergyLinkFlex && node scripts/qa/reset-demo.mjs` → confirms "Reset to clean baseline."
2. Open the URL, log in, open the demo project. **Let the drawing fully render** (the base CAD is a 41.9 MB drawing; first paint takes a few seconds — warming it now means it's instant when they join).
3. **Warm the AI:** click a dimension in the drawing, nudge it, hit ✓, wait for the "Checking downstream…" pill to finish (~10 s the first time). This wakes the model so the live cascade is snappier.
4. `node scripts/qa/reset-demo.mjs` again + **reload** → back to a pristine drawing for the real start.
5. Have a **pre-generated Bid Package PDF** saved locally as a fallback (Export → Bid Package once, keep the file).

---

## The story to tell (the value arc)

"You open the base TITAN design, adapt a few section dimensions for this customer's bid, the tool flags anything that violates engineering limits and explains it in plain English, you mark it up, and one click gives you a branded bid package. Minutes, not a CAD redraw."

## Suggested hands-on flow (let them drive; you narrate)

| Step | What they do | What to point out |
|---|---|---|
| 1. Orient | Look at the base GA drawing | Real equipment + dimensions from the source CAD |
| 2. Instant resize | Select a component (e.g. **4000 Stack** or **SCR Duct**) in the sidebar → click **+1'** | Drawing stretches in place, instantly. This is the core move. |
| 3. Change ledger | Open **Changes** (top bar) | Every edit tracked, old → new + % |
| 4. Before / After | Click the **eye / Before** toggle | Flip between the original and the configured drawing — the demo "wow" |
| 5. AI check | Click a **dimension in the drawing** → change the value → ✓ | ~10 s "Checking downstream…", then a **plain-language summary** ("what changed & stays within limits") + any **engineering caution** banner. This is the differentiator: it reasons about the change. |
| 6. Markup | Pick **Arrow / Text**, draw on the drawing | Red markups; they track the geometry if it's stretched |
| 7. Undo/Redo | Top bar | Non-destructive |
| 8. Deliverable | **Export → Bid Package** | 2-page branded PDF: drawing + change ledger + configured-dimensions table |

## Reset between runs

`node scripts/qa/reset-demo.mjs` + **reload the tab**. Takes ~2 s. Do this before each fresh run so nobody starts from someone else's edits.

---

## Guardrails / things to know

- **Single-sheet project** → no sheet tabs appear, so the multi-sheet feature (still on the roadmap) can't be wandered into. Good.
- **AI cascade takes ~10 s** (it's a real Opus reasoning call). Narrate during the wait ("it's checking clearances and downstream components now"). For the pure geometry story use the **+1' quick-adjust** — that's instant and has no AI wait.
- **Export on this big drawing takes a few seconds** to rasterize. It works; if it ever errors it fails gracefully — just retry. Keep the pre-generated PDF as a backstop.
- **Dark shapes in the drawing are REAL equipment** (fan wheels, ducts, skids) from the source CAD — not a rendering bug. Say so if asked.
- Edits + markups **persist** (survive reload) and auto-save — hence the reset script between runs.

## Likely engineer questions — ready answers

| Question | Answer |
|---|---|
| "How accurate are these dimensions?" | It's a **configuration / sales tool, not CAD**. Dimensions are directional and editable for bid speed + clarity; final engineering is still done in CAD. The value is turning a base design into a customer-specific bid in minutes. |
| "Does it handle multiple sheets / the full drawing set?" | Single-sheet today; **multi-sheet is designed and on the roadmap** (per-sheet edit tracking). |
| "Is the AI making engineering decisions?" | No — it **flags** constraints and explains changes; the engineer stays in control. The warnings are advisories to check. |
| "Can we export to our formats?" | Today: branded **PDF + PNG** and a 2-page bid package. Other formats are a roadmap item. |

## If something goes wrong

- Drawing won't render / looks stuck → reload; it re-fetches from CDN (warm now).
- AI pill hangs > ~20 s → it'll time out gracefully; the deterministic summary still shows what changed. Carry on.
- Anything dirty → `node scripts/qa/reset-demo.mjs` + reload.

---

## What's NOT in this MVP (so you can frame scope)

Multi-sheet edit tracking, additional export formats, and a couple of minor UX polish items (Undo/Redo don't move the drawing while the Before view is showing). None block the core story.
