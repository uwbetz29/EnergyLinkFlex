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
