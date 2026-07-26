import type { DatasetRef } from "@relay/contracts";
import { LIMIT_UPLOAD_CSV_MAX_BYTES } from "../limits.js";
import { signDatasetUrl } from "./presign.js";
import type { Env } from "../env.js";
import type { FileRow } from "../routes/files.js";

/**
 * Builds the DatasetRef handed to the kernel for one file: Worker-signed
 * capability URL (60 s, GET-only, single key — presign.ts), the file's
 * recorded sha256 (the kernel re-verifies), and the single upload limit as
 * max_bytes. Shared by the Phase-04 internal proxy and the Phase-05 turn
 * pipeline so the two can never drift.
 */
export async function buildDatasetRef(
  env: Env,
  requestOrigin: string,
  file: Pick<FileRow, "r2_key" | "sha256" | "mime">,
): Promise<DatasetRef | null> {
  const secret = env.RELAY_DATASET_URL_SECRET;
  if (!secret) return null;
  const origin = env.RELAY_DATASET_ORIGIN ?? requestOrigin;
  return {
    presigned_url: await signDatasetUrl(secret, origin, file.r2_key),
    format: file.mime === "text/tab-separated-values" ? "tsv" : "csv",
    sha256: file.sha256,
    max_bytes: LIMIT_UPLOAD_CSV_MAX_BYTES,
  };
}
