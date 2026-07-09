/**
 * Pure, deterministic progress + ETA estimation for long waits (DWG download,
 * AI cascade, render). No React, no DOM, no I/O, no clocks — callers supply
 * elapsed time; these functions just map raw wait signals to a progress
 * percent and a human-readable ETA.
 *
 * Two modes:
 *  - DETERMINATE (progressFromBytes): a real byte counter → exact percent plus
 *    an ETA extrapolated from the measured transfer rate.
 *  - INDETERMINATE (progressFromEstimate): no real signal, only an expected
 *    duration → a smooth exponential-saturation curve that approaches a
 *    ceiling but never completes on its own (the caller marks 100 when done).
 *
 * Both are MONOTONIC: percent never drops below the caller-supplied
 * `prevPercent`, so a progress bar fed from these never moves backwards.
 * All outputs are finite (never NaN/Infinity); unknown ETAs are `null`.
 */

/** Progress percent (0..100) plus an ETA in ms, or null when unknowable. */
export interface ProgressEstimate {
  percent: number;
  etaMs: number | null;
}

/** Determinate mode never reports done on its own — caller marks 100. */
const BYTES_PERCENT_CAP = 99;

/** Indeterminate mode asymptote (exclusive) unless the caller overrides it. */
const DEFAULT_CEILING = 99;

/** Keeps the indeterminate curve strictly below its ceiling at saturation. */
const CEILING_EPSILON = 0.01;

/** ETA floor once an indeterminate wait overruns its expected duration. */
const OVERRUN_ETA_FLOOR_MS = 500;

/** Below this ETA, a countdown reads worse than "almost done". */
const ALMOST_DONE_MS = 1500;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;

/** Clamp `value` into [min, max]; non-finite values collapse to `min`. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Determinate progress from a real byte counter (e.g. a download).
 *
 * Percent is the loaded fraction capped at 99 (the caller marks 100 on
 * completion), floored at `prevPercent` so the bar is monotonic. ETA is
 * extrapolated from the measured rate (loadedBytes / elapsedMs); when no rate
 * is measurable yet (nothing loaded, or no time elapsed) it is `null`.
 * An unknown total (`totalBytes <= 0`) yields percent 0 (or prevPercent) and
 * a `null` ETA.
 */
export function progressFromBytes(
  loadedBytes: number,
  totalBytes: number,
  elapsedMs: number,
  prevPercent: number = 0,
): ProgressEstimate {
  const floor = clamp(prevPercent, 0, 100);

  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return { percent: floor, etaMs: null };
  }

  const rawPercent = (loadedBytes / totalBytes) * 100;
  const percent = Math.max(floor, clamp(rawPercent, 0, BYTES_PERCENT_CAP));

  let etaMs: number | null = null;
  if (
    Number.isFinite(elapsedMs) &&
    elapsedMs > 0 &&
    Number.isFinite(loadedBytes) &&
    loadedBytes > 0
  ) {
    const bytesPerMs = loadedBytes / elapsedMs;
    const remainingBytes = Math.max(0, totalBytes - loadedBytes);
    const eta = remainingBytes / bytesPerMs;
    etaMs = Number.isFinite(eta) ? eta : null;
  }

  return { percent, etaMs };
}

/**
 * Indeterminate progress from an expected duration only (AI cascade, render).
 *
 * Exponential saturation with time constant `expectedMs / 2`:
 *   frac = 1 - e^(-elapsed / (expected / 2))
 * so frac ≈ 0.865 at `elapsedMs === expectedMs` (≈85.6% of a 99 ceiling —
 * inside the 80–90 "most of the way at expected" band) and frac → 1 as
 * elapsed grows. Percent is `ceiling * frac`, held strictly below `ceiling`
 * by an epsilon so the bar never claims completion, and floored at
 * `prevPercent` for monotonicity.
 *
 * ETA counts down toward `expectedMs`, then floors at 500ms during overrun
 * ("almost done" forever rather than a lie that grows).
 */
export function progressFromEstimate(
  elapsedMs: number,
  expectedMs: number,
  prevPercent: number = 0,
  ceiling: number = DEFAULT_CEILING,
): ProgressEstimate {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const floor = clamp(prevPercent, 0, 100);

  let frac: number;
  if (Number.isFinite(expectedMs) && expectedMs > 0) {
    frac = 1 - Math.exp(-elapsed / (expectedMs / 2));
  } else {
    // No usable expectation: treat any elapsed time as fully saturated.
    frac = elapsed > 0 ? 1 : 0;
  }

  const saturated = Math.min(ceiling - CEILING_EPSILON, ceiling * frac);
  const percent = Math.max(floor, clamp(saturated, 0, 100));

  const remaining = Number.isFinite(expectedMs) ? expectedMs - elapsed : 0;
  const etaMs = Math.max(OVERRUN_ETA_FLOOR_MS, remaining);

  return { percent, etaMs };
}

/**
 * Human-readable ETA:
 *  - null / non-finite → "" (nothing to say)
 *  - under ~1.5s       → "almost done"
 *  - under a minute    → "~Ns remaining" (rounded to the nearest second)
 *  - a minute or more  → "~Nm Ns remaining"
 */
export function formatEta(etaMs: number | null): string {
  if (etaMs === null || !Number.isFinite(etaMs)) return "";
  if (etaMs < ALMOST_DONE_MS) return "almost done";
  if (etaMs < MS_PER_MINUTE) {
    return `~${Math.round(etaMs / MS_PER_SECOND)}s remaining`;
  }
  const minutes = Math.floor(etaMs / MS_PER_MINUTE);
  const seconds = Math.round((etaMs % MS_PER_MINUTE) / MS_PER_SECOND);
  return `~${minutes}m ${seconds}s remaining`;
}
