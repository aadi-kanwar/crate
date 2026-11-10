/**
 * Indian rupee formatting (en-IN grouping, ₹). Money is stored as integer
 * paise; `formatPaise` shows paise only when there are any.
 */
const whole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const exact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** An amount in rupees: whole rupees, or with paise when `exact` and not whole. */
export function formatINR(
  amount: number,
  options: { exact?: boolean } = {},
): string {
  const value = options.exact
    ? Math.round(amount * 100) / 100
    : Math.round(amount);
  const text = (
    options.exact && !Number.isInteger(value) ? exact : whole
  ).format(Math.abs(value));
  return value < 0 ? `−${text}` : text;
}

/** Integer paise as "₹1,250" or "₹42.50". */
export function formatPaise(paise: number): string {
  return formatINR(paise / 100, { exact: true });
}
