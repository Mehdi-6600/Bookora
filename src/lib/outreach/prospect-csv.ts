/**
 * Small, dependency-free importer for administrator-provided public prospect
 * CSVs. Only business name, public page URL and city are returned; extra fields
 * (including contact details) are deliberately ignored and never persisted.
 */

export type ProspectCsvRow = {
  publicName: string;
  publicUrl: string;
  city: string | null;
  line: number;
};

export type ProspectCsvResult = {
  rows: ProspectCsvRow[];
  errors: string[];
};

export const MAX_PROSPECT_CSV_CHARS = 1_000_000;
export const MAX_PROSPECT_CSV_ROWS = 1_000;

function parseRecords(text: string): { records: string[][]; error: string | null } {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        cell += char;
      }
      continue;
    }

    if (afterQuote && char !== "," && char !== "\n" && char !== "\r") {
      if (/\s/.test(char)) continue;
      return { records: [], error: "invalid_quote" };
    }

    if (char === '"') {
      if (cell.length !== 0) return { records: [], error: "invalid_quote" };
      quoted = true;
      afterQuote = false;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
      afterQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim().length > 0)) records.push(row);
      row = [];
      cell = "";
      afterQuote = false;
    } else {
      cell += char;
    }
  }

  if (quoted) return { records: [], error: "unclosed_quote" };
  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) records.push(row);
  return { records, error: null };
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/^\uFEFF/, "").toLowerCase().replace(/[\s-]+/g, "_");
}

function valueAt(record: string[], index: number): string {
  return (record[index] ?? "").trim();
}

/** Parse a CSV with a header and public business fields. Reject malformed or oversized input. */
export function parseProspectCsv(text: string): ProspectCsvResult {
  if (text.length > MAX_PROSPECT_CSV_CHARS) {
    return { rows: [], errors: ["file_too_large"] };
  }

  const parsed = parseRecords(text.replace(/^\uFEFF/, ""));
  if (parsed.error) return { rows: [], errors: [parsed.error] };
  if (parsed.records.length < 2) return { rows: [], errors: ["header_or_rows_missing"] };

  const headers = parsed.records[0].map(normalizeHeader);
  const nameIndex = headers.findIndex((header) =>
    ["public_name", "business_name", "name"].includes(header)
  );
  const urlIndex = headers.findIndex((header) =>
    ["public_url", "profile_url", "website", "url"].includes(header)
  );
  const cityIndex = headers.findIndex((header) => ["city", "location"].includes(header));

  if (nameIndex < 0 || urlIndex < 0) {
    return { rows: [], errors: ["required_headers_missing"] };
  }

  const dataRows = parsed.records.slice(1);
  if (dataRows.length > MAX_PROSPECT_CSV_ROWS) {
    return { rows: [], errors: ["too_many_rows"] };
  }

  const rows: ProspectCsvRow[] = [];
  const errors: string[] = [];
  dataRows.forEach((record, index) => {
    const line = index + 2;
    const publicName = valueAt(record, nameIndex);
    const publicUrl = valueAt(record, urlIndex);
    const city = cityIndex >= 0 ? valueAt(record, cityIndex) || null : null;

    if (!publicName || !publicUrl) {
      errors.push(`row_${line}_missing_name_or_url`);
      return;
    }
    // The current editor uses one business per line. Refuse delimiters and newlines
    // rather than silently corrupting names or cities during the safe hand-off.
    if (/[|\r\n]/.test(publicName) || /[|\r\n]/.test(publicUrl) || (city && /[|\r\n]/.test(city))) {
      errors.push(`row_${line}_unsupported_delimiter`);
      return;
    }

    rows.push({ publicName, publicUrl, city, line });
  });

  return { rows: errors.length > 0 ? [] : rows, errors };
}
