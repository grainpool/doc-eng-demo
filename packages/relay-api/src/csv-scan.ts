/**
 * One streaming pass over an uploaded delimited file: sha256 (via the Workers
 * DigestStream), byte size, header column count, and data row count. The file
 * is never buffered whole; quoting rules follow RFC 4180 (quoted fields may
 * contain the delimiter, quotes escaped by doubling, and newlines inside
 * quotes do not terminate a record). A UTF-8 BOM is stripped by TextDecoder.
 */

export interface CsvScanResult {
  sha256: string;
  byte_size: number;
  column_count: number;
  row_count: number;
}

export async function scanDelimitedStream(
  stream: ReadableStream<Uint8Array>,
  delimiter: "," | "\t",
): Promise<CsvScanResult> {
  const digest = new crypto.DigestStream("SHA-256");
  const digestWriter = digest.getWriter();
  const decoder = new TextDecoder("utf-8"); // strips a leading BOM by default

  let byteSize = 0;
  let inQuotes = false;
  let recordHasContent = false;
  let recordIndex = 0; // completed records
  let headerColumns = 0;
  let currentColumns = 1; // fields in the record being scanned
  let prevWasCR = false;

  const endRecord = (): void => {
    if (recordHasContent) {
      if (recordIndex === 0) headerColumns = currentColumns;
      recordIndex++;
    }
    recordHasContent = false;
    currentColumns = 1;
  };

  const scanText = (text: string): void => {
    for (const ch of text) {
      if (prevWasCR && ch === "\n" && !inQuotes) {
        prevWasCR = false;
        continue; // second half of CRLF, already handled
      }
      prevWasCR = false;
      if (ch === '"') {
        // Toggling on doubled quotes is harmless for counting purposes.
        inQuotes = !inQuotes;
        recordHasContent = true;
      } else if (!inQuotes && (ch === "\n" || ch === "\r")) {
        if (ch === "\r") prevWasCR = true;
        endRecord();
      } else if (!inQuotes && ch === delimiter) {
        currentColumns++;
        recordHasContent = true;
      } else if (ch !== " " || recordHasContent) {
        recordHasContent = true;
      }
    }
  };

  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    byteSize += value.byteLength;
    await digestWriter.write(value);
    scanText(decoder.decode(value, { stream: true }));
  }
  scanText(decoder.decode()); // flush any trailing multi-byte sequence
  endRecord(); // a final record without a trailing newline still counts

  await digestWriter.close();
  const hashBuffer = await digest.digest;
  const sha256 = [...new Uint8Array(hashBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    sha256,
    byte_size: byteSize,
    column_count: recordIndex === 0 ? 0 : headerColumns,
    row_count: Math.max(0, recordIndex - 1), // data rows, excluding the header
  };
}
