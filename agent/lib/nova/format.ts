/** Formatting helpers so numbers read the same everywhere Nova speaks. */

export function usd(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const formatted = Math.abs(rounded).toLocaleString("en-US", {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${rounded < 0 ? "-" : ""}$${formatted}`;
}

/** Percent with sign, e.g. +12.5% / -43%. */
export function signedPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

export function pct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

/** Percent change from a to b, null-safe for a zero baseline. */
export function pctChange(from: number, to: number): number | null {
  if (from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
