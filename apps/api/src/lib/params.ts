/**
 * Parse a query parameter as a positive integer with a default and max.
 * Returns the default if the value is missing, NaN, zero, or negative.
 */
export function parsePositiveInt(value: string | undefined, defaultVal: number, max: number): number {
  if (!value) return defaultVal;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return defaultVal;
  return Math.min(n, max);
}
