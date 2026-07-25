// Phase 03 acceptance test (validation.md §2): over-limit upload → error with
// a copy_id; unsupported extension → a DIFFERENT code; a valid upload records
// sha256, byte size, row and column counts. Plus the §7 CSV edge cases that
// apply now: empty CSV, single column, duplicate column names, BOM, CRLF,
// quoted value containing a comma.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface FileRecord {
  id: string;
  sha256: string;
  byte_size: number;
  column_count: number;
  row_count: number;
}

interface ErrorBody {
  error: { code: string; copy_id: string; field?: string };
}

async function createProject(): Promise<string> {
  const res = await SELF.fetch("https://example.com/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Test project" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function upload(
  projectId: string,
  filename: string,
  content: string,
): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([content], filename, { type: "text/csv" }));
  return SELF.fetch(`https://example.com/api/projects/${projectId}/files`, {
    method: "POST",
    body: form,
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("file upload — rejections", () => {
  it("rejects an over-limit file with FILE_TOO_LARGE and a copy_id", async () => {
    const projectId = await createProject();
    const elevenMb = "a,b\n" + "1,2\n".repeat(2_800_000); // ~11.2 MB
    const res = await upload(projectId, "big.csv", elevenMb);
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("FILE_TOO_LARGE");
    expect(body.error.copy_id).toBe("error.upload.too_large");
  });

  it("rejects an unsupported extension with a DIFFERENT code and copy_id", async () => {
    const projectId = await createProject();
    const res = await upload(projectId, "report.pdf", "%PDF-1.4 not a csv");
    expect(res.status).toBe(415);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
    expect(body.error.copy_id).toBe("error.upload.unsupported_type");
  });

  it("rejects a missing file part with VALIDATION_FAILED", async () => {
    const projectId = await createProject();
    const form = new FormData();
    const res = await SELF.fetch(`https://example.com/api/projects/${projectId}/files`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.copy_id).toBe("error.upload.missing_file");
  });

  it("404s with the contract error shape for an unknown project", async () => {
    const res = await upload("prj_00000000000000000000000000", "x.csv", "a\n1\n");
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe("NOT_FOUND");
  });
});

describe("file upload — a valid CSV records correct metadata", () => {
  it("records sha256, byte size, row and column counts", async () => {
    const projectId = await createProject();
    const csv = "name,age,city\nAda,36,London\nGrace,45,Arlington\n";
    const res = await upload(projectId, "people.csv", csv);
    expect(res.status).toBe(201);
    const file = (await res.json()) as FileRecord;
    expect(file.column_count).toBe(3);
    expect(file.row_count).toBe(2);
    expect(file.byte_size).toBe(new TextEncoder().encode(csv).byteLength);
    expect(file.sha256).toBe(await sha256Hex(csv));

    // And it is listed for the project.
    const list = await SELF.fetch(`https://example.com/api/projects/${projectId}/files`);
    const { files } = (await list.json()) as { files: FileRecord[] };
    expect(files.some((f) => f.id === file.id)).toBe(true);
  });
});

describe("CSV edge cases (validation.md §7)", () => {
  const cases: {
    name: string;
    content: string;
    columns: number;
    rows: number;
  }[] = [
    { name: "empty.csv", content: "", columns: 0, rows: 0 },
    { name: "single-column.csv", content: "value\n1\n2\n3\n", columns: 1, rows: 3 },
    {
      name: "duplicate-columns.csv",
      content: "id,name,name\n1,a,b\n",
      columns: 3,
      rows: 1,
    },
    {
      name: "bom.csv",
      content: "﻿id,name\n1,Ada\n",
      columns: 2,
      rows: 1,
    },
    {
      name: "crlf.csv",
      content: "id,name\r\n1,Ada\r\n2,Grace\r\n",
      columns: 2,
      rows: 2,
    },
    {
      name: "quoted-comma.csv",
      content: 'id,address\n1,"12 Main St, Springfield"\n',
      columns: 2,
      rows: 1,
    },
    {
      name: "no-trailing-newline.csv",
      content: "id,name\n1,Ada",
      columns: 2,
      rows: 1,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name}: ${testCase.columns} columns, ${testCase.rows} rows`, async () => {
      const projectId = await createProject();
      const res = await upload(projectId, testCase.name, testCase.content);
      expect(res.status).toBe(201);
      const file = (await res.json()) as FileRecord;
      expect(file.column_count, "column_count").toBe(testCase.columns);
      expect(file.row_count, "row_count").toBe(testCase.rows);
    });
  }
});
