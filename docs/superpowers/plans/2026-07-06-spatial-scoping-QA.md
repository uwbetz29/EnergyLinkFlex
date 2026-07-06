# Spatial Scoping — Manual Browser QA Checklist

Run once the app boots locally (port 3002) with AI creds and a Titan Sheet_2 DWG uploaded.
The automated gate (vitest 64/64, tsc, lint, offline golden harness on the real SVG) is
already green; this checklist covers what only a human-in-browser can confirm.

## Setup
- [ ] Dev server on **port 3002** (local disk clone, NOT Google Drive). Sign in.
- [ ] Upload `24081-CS1-0001_Sheet_2.dwg`; open it in the editor. Drawing renders (white
      paper, black lines, no blob/section-marker clutter).

## Height change (annotation-distortion fix)
- [ ] Raise the **silencer** ~4 ft (edit its dim, or via the AI bar).
- [ ] Both the near AND end elevation silencers grow together (height stays consistent).
- [ ] The overall-height total re-values (e.g. 50'-0" → 54'-0"), per punchlist #7.
- [ ] **No dimension text on the companion (end) elevation is distorted** — numbers stay
      upright and correctly proportioned (this is the #5 fix).
- [ ] **Undo** returns the drawing to the exact original (geometry + all dimension text).

## Width change (companion-slide fix)
- [ ] Widen a **near-view duct** ~2 ft.
- [ ] Only the near elevation changes width; the **end elevation does NOT slide sideways**
      or distort (Finding 7 gap #2).
- [ ] Undo restores exactly.

## Safety net (never show a corrupt drawing)
- [ ] Temporarily lower `DEFAULT_MAX_ELEMENTS` in `svg-stretch.ts` (e.g. to 100) OR add a
      test edit that would over-scale; make a dimension edit.
- [ ] The drawing stays UNCHANGED (prior known-good state), and the amber warning banner
      appears ("Couldn't safely apply this change; the drawing was left unchanged.").
- [ ] Dismiss the banner (✕); it clears. A subsequent valid edit clears it and applies.
- [ ] Revert the temporary budget change.
- [ ] (Negative-value guard) If reachable via the AI bar: an AI response that would mirror
      the drawing is refused with the same banner, never shown mirrored.

## Performance
- [ ] A silencer/duct edit on the full ~75k-element drawing completes well within the
      4000ms watchdog budget (no freeze; ~1-2s expected). No watchdog-timeout banner on a
      normal edit.

## Sign-off
- [ ] All above pass → the feature is customer-ready. Note any deviation here:
