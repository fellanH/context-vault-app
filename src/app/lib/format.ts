export function formatNumber(value: number, maxFractionDigits = 2): string {
  if (!Number.isFinite(value)) return String(value);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

export function formatMegabytes(value: number): string {
  return formatNumber(value, 2);
}
