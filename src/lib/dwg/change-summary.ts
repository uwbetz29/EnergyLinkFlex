/**
 * Deterministic plain-language change summary (WS2).
 *
 * Pure module: turns applied dimension changes (a primary user edit plus any
 * downstream cascade changes) into ONE salesperson-readable English sentence.
 * No React, no DOM, no LLM, no I/O, no side effects, no input mutation.
 */

import { parseDimInches } from "@/lib/dwg/svg-stretch";

export interface AppliedChange {
  componentName: string;
  dimLabel: string;
  oldValue: string; // formatted dimension string, e.g. `12'-0"`
  newValue: string; // formatted dimension string
}

/** Direction verb pairs keyed by dim-label keyword: [grew, shrank]. */
const VERB_PAIRS: ReadonlyArray<readonly [keyword: string, grew: string, shrank: string]> = [
  ["width", "Widened", "Narrowed"],
  ["height", "Raised", "Lowered"],
  ["length", "Lengthened", "Shortened"],
];

const GENERIC_GREW = "Increased";
const GENERIC_SHRANK = "Reduced";
const NEUTRAL_VERB = "Adjusted";

/**
 * Pick the direction verb for a change from its dim label (case-insensitive
 * keyword match) and the numeric sign of (new - old). If either value is
 * unparseable or the magnitudes are equal, the neutral "Adjusted" is used.
 */
function directionVerb(change: AppliedChange): string {
  const oldInches = parseDimInches(change.oldValue);
  const newInches = parseDimInches(change.newValue);
  if (oldInches === null || newInches === null || newInches === oldInches) {
    return NEUTRAL_VERB;
  }
  const grew = newInches > oldInches;
  const label = change.dimLabel.toLowerCase();
  for (const [keyword, grewVerb, shrankVerb] of VERB_PAIRS) {
    if (label.includes(keyword)) {
      return grew ? grewVerb : shrankVerb;
    }
  }
  return grew ? GENERIC_GREW : GENERIC_SHRANK;
}

/** Join items as: 1 → "a"; 2 → "a and b"; 3+ → "a, b and c". */
function joinList(items: string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Render the cascade list: sorted by componentName using a plain code-point
 * comparison (not locale-aware), each as `Name (Label → newValue)`.
 * Sorts a copy so the caller's array is never mutated.
 */
function cascadeList(cascades: AppliedChange[]): string {
  const rendered = [...cascades]
    .sort((a, b) =>
      a.componentName < b.componentName ? -1 : a.componentName > b.componentName ? 1 : 0
    )
    .map((c) => `${c.componentName} (${c.dimLabel} → ${c.newValue})`);
  return joinList(rendered);
}

/**
 * Build the one-sentence summary of an applied change set.
 *
 * @param primary  The user's own dimension edit that triggered the cascade,
 *                 or null when only cascade changes were applied.
 * @param cascades Downstream changes the engine applied in response.
 * @returns The summary sentence, or null when there is nothing to say.
 */
export function buildDeterministicSummary(
  primary: AppliedChange | null,
  cascades: AppliedChange[]
): string | null {
  if (primary === null && cascades.length === 0) {
    return null;
  }

  if (primary === null) {
    return `Cascade applied: ${cascadeList(cascades)}.`;
  }

  const verb = directionVerb(primary);
  const primaryClause = `${verb} ${primary.componentName}'s ${primary.dimLabel} from ${primary.oldValue} to ${primary.newValue}.`;

  const cascadeClause =
    cascades.length === 0
      ? "No downstream components required changes."
      : `This cascaded to ${cascadeList(cascades)}.`;

  return `${primaryClause} ${cascadeClause}`;
}
