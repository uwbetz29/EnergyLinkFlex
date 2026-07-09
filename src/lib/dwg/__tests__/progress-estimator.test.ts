import { describe, it, expect } from "vitest";
import {
  progressFromBytes,
  progressFromEstimate,
  formatEta,
} from "../progress-estimator";

/**
 * RED harness for the progress + ETA estimator (Fable-built).
 *
 * Two modes:
 *  - DETERMINATE (download): real bytes → exact percent + ETA from measured rate.
 *  - INDETERMINATE (AI cascade / render): no real signal, only an expected duration →
 *    a smooth curve that approaches a ceiling but never completes on its own.
 *
 * Both return { percent: 0..100, etaMs: number|null } and are MONOTONIC: percent
 * never drops below the caller-supplied `prevPercent` (bars must not go backwards).
 *
 *   progressFromBytes(loadedBytes, totalBytes, elapsedMs, prevPercent=0)
 *   progressFromEstimate(elapsedMs, expectedMs, prevPercent=0, ceiling=99)
 *   formatEta(etaMs: number | null): string
 */

describe("progressFromBytes (determinate download)", () => {
  it("percent tracks bytes downloaded", () => {
    const { percent } = progressFromBytes(500_000, 1_000_000, 1000);
    expect(percent).toBeCloseTo(50, 1);
  });

  it("ETA extrapolates from the measured rate", () => {
    // 500KB in 1000ms => 500KB/s; 500KB remaining => ~1000ms left
    const { etaMs } = progressFromBytes(500_000, 1_000_000, 1000);
    expect(etaMs).toBeCloseTo(1000, -2); // within ~100ms
  });

  it("caps at 99% until the caller marks completion (never 100 from bytes)", () => {
    const { percent } = progressFromBytes(1_000_000, 1_000_000, 1000);
    expect(percent).toBeLessThanOrEqual(99);
    expect(percent).toBeGreaterThanOrEqual(95);
  });

  it("is monotonic: never returns below prevPercent", () => {
    const { percent } = progressFromBytes(100_000, 1_000_000, 1000, 40);
    expect(percent).toBeGreaterThanOrEqual(40);
  });

  it("handles zero elapsed / zero loaded without NaN or Infinity", () => {
    const a = progressFromBytes(0, 1_000_000, 0);
    expect(Number.isFinite(a.percent)).toBe(true);
    expect(a.percent).toBe(0);
    expect(a.etaMs === null || Number.isFinite(a.etaMs)).toBe(true);
  });

  it("handles unknown total (0) → indeterminate-ish: percent 0, etaMs null", () => {
    const { percent, etaMs } = progressFromBytes(500_000, 0, 1000);
    expect(percent).toBe(0);
    expect(etaMs).toBeNull();
  });
});

describe("progressFromEstimate (indeterminate)", () => {
  it("starts at ~0 when no time has elapsed", () => {
    const { percent } = progressFromEstimate(0, 10_000);
    expect(percent).toBeGreaterThanOrEqual(0);
    expect(percent).toBeLessThanOrEqual(2);
  });

  it("is most of the way (80–90%) at the expected duration", () => {
    const { percent } = progressFromEstimate(10_000, 10_000);
    expect(percent).toBeGreaterThanOrEqual(80);
    expect(percent).toBeLessThanOrEqual(90);
  });

  it("increases with elapsed time (monotonic in elapsed)", () => {
    const a = progressFromEstimate(2_000, 10_000).percent;
    const b = progressFromEstimate(5_000, 10_000).percent;
    const c = progressFromEstimate(9_000, 10_000).percent;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("never reaches or exceeds the ceiling, even far past expected", () => {
    const { percent } = progressFromEstimate(1_000_000, 10_000, 0, 99);
    expect(percent).toBeLessThan(99);
    expect(percent).toBeGreaterThan(90); // but creeps up during overrun
  });

  it("respects a custom ceiling", () => {
    const { percent } = progressFromEstimate(1_000_000, 10_000, 0, 95);
    expect(percent).toBeLessThan(95);
  });

  it("never returns below prevPercent", () => {
    const { percent } = progressFromEstimate(100, 10_000, 70);
    expect(percent).toBeGreaterThanOrEqual(70);
  });

  it("gives a positive ETA before expected and a small floor during overrun", () => {
    expect(progressFromEstimate(3_000, 10_000).etaMs).toBeGreaterThan(0);
    const over = progressFromEstimate(20_000, 10_000).etaMs;
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThanOrEqual(2_000);
  });
});

describe("formatEta", () => {
  it("null → empty string", () => {
    expect(formatEta(null)).toBe("");
  });
  it("under ~1.5s → 'almost done'", () => {
    expect(formatEta(800)).toBe("almost done");
  });
  it("seconds range → '~Ns remaining'", () => {
    expect(formatEta(8_000)).toBe("~8s remaining");
  });
  it("rounds to the nearest second", () => {
    expect(formatEta(8_600)).toBe("~9s remaining");
  });
  it("minutes range → '~Nm Ns remaining'", () => {
    expect(formatEta(95_000)).toBe("~1m 35s remaining");
  });
});
