import type { FactValueType } from "@relay/contracts";
import { PLANS } from "@relay/contracts";

/**
 * Value normalization (constraints.md AP2): comparison happens on the
 * NORMALIZED value, never on strings. "10 MB" ⇄ 10485760 ⇄ "10,485,760
 * bytes" ⇄ "10240 KB" are one value in four renderings.
 *
 * Phase 12 rule: when a rendering is AMBIGUOUS ("a month" — 28? 30? 31
 * days), normalization returns `unknown` — never a guess. An `unknown`
 * normalized value downgrades the projection to `derived_prose` and can
 * never drive a deterministic action.
 */

const MB = 1_048_576;
const KB = 1_024;

export type ValueStyle = "mb" | "kb" | "bytes_commas" | "bytes" | "plain";

/** Unit class a fact key's integer values are rendered in. */
export type FactUnit = "bytes" | "days" | "count" | "none";

export function unitOfFactKey(key: string): FactUnit {
  if (key.endsWith(".max_bytes")) return "bytes";
  if (key.endsWith(".days")) return "days";
  if (key.endsWith(".max_rows")) return "count";
  return "none";
}

export type Normalized =
  | { ok: true; value: string | number | boolean }
  | { ok: false; reason: string };

export const UNKNOWN = (reason: string): Normalized => ({ ok: false, reason });

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

/** Duration renderings → whole days. Ambiguous words are refused. */
export function parseDuration(text: string): Normalized {
  const trimmed = text.trim().toLowerCase();
  let match = /^([\d,]+)\s*(?:calendar\s+)?days?$/.exec(trimmed);
  if (match) return { ok: true, value: Number(match[1]!.replaceAll(",", "")) };
  match = /^([\d,]+)\s*weeks?$/.exec(trimmed);
  if (match) {
    return { ok: true, value: Number(match[1]!.replaceAll(",", "")) * 7 };
  }
  match = /^([\d,]+)$/.exec(trimmed);
  if (match) return { ok: true, value: Number(match[1]!.replaceAll(",", "")) };
  // "a month" / "1 month" / "one month" — 28? 30? 31? Refuse, never guess.
  if (/\bmonths?\b/.test(trimmed)) {
    return UNKNOWN(`ambiguous duration "${text.trim()}" — a month is not a fixed number of days`);
  }
  if (/^(?:a|an|one|two|three|a few|several)\b/.test(trimmed)) {
    return UNKNOWN(`ambiguous duration "${text.trim()}"`);
  }
  return UNKNOWN(`unparseable duration "${text.trim()}"`);
}

/** Availability prose → boolean. "not yet available" is still false. */
export function parseAvailability(text: string): Normalized {
  const t = text.trim().toLowerCase();
  if (/^(true|yes|✓|✔|available|supported|enabled)$/.test(t)) {
    return { ok: true, value: true };
  }
  if (/^(false|no|✗|✕|—|-|unavailable|unsupported|disabled)$/.test(t)) {
    return { ok: true, value: false };
  }
  if (/\bnot\s+(yet\s+)?(available|supported)\b/.test(t)) {
    return { ok: true, value: false };
  }
  if (/\b(available|supported)\b/.test(t)) return { ok: true, value: true };
  // "coming soon", "planned", "in beta" — assert nothing about NOW.
  return UNKNOWN(`ambiguous availability prose "${text.trim()}"`);
}

const PLAN_SET: ReadonlySet<string> = new Set(PLANS);

export function parsePlan(text: string): Normalized {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/\s+plan$/, "")
    .replace(/^the\s+/, "");
  if (PLAN_SET.has(t)) return { ok: true, value: t };
  return UNKNOWN(`not a known plan name "${text.trim()}"`);
}

/**
 * Normalize a rendered/raw value for comparison, given the fact's declared
 * valueType and (for integers) the unit class of its key. This is THE
 * comparison form — consistency checks and authority arbitration both use
 * it; nothing compares document text to document text (AP2).
 */
export function normalizeForFact(
  raw: unknown,
  valueType: FactValueType,
  unit: FactUnit = "none",
): Normalized {
  if (raw === null || raw === undefined) return UNKNOWN("no value");
  switch (valueType) {
    case "integer": {
      if (typeof raw === "number") {
        return Number.isFinite(raw)
          ? { ok: true, value: raw }
          : UNKNOWN("non-finite number");
      }
      if (typeof raw !== "string") return UNKNOWN("not an integer rendering");
      if (unit === "days") return parseDuration(raw);
      const parsed = parseValue(raw);
      if (parsed === null) return UNKNOWN(`unparseable integer "${raw.trim()}"`);
      // Unit awareness: a bytes-unit fact accepts MB/KB/bytes renderings and
      // bare numbers; a count fact must not silently absorb a MB rendering.
      if (unit === "count" && /(MB|KB|bytes?)\s*$/i.test(raw.trim())) {
        return UNKNOWN(`byte-unit rendering "${raw.trim()}" for a count fact`);
      }
      return { ok: true, value: parsed };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (typeof raw !== "string") return UNKNOWN("not a boolean rendering");
      return parseAvailability(raw);
    }
    case "enum:plan": {
      if (typeof raw !== "string") return UNKNOWN("not a plan rendering");
      return parsePlan(raw);
    }
    case "semver": {
      if (typeof raw !== "string") return UNKNOWN("not a version rendering");
      const m = /^v?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)$/.exec(raw.trim());
      return m ? { ok: true, value: m[1]! } : UNKNOWN(`unparseable version "${raw.trim()}"`);
    }
    case "term": {
      if (typeof raw !== "string") return UNKNOWN("not a term");
      const t = raw.trim();
      // A term is ONE word. A phrase or sentence asserts prose, not a term —
      // unknown, or every paragraph mentioning the concept becomes a claim.
      if (!/^[A-Za-z][A-Za-z-]*$/.test(t)) {
        return UNKNOWN(`not a single term "${t.slice(0, 40)}"`);
      }
      // A term compares singular/plural-insensitively: "Tasks" asserts "Task".
      return { ok: true, value: t.endsWith("s") && t.length > 1 ? t.slice(0, -1) : t };
    }
    case "string": {
      return typeof raw === "string"
        ? { ok: true, value: raw.trim() }
        : UNKNOWN("not a string");
    }
    case "json":
      // Structured values are compared elsewhere (never via prose).
      return UNKNOWN("json values are not normalized from prose");
  }
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

/**
 * Typed normalized equality: true only when BOTH sides normalize cleanly and
 * agree. An unknown on either side is never equal to anything — an unknown
 * can neither confirm nor deny.
 */
export function sameNormalized(
  a: unknown,
  b: unknown,
  valueType: FactValueType,
  unit: FactUnit = "none",
): boolean {
  const na = normalizeForFact(a, valueType, unit);
  const nb = normalizeForFact(b, valueType, unit);
  return na.ok && nb.ok && na.value === nb.value;
}
