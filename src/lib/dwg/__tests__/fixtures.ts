/** Small two-elevation SVG mirroring the LibreDWG structure (datum-aligned views,
 *  a clean X-gutter, plus annotations). Used across view-model and scoping tests. */
export function makeTwoViewSvg(): string {
  const eq = (x: number, y: number) => `<line x1="${x}" y1="${y}" x2="${x + 5}" y2="${y + 5}"/>`;
  const view0 = [100, 150, 200, 250, 300].flatMap((x) => [400, 500, 550, 600, 700].map((y) => eq(x, y))).join("");
  const view1 = [1500, 1550, 1600, 1650, 1700].flatMap((x) => [400, 500, 550, 600, 700].map((y) => eq(x, y))).join("");
  const dimUse = (id: string, x: number, y: number) => `<use href="#${id}" x="${x}" y="${y}"/>`;
  return `<svg viewBox="0 -1000 2000 1000" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <g id="*D1"><text x="80" y="550">8'-0"</text><line x1="80" y1="500" x2="80" y2="600"/></g>
      <g id="*D2"><text x="1480" y="419">21'-3"</text><line x1="1480" y1="291" x2="1480" y2="546"/></g>
      <g id="*D3"><text x="60" y="591">50'-0"</text><line x1="60" y1="291" x2="60" y2="891"/></g>
    </defs>
    <g transform="matrix(1,0,0,-1,0,0)"><g id="*Model_Space">
      ${view0}${view1}
      ${dimUse("*D1", 80, 550)}${dimUse("*D2", 1480, 419)}${dimUse("*D3", 60, 591)}
      <text x="200" y="700">LABEL</text>
      <use href="#CENTER LINE" x="150" y="650"/>
      <use href="#Borders ELC-D" x="1000" y="500"/>
    </g></g></svg>`;
}

/** A single component dimensioned on BOTH axes, for U1/computeComponentBand tests.
 *  Width dim *DW: two vertical extension lines at x=100 and x=200 (X extent [100,200]),
 *  y in [290,310]. Height dim *DH: one vertical line y[50,150] (Y extent [50,150]).
 *  Zero <use> offset → bounds are the raw line coords. */
export function makeComponentBandSvg(): string {
  return `<svg viewBox="0 -400 400 400" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <g id="*DW"><line x1="100" y1="290" x2="100" y2="310"/><line x1="200" y1="290" x2="200" y2="310"/></g>
      <g id="*DH"><line x1="60" y1="50" x2="60" y2="150"/></g>
    </defs>
    <g transform="matrix(1,0,0,-1,0,0)"><g id="*Model_Space">
      <use href="#*DW" x="0" y="0"/>
      <use href="#*DH" x="0" y="0"/>
    </g></g></svg>`;
}

/** For U2 cross-band (2D) scoping tests. A horizontal (width) stretch of zone
 *  X[100,200] targeting cross-band Y[40,60]. Circles exercise the §3 table rows;
 *  extra circles support a multi-zone case (second zone X[600,700], band Y[240,260]).
 *  Coords are Model_Space internal (Y-up); the wrapper carries the matrix(1,0,0,-1) flip.
 *   target  (150,50)  in-band, in-zone    → scale X
 *   neighbour(150,200) OUT-of-band, in-zone → HELD RIGID (the ovaling test)
 *   dsInBand (300,50)  in-band, downstream  → translate X by axisGrowth
 *   dsOutBand(300,200) out-of-band, downstream → translate X by SAME axisGrowth
 *   upstream (50,50)   in-band, upstream    → identity
 *   bIn (150,60)  Y at cHi (in-band w/ half-open+tol) → scale; bOut (150,67) > cHi+TOL → held
 *   mzCross (150,250) in zoneA-X but out zoneA-band, in zoneB-band-Y but not zoneB-X → identity */
export function makeCrossBandSvg(): string {
  const c = (id: string, x: number, y: number) => `<circle id="${id}" cx="${x}" cy="${y}" r="5"/>`;
  return `<svg viewBox="0 -400 900 400" xmlns="http://www.w3.org/2000/svg">
    <g transform="matrix(1,0,0,-1,0,0)"><g id="*Model_Space">
      ${c("target", 150, 50)}${c("neighbour", 150, 200)}${c("dsInBand", 300, 50)}${c("dsOutBand", 300, 200)}${c("upstream", 50, 50)}${c("bIn", 150, 60)}${c("bOut", 150, 67)}${c("mzCross", 150, 250)}${c("zoneBhit", 650, 250)}
    </g></g></svg>`;
}

/* ─── U3 detached-detection fixtures (dense equipment via loops so inter-element
 *     spacing doesn't create false corridors; the only wide gap is intentional) ─── */
const ln = (x: number, y: number) => `<line x1="${x}" y1="${y}" x2="${x + 1}" y2="${y}"/>`;
const grid = (xs: number[], ys: number[]) => xs.flatMap((x) => ys.map((y) => ln(x, y))).join("");
const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let v = a; v <= b; v += step) out.push(v);
  return out;
};
const detachedSvg = (mainYs: number[], skidYs: number[]) =>
  `<svg viewBox="0 -400 100 400" xmlns="http://www.w3.org/2000/svg">
    <g transform="matrix(1,0,0,-1,0,0)"><g id="*Model_Space">
      ${grid(range(10, 79, 3), mainYs)}${grid(range(34, 58, 3), skidYs)}
    </g></g></svg>`;

/** A compact skid Y-separated from the main mass by a WIDE near-empty corridor
 *  (Y[50,150]) → one high-confidence detached candidate at the skid's bbox. */
export function makeDetachedSvg(): string {
  return detachedSvg([30, 50], [150, 165]);
}

/** Same shape but a NARROW corridor (Y[80,94]) → a detached candidate with
 *  confidence BELOW CONF_MIN (the caller would WARN, not silently hold). */
export function makeNarrowDetachedSvg(): string {
  return detachedSvg(range(20, 80, 5), range(92, 117, 5));
}

/** A dense uniform grid with NO corridor on either axis → detectDetachedAssemblies
 *  returns []. */
export function makeDenseSvg(): string {
  return `<svg viewBox="0 -100 100 100" xmlns="http://www.w3.org/2000/svg">
    <g transform="matrix(1,0,0,-1,0,0)"><g id="*Model_Space">
      ${grid(range(10, 70, 4), range(10, 90, 4))}
    </g></g></svg>`;
}

/** Single-view stack mirroring the real 24081 Sheet_2 nesting: the overall
 *  container zone (internal y[291.5, 891.5], the 50'-0") fully contains the
 *  silencer child (y[531.3, 627.3], the 8'-0"). Probe equipment lines and
 *  annotations sit BELOW / in the lower gap / in the child / in the upper gap /
 *  ABOVE, so a black-box test can read each segment's transform. Coordinates are
 *  Model_Space internal (Y-up); attribute y == fastPosition y (the wrapper carries
 *  the matrix(1,0,0,-1) flip). Zones are passed to applyMultiStretch as svgBounds
 *  with negated top/bottom. */
export function makeNestedStackSvg(): string {
  // horizontal segment; midpoint = (x+1, y) so fastPosition y is exact.
  const eq = (x: number, y: number) => `<line x1="${x}" y1="${y}" x2="${x + 2}" y2="${y}"/>`;
  // probes: below(200) lowerGap(400) child(580) upperGap(750) above(950)
  const probes = [200, 400, 580, 750, 950].map((y) => eq(100, y)).join("");
  // filler equipment spread through the gaps and child for realistic classification
  const filler = [340, 460, 560, 600, 700, 820].map((y) => eq(120, y)).join("");
  return `<svg viewBox="0 -1000 200 1000" xmlns="http://www.w3.org/2000/svg">
    <g transform="matrix(1,0,0,-1,0,0)"><g id="*Model_Space">
      ${probes}${filler}
      <text x="100" y="400">GAP_A</text>
      <text x="100" y="580">CHILD_A</text>
      <text x="100" y="950">ABOVE_A</text>
    </g></g></svg>`;
}
