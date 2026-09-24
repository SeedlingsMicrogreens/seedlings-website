export const PACKAGING_OPTIONS = [100, 200, 500, 1000, 2000, 5000] as const;

export function packagingLabel(grams: number) {
  const value = Math.max(1, Number(grams) || 100);
  return value >= 1000 && value % 1000 === 0 ? `${value / 1000}kg` : `${value}g`;
}
