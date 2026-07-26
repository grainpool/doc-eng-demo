/**
 * Value normalization (constraints.md AP2): comparison happens on the
 * NORMALIZED value, never on strings. "10 MB" ⇄ 10485760 ⇄ "10,485,760
 * bytes" are one value in three renderings.
 */

const MB = 1_048_576;
const KB = 1_024;

export type ValueStyle = "mb" | "kb" | "bytes_commas" | "bytes" | "plain";

/** Parses a rendered value back to its canonical (numeric) form, or null. */
export function parseValue(text: string): number | null {
  const trimmed = text.trim();
  let match = /^([\d,]+(?:\.\d+)?)\s*MB$/i.exec(trimmed);
  if (match) return Math.round(Number(match[1]!.replaceAll(",", "")) * MB);
  match = /^([\d,]+(?:\.\d+)?)\s*KB$/i.exec(trimmed);
  if (match) return Math.round(Number(match[1]!.replaceAll(",", "")) * KB);
  match = /^([\d,]+)\s*bytes?$/i.exec(trimmed);
  if (match) return Number(match[1]!.replaceAll(",", ""));
  match = /^([\d,]+)$/.exec(trimmed);
  if (match) return Number(match[1]!.replaceAll(",", ""));
  return null;
}

/** Detects how an existing rendering styles the value, to re-render in kind. */
export function styleOf(text: string): ValueStyle {
  const trimmed = text.trim();
  if (/MB$/i.test(trimmed)) return "mb";
  if (/KB$/i.test(trimmed)) return "kb";
  if (/bytes?$/i.test(trimmed)) return "bytes_commas";
  if (trimmed.includes(",")) return "bytes_commas";
  return "plain";
}

export function formatValue(value: number, style: ValueStyle): string {
  switch (style) {
    case "mb": {
      const mb = value / MB;
      return `${Number.isInteger(mb) ? mb : Number(mb.toFixed(1))} MB`;
    }
    case "kb": {
      const kb = value / KB;
      return `${Number.isInteger(kb) ? kb : Number(kb.toFixed(1))} KB`;
    }
    case "bytes_commas":
      return `${value.toLocaleString("en-US")} bytes`;
    case "bytes":
      return `${value} bytes`;
    case "plain":
      return String(value);
  }
}

/** Normalized equality across renderings. */
export function sameValue(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown =>
    typeof v === "string" ? (parseValue(v) ?? v) : v;
  return canonical(a) === canonical(b);
}
