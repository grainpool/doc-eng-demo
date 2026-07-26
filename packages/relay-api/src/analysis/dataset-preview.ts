import type { Env } from "../env.js";
import type { FileRow } from "../routes/files.js";

/**
 * Lightweight dataset preview read straight from R2 — deliberately NOT a
 * kernel call. The translator needs column names/samples as prompt context,
 * and building that context must not touch the kernel: the Phase-05
 * acceptance tests assert an unsupported request makes ZERO kernel calls,
 * and that includes context gathering.
 */

export interface DatasetPreview {
  columns: string[];
  /** Up to `maxRows` rows of sample values, stringified. */
  rows: string[][];
  row_count: number | null;
  column_count: number | null;
}

const PREVIEW_BYTES = 16 * 1024;
const MAX_ROWS = 5;

/** Minimal RFC-4180 record parser over a bounded text slice. */
function parseRecords(text: string, delimiter: string, limit: number): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length && records.length < limit; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      field = "";
      record = [];
    } else {
      field += ch;
    }
  }
  // A trailing partial record from the byte-bounded slice is dropped on
  // purpose — samples only, never authoritative.
  return records;
}

export async function datasetPreview(
  env: Env,
  file: Pick<FileRow, "r2_key" | "mime" | "row_count" | "column_count">,
): Promise<DatasetPreview | null> {
  const object = await env.relay_artifacts.get(file.r2_key, {
    range: { offset: 0, length: PREVIEW_BYTES },
  });
  if (!object) return null;
  const text = new TextDecoder("utf-8").decode(await object.arrayBuffer());
  const delimiter = file.mime === "text/tab-separated-values" ? "\t" : ",";
  const records = parseRecords(
    text.charCodeAt(0) === 0xfeff ? text.slice(1) : text,
    delimiter,
    MAX_ROWS + 1,
  );
  const header = records[0] ?? [];
  return {
    columns: header,
    rows: records.slice(1, MAX_ROWS + 1),
    row_count: file.row_count,
    column_count: file.column_count,
  };
}
