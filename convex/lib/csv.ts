/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starting
 * with = + - @, tab or carriage return) is prefixed with ' so it stays text.
 */
export function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows to CSV text (Windows line endings, which Excel expects). */
export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
