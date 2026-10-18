import { describe, expect, it } from "vitest";
import { parseProspectCsv } from "@/lib/outreach/prospect-csv";

describe("public prospect CSV importer", () => {
  it("accepts common column aliases and ignores private contact columns", () => {
    const result = parseProspectCsv(
      'name,website,city,email,phone\n"Salon, One",https://example.com,Tehran,private@example.com,+10000000000'
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        publicName: "Salon, One",
        publicUrl: "https://example.com",
        city: "Tehran",
        line: 2,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private@example.com");
    expect(JSON.stringify(result)).not.toContain("+10000000000");
  });

  it("supports UTF-8 BOM, Persian headers, escaped quotes and CRLF", () => {
    const result = parseProspectCsv(
      '\uFEFFpublic_name,public_url,city\r\n"سالن ""بهار""",https://example.com,تهران\r\n'
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ publicName: 'سالن "بهار"', city: "تهران" });
  });

  it("rejects missing required columns and missing row values without partial import", () => {
    expect(parseProspectCsv("name,city\nSalon,Tehran").errors).toEqual([
      "required_headers_missing",
    ]);

    const missingRowValue = parseProspectCsv(
      "name,public_url\nSalon,https://example.com\nMissing URL,"
    );
    expect(missingRowValue.rows).toEqual([]);
    expect(missingRowValue.errors).toEqual(["row_3_missing_name_or_url"]);
  });

  it("rejects malformed quoting and oversized files", () => {
    expect(parseProspectCsv('name,public_url\n"open,https://example.com').errors).toEqual([
      "unclosed_quote",
    ]);
    expect(parseProspectCsv('name,public_url\n"quoted"tail,https://example.com').errors).toEqual([
      "invalid_quote",
    ]);
    expect(parseProspectCsv("x".repeat(1_000_001)).errors).toEqual(["file_too_large"]);
  });

  it("rejects pipe delimiters that would corrupt the existing seed editor format", () => {
    const result = parseProspectCsv(
      'name,public_url,city\n"Salon | one",https://example.com,Tehran'
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(["row_2_unsupported_delimiter"]);
  });
});
