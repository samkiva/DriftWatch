import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { compareDatasets, generateInsights, rankIdentifierCandidates } from "./compare";
import { CsvValidationError, parseCsv } from "./csv";
import { exportDifferencesCsv, exportHtmlReport, exportSummaryCsv } from "./export";

const baseline = parseCsv(
  "id,name,revenue,status\n1,Ada,100,active\n2,Lin,0,active\n3,Sam,50,inactive\n",
  "before.csv",
);
const newer = parseCsv(
  "status,name,id,revenue,region\nactive,Ada,1,125,north\nactive,Lin,2,0,south\nactive,Jo,4,80,west\n",
  "after.csv",
);

describe("parseCsv", () => {
  it("parses headers, records, and data types without coercing cell values", () => {
    const dataset = parseCsv("id,price,enabled,day\n1,12.5,true,2025-01-03\n2,0,false,2025-01-04");
    expect(dataset.headers).toEqual(["id", "price", "enabled", "day"]);
    expect(dataset.rows[0].price).toBe("12.5");
    expect(dataset.types).toEqual({ id: "number", price: "number", enabled: "boolean", day: "date" });
  });

  it("accepts missing cell contents as empty strings and infers empty columns", () => {
    const dataset = parseCsv("id,note\n1,\n2,value");
    expect(dataset.rows[0].note).toBe("");
    expect(dataset.types.note).toBe("text");
    expect(parseCsv("id,note\n1,\n2,").types.note).toBe("empty");
  });

  it.each([
    ["empty file", ""],
    ["empty header", ",name\n1,Ada"],
    ["duplicate header", "id,id\n1,2"],
    ["malformed row", "id,name\n1,Ada\n2"],
    ["blank record", "id,name\n1,Ada\n\n2,Lin"],
    ["unterminated quoted field", 'id,name\n1,"Ada'],
  ])("rejects %s with a useful validation error", (_label, csv) => {
    expect(() => parseCsv(csv)).toThrow(CsvValidationError);
  });

  it.each([
    ["semicolon", "id;name\n1;Ada", "name", "Ada"],
    ["tab", "id\tname\n1\tAda", "name", "Ada"],
    ["quoted delimiter and newline", 'id,note\n1,"hello, world\nsecond line"', "note", "hello, world\nsecond line"],
  ])("parses %s-delimited or quoted input without losing fields", (_label, csv, valueColumn, value) => {
    const dataset = parseCsv(csv);
    expect(dataset.headers).toEqual(["id", valueColumn]);
    expect(dataset.rows[0]).toMatchObject({ id: "1", [valueColumn]: value });
  });

  it("preserves empty fields and accepts a reasonably large individual cell", () => {
    const longValue = "x".repeat(512_000);
    const dataset = parseCsv(`id,note\n1,\n2,${longValue}`);
    expect(dataset.rows[0].note).toBe("");
    expect(dataset.rows[1].note).toHaveLength(longValue.length);
  });
});

describe("compareDatasets", () => {
  it("matches by identifier despite reordered columns and reports all record types", () => {
    const result = compareDatasets(baseline, newer, "id");
    expect(result.records.map(({ id, type }) => [id, type])).toEqual([
      ["1", "modified"],
      ["2", "unchanged"],
      ["4", "added"],
      ["3", "deleted"],
    ]);
    expect(result.records[0].changes).toEqual([{
      column: "revenue", before: "100", after: "125", significance: "moderate",
    }]);
    expect(result.metrics).toMatchObject({
      baselineTotal: 3, newerTotal: 3, added: 1, deleted: 1, modified: 1, unchanged: 1,
      affectedPercent: 75,
    });
    expect(result.metrics.significanceCounts).toMatchObject({
      informational: 3,
      moderate: 1,
      high: 0,
      critical: 0,
    });
  });

  it("rejects duplicate and missing identifiers instead of silently losing rows", () => {
    const duplicates = parseCsv("id,value\n1,a\n1,b");
    expect(() => compareDatasets(duplicates, duplicates, "id")).toThrow(/duplicate "id" value "1"/);
    const missing = parseCsv("id,value\n,a");
    expect(() => compareDatasets(missing, missing, "id")).toThrow(/missing "id" value/);
  });

  it("identifies column additions, removals, and type changes", () => {
    const old = parseCsv("id,amount,old_field\n1,10,shared");
    const next = parseCsv("id,amount,new_field\n1,ten,shared");
    const result = compareDatasets(old, next, "id");
    expect(result.schema.added).toEqual(["new_field"]);
    expect(result.schema.removed).toEqual(["old_field"]);
    expect(result.schema.typeChanged).toContain("amount");
    expect(result.schema.renamed).toEqual([{ from: "old_field", to: "new_field", confidence: 1 }]);
    expect(result.records[0].type).toBe("modified");
  });

  it("compares missing and empty field values as equivalent", () => {
    const old = parseCsv("id,value\n1,\n2,x");
    const next = parseCsv("value,id\n,1\nx,2");
    expect(compareDatasets(old, next, "id").metrics.unchanged).toBe(2);
  });

  it("calculates a zero-safe affected percentage and never claims change for an empty comparison", () => {
    const empty = parseCsv("id,value\n");
    const result = compareDatasets(empty, empty, "id");
    expect(result.metrics.affectedPercent).toBe(0);
    expect(generateInsights(result)).toEqual(["No record-level changes were found between these datasets."]);
  });

  it("generates deterministic, evidence-based summaries for additions and changed columns", () => {
    expect(generateInsights(compareDatasets(baseline, newer, "id"))).toContain("revenue changed in 1 record.");
    expect(generateInsights(compareDatasets(baseline, newer, "id"))).toContain("1 record was added to the newer dataset.");
  });

  it("reproduces positional Index matching and correctly matches disjoint customer IDs", () => {
    const baselineRows = Array.from({ length: 100 }, (_, index) =>
      `${index + 1},OLD-CUSTOMER-${String(index + 1).padStart(4, "0")},Baseline ${index + 1}`);
    const newerRows = Array.from({ length: 1000 }, (_, index) =>
      `${index + 1},NEW-CUSTOMER-${String(index + 1).padStart(4, "0")},New ${index + 1}`);
    const oldDataset = parseCsv(`Index,Customer Id,Name\n${baselineRows.join("\n")}`);
    const newDataset = parseCsv(`Index,Customer Id,Name\n${newerRows.join("\n")}`);

    const candidates = rankIdentifierCandidates(oldDataset, newDataset);
    expect(candidates[0].identifier).toBe("Customer Id");
    expect(candidates.find((candidate) => candidate.identifier === "Index")?.recommendation).toBe("avoid");

    const byCustomerId = compareDatasets(oldDataset, newDataset, "Customer Id");
    expect(byCustomerId.metrics).toMatchObject({
      added: 1000, deleted: 100, modified: 0, unchanged: 0,
    });
    expect(byCustomerId.identifierAnalysis.sharedValues).toBe(0);

    const byIndex = compareDatasets(oldDataset, newDataset, "Index");
    expect(byIndex.metrics).toMatchObject({
      added: 900, deleted: 0, modified: 100, unchanged: 0,
    });
    expect(byIndex.identifierAnalysis.sequentialIndex).toBe(true);
    expect(byIndex.identifierAnalysis.sharedValues).toBe(100);
    expect(byIndex.identifierAnalysis.warnings.join(" ")).toMatch(/positional matches.*incorrectly associate/i);
    expect(exportDifferencesCsv(byIndex)).toContain("positional matches");
    expect(exportSummaryCsv(byIndex)).toContain("Matching warning 1");
    expect(exportHtmlReport(byIndex)).toContain("Matching key warning · Index");
  });

  it("links changed primary IDs by a confirmed unique secondary identifier and classifies them Critical", () => {
    const old = parseCsv("customer_id,account_ref,name\nC-1,A-1,Ada");
    const next = parseCsv("customer_id,account_ref,name\nC-9,A-1,Ada");
    const result = compareDatasets(old, next, "customer_id", { secondaryIdentifier: "account_ref" });
    expect(result.metrics).toMatchObject({ added: 0, deleted: 0, modified: 1, unchanged: 0, affectedPercent: 100 });
    expect(result.records[0]).toMatchObject({
      id: "C-9",
      identifierBefore: "C-1",
      identifierAfter: "C-9",
      matchedBy: "secondary",
      significance: "critical",
      changes: [{ column: "customer_id", before: "C-1", after: "C-9", significance: "critical" }],
    });
  });

  it("keeps changed IDs as additions and removals unless the user confirms an identity link", () => {
    const old = parseCsv("id,name\nOLD,Ada");
    const next = parseCsv("id,name\nNEW,Ada");
    const result = compareDatasets(old, next, "id");
    expect(result.metrics).toMatchObject({ added: 1, deleted: 1, modified: 0, unchanged: 0 });
    expect(result.records.every((record) => record.significance === "informational")).toBe(true);
  });

  it("rejects ambiguous and missing secondary identifiers", () => {
    const ambiguous = parseCsv("id,stable\n1,S\n2,S");
    expect(() => compareDatasets(ambiguous, ambiguous, "id", { secondaryIdentifier: "stable" }))
      .toThrow(/duplicate "stable" value "S"/);
    const missing = parseCsv("id,stable\n1,\n2,X");
    expect(() => compareDatasets(missing, missing, "id", { secondaryIdentifier: "stable" }))
      .toThrow(/missing "stable" value/);
  });

  it("supports explicit old-to-new mappings and rejects invalid or conflicting mappings", () => {
    const old = parseCsv("id,stable,name\nold,S,Ada");
    const next = parseCsv("id,stable,name\nnew,S,Ada");
    const mapped = compareDatasets(old, next, "id", { identifierMappings: [{ before: "old", after: "new" }] });
    expect(mapped.records[0]).toMatchObject({ matchedBy: "mapping", identifierBefore: "old", identifierAfter: "new", significance: "critical" });
    expect(() => compareDatasets(old, next, "id", {
      identifierMappings: [{ before: "missing", after: "new" }],
    })).toThrow(/must reference an existing/);
    expect(() => compareDatasets(old, next, "id", {
      identifierMappings: [{ before: "old", after: "new" }, { before: "old", after: "new" }],
    })).toThrow(/at most once/);
    expect(() => compareDatasets(old, next, "id", {
      secondaryIdentifier: "stable",
      identifierMappings: [{ before: "old", after: "different" }],
    })).toThrow(/must reference an existing/);
  });

  it("rejects mapping conflicts with exact primary or secondary matches", () => {
    const old = parseCsv("id,stable\n1,A\n2,B");
    const next = parseCsv("id,stable\n1,A\n2,B");
    expect(() => compareDatasets(old, next, "id", {
      identifierMappings: [{ before: "1", after: "2" }],
    })).toThrow(/conflicts with an existing primary-key match/);
    const changed = parseCsv("id,stable\nnew,B");
    expect(() => compareDatasets(parseCsv("id,stable\nold,A"), changed, "id", {
      secondaryIdentifier: "stable",
      identifierMappings: [{ before: "old", after: "new" }],
    })).toThrow(/conflicts with secondary identifier/);
  });

  it("warns when a unique primary key has no overlap across datasets", () => {
    const result = compareDatasets(
      parseCsv("id,value\nold,a"),
      parseCsv("id,value\nnew,b"),
      "id",
    );
    expect(result.identifierAnalysis.warnings.join(" ")).toMatch(/No "id" values overlap/);
  });
});

describe("exports", () => {
  const result = compareDatasets(baseline, newer, "id");

  it("exports each compared record with before/after details and a summary", () => {
    const details = exportDifferencesCsv(result);
    const parsedDetails = Papa.parse<Record<string, string>>(details, { header: true }).data;
    expect(details).toContain("modified,1");
    expect(JSON.parse(parsedDetails[0].before).revenue).toBe("100");
    expect(parsedDetails[0].significance).toBe("moderate");
    expect(details).toContain("deleted,3");
    expect(exportSummaryCsv(result)).toContain("Affected records (%),75.00");
  });

  it("preserves CSV headers when there are no records and avoids identifier/header collisions", () => {
    const empty = compareDatasets(parseCsv("before,value\n"), parseCsv("before,value\n"), "before");
    const emptyExport = Papa.parse<Record<string, string>>(exportDifferencesCsv(empty), { header: true });
    expect(emptyExport.meta.fields).toEqual([
      "change_type", "before_value", "changed_columns", "significance", "changed_fields",
      "before", "after", "matching_identifier", "matching_warning",
      "identifier_before", "identifier_after", "matched_by", "significance_rule",
    ]);
    const collision = compareDatasets(
      parseCsv("change_type,value\n1,old"),
      parseCsv("change_type,value\n1,new"),
      "change_type",
    );
    expect(exportDifferencesCsv(collision).split("\r\n")[0]).toBe(
      "change_type,change_type_value,changed_columns,significance,changed_fields,before,after,matching_identifier,matching_warning,identifier_before,identifier_after,matched_by,significance_rule",
    );
  });

  it("neutralizes spreadsheet formulas in untrusted CSV cells", () => {
    const malicious = parseCsv('id,note\n=1+1,"@SUM(A1:A2)"');
    const safeResult = compareDatasets(malicious, parseCsv('id,note\n=1+1,"@SUM(A1:A2)"'), "id");
    const details = Papa.parse<Record<string, string>>(exportDifferencesCsv(safeResult), { header: true }).data;
    expect(details[0].id).toBe("'=1+1");
    expect(details[0].matching_warning).toBe("");

    const formulaHeader = compareDatasets(
      parseCsv("=HYPERLINK(1),value\nkey,a"),
      parseCsv("=HYPERLINK(1),value\nkey,b"),
      "=HYPERLINK(1)",
    );
    expect(exportDifferencesCsv(formulaHeader).split("\r\n")[0]).toContain("\"'=HYPERLINK(1)\"");
    const formulaSummary = Papa.parse<Record<string, string>>(exportSummaryCsv(formulaHeader), { header: true }).data;
    expect(formulaSummary.find((row) => row.metric === "Matching identifier")?.value).toBe("'=HYPERLINK(1)");

    const formulaColumn = compareDatasets(
      parseCsv("id,=cmd\n1,before"),
      parseCsv("id,=cmd\n1,after"),
      "id",
    );
    const formulaColumnRow = Papa.parse<Record<string, string>>(exportDifferencesCsv(formulaColumn), { header: true }).data[0];
    expect(formulaColumnRow.changed_columns).toBe("'=cmd");
  });

  it("exports a self-contained HTML report with escaped untrusted values and actual totals", () => {
    const html = exportHtmlReport(result);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<b>1</b>");
    expect(html).toContain("before.csv");
    expect(exportHtmlReport(compareDatasets(
      parseCsv("id,name\n1,<script>alert(1)</script>"),
      parseCsv("id,name\n1,<script>alert(1)</script>"),
      "id",
    ))).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");

    const injected = exportHtmlReport(compareDatasets(
      parseCsv("id,value\n1,><img src=x onerror=alert(1)>", 'before"><script>alert(1)</script>.csv'),
      parseCsv("id,value\n1,><svg onload=alert(1)>", "after.csv"),
      "id",
    ));
    expect(injected).not.toContain("<img");
    expect(injected).not.toContain("<svg");
    expect(injected).not.toContain("<script>");
    expect(injected).toContain("&lt;svg");
  });
});
