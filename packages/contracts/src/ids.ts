import { z } from "zod";

/**
 * Prefixed, sortable, URL-safe identifiers: `{prefix}_{ulid}` lowercase
 * (contracts.md §2). ULID is implemented here directly on Web Crypto because
 * @relay/contracts may depend on zod and nothing else (constraints.md G3).
 */

export const ID_PREFIXES = {
  project: "prj",
  file: "fil",
  analysisSession: "ses",
  sessionTurn: "trn",
  artifact: "art",
  release: "rel",
  reconciliationRun: "run",
  impact: "imp",
  patch: "pat",
  conflict: "cfl",
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

// Web Crypto is a global in every runtime this package targets (workerd,
// Node 22+, browsers); declared locally so the package needs no DOM lib.
declare const crypto: { getRandomValues(array: Uint8Array): Uint8Array };

// Crockford base32, lowercased (no i, l, o, u).
const ENCODING = "0123456789abcdefghjkmnpqrstvwxyz";

function encodeTime(time: number): string {
  let out = "";
  for (let i = 9; i >= 0; i--) {
    out = ENCODING[time % 32] + out;
    time = Math.floor(time / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += ENCODING[(bytes[i] as number) % 32];
  }
  return out;
}

/** 26-char lowercase ULID: 10 chars of time, 16 of randomness. */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}

const ID_PATTERN = /^[a-z]{3}_[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

export function idSchema(prefix: IdPrefix) {
  return z
    .string()
    .regex(ID_PATTERN, "expected {prefix}_{ulid} lowercase")
    .refine((v) => v.startsWith(`${prefix}_`), {
      message: `expected id prefix "${prefix}"`,
    });
}

/**
 * Doc-unit ids are NOT random (contracts.md §2): deterministic and stable,
 * `{surface}:{path}#{anchor}`. `path` is relative to the ESTATE REPO ROOT —
 * the `estate/` mount prefix must never appear in an id (constraints.md G22).
 */
export const DOC_SURFACES = [
  "mintlify",
  "helpcenter",
  "inproduct",
  "clidocs",
  "release",
  "generated",
] as const;

export type DocSurface = (typeof DOC_SURFACES)[number];

export interface DocUnitIdParts {
  surface: DocSurface;
  path: string;
  anchor: string | null;
}

export function buildDocUnitId(parts: DocUnitIdParts): string {
  const { surface, path, anchor } = parts;
  if (!(DOC_SURFACES as readonly string[]).includes(surface)) {
    throw new Error(`unknown surface: ${surface}`);
  }
  if (path.startsWith("estate/") || path.startsWith("/")) {
    throw new Error(
      "doc-unit path must be estate-repo-relative (no estate/ mount prefix, no leading slash)",
    );
  }
  if (path.includes("#") || path.includes(":")) {
    throw new Error("doc-unit path must not contain '#' or ':'");
  }
  return anchor === null ? `${surface}:${path}` : `${surface}:${path}#${anchor}`;
}

const DOC_UNIT_ID_PATTERN = /^([a-z]+):([^#:]+?)(#([^#]+))?$/;

export function parseDocUnitId(id: string): DocUnitIdParts {
  const match = DOC_UNIT_ID_PATTERN.exec(id);
  if (!match) throw new Error(`malformed doc-unit id: ${id}`);
  const [, surface, path, , anchor] = match;
  if (!(DOC_SURFACES as readonly string[]).includes(surface as string)) {
    throw new Error(`unknown surface in doc-unit id: ${surface}`);
  }
  if ((path as string).startsWith("estate/")) {
    throw new Error("doc-unit id carries the estate/ mount prefix (G22 violation)");
  }
  return {
    surface: surface as DocSurface,
    path: path as string,
    anchor: anchor ?? null,
  };
}

export const DocUnitIdSchema = z.string().refine(
  (v) => {
    try {
      parseDocUnitId(v);
      return true;
    } catch {
      return false;
    }
  },
  { message: "malformed doc-unit id" },
);
