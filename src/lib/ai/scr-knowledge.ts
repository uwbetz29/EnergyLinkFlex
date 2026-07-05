/**
 * Shared SCR/CO Catalyst System domain knowledge for AI prompts.
 * Used by both the modify endpoint and the identify-component endpoint.
 */

export const SCR_SYSTEM_KNOWLEDGE = `## SCR/CO Catalyst System Engineering Knowledge

### System Architecture (gas flow order, upstream → downstream)
Turbine → Gas Path → D.I. Duct → T.A. Duct → Dist. Grid Duct → SCR Duct → Silencer → Stack

### Component Relationships
When modifying dimensions, the following engineering rules apply:

1. **Vertical cascade**: Increasing the height of any duct shifts ALL components above it upward.
   - Example: Adding 2' to SCR Duct height → Silencer and Stack shift up 2' → overall system height increases 2'.
   - Nozzle positions on the modified duct adjust proportionally.

2. **Width changes**: Changing a duct width requires checking:
   - Inside liner dimensions (must fit within duct)
   - Distribution grid alignment
   - Adjacent platform/ladder clearance
   - Nozzle offsets may shift

3. **Nozzle positioning**: Nozzles (N1-N16) are connection points defined relative to their parent duct.
   - Moving a nozzle's elevation = changing its Y/Height dimension
   - Nozzle centerline offset = horizontal distance from duct centerline

4. **Platform & ladder**: Access structures must maintain:
   - Minimum walkway width (typically 3'-0")
   - Handrail clearance
   - Ladder-to-platform alignment

5. **Inside liner**: Must maintain clearance from outer duct walls.

### Dimension Format
All dimensions use imperial ft-in-fractions: e.g., 15'-0 1/8", 9'-8 3/4", 50'-0"
- When increasing by feet, add to the feet portion
- When increasing by inches, handle carry-over (e.g., 15'-11" + 2" = 16'-1")

### Sales Configuration Context
This is a SALES tool. The mechanical engineer is exploring "what if" scenarios:
- "What if we made the SCR duct 3 feet taller?" → Show cascading effects
- "Can we fit a wider distribution grid?" → Check constraints
- "Move nozzle N3 up 6 inches" → Direct modification
- "Show me the impact of extending the stack" → Multi-component cascade

Always provide clear, professional engineering language. Quantify changes precisely.
When cascading changes, explain the engineering rationale.`;

/** Common component types in SCR/CO systems for identification */
export const SCR_COMPONENT_TYPES = [
  "duct",        // SCR Duct, D.I. Duct, T.A. Duct, Dist. Grid Duct
  "structure",   // Catalyst Frame, Support Steel
  "equipment",   // Silencer, Stack, Turbine
  "internal",    // Distribution Grid, Inside Liner, Catalyst Bed
  "access",      // Platform, Ladder, Walkway
  "nozzle",      // N1-N16 connection points
  "flow",        // Gas Path, Tempering Air, Turbine Outlet
] as const;

export type ScrComponentType = (typeof SCR_COMPONENT_TYPES)[number];

/** Color palette for user-created components */
export const USER_COMPONENT_COLORS = [
  "#2563eb", // blue
  "#7c3aed", // violet
  "#059669", // emerald
  "#d97706", // amber
  "#dc2626", // red
  "#0891b2", // cyan
  "#4f46e5", // indigo
  "#c026d3", // fuchsia
  "#ea580c", // orange
  "#0d9488", // teal
];

/** Icon mapping for component types */
export const COMPONENT_TYPE_ICONS: Record<string, string> = {
  duct: "D",
  structure: "S",
  equipment: "E",
  internal: "I",
  access: "A",
  nozzle: "N",
  flow: "F",
  default: "C",
};
