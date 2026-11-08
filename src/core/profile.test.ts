import { describe, expect, it } from "vitest";
import { compareDatasets, generateInsights } from "./compare";
import { fingerprintDataset } from "./fingerprint";
import { parseCsv } from "./csv";
import { profileDataset } from "./profile";

describe("dataset quality profiling", () => {
  it("finds missing values, duplicates, invalid emails, mixed date formats, IQR outliers, and category variants", () => {
    const dataset = parseCsv([
      "id,email,created_at,amount,status",
      "1,person@example.com,2024-01-01,1,Active",
      "2,not-an-email,01/02/2024,2,active",
      "3,,2024-01-03,3, ACTIVE ",
      "4,other@example.org,01/04/2024,4,closed",
      "5,last@example.net,2024-01-05,5,closed",
      "6,six@example.net,01/06/2024,6,closed",
      "7,seven@example.net,2024-01-07,7,closed",
      "8,eight@example.net,01/08/2024,1000,closed",
      "7,seven@example.net,2024-01-07,7,closed",
    ].join("\n"));
    const profile = profileDataset(dataset);
    const byColumn = Object.fromEntries(profile.columnProfiles.map((column) => [column.column, column]));

    expect(byColumn.email.missing).toBe(1);
    expect(byColumn.email.invalidEmails).toBe(1);
    expect(byColumn.id.duplicateValues).toBe(1);
    expect(byColumn.created_at.dateFormats).toEqual(["YYYY-MM-DD", "slash date (MM/DD or DD/MM)"]);
    expect(byColumn.created_at.dateFormats.length).toBeGreaterThan(1);
    expect(byColumn.amount.numericOutliers).toBe(1);
    expect(byColumn.status.categoryVariants).toContainEqual({
      normalized: "active",
      values: ["Active", "active", " ACTIVE "],
      rows: 3,
    });
    expect(profile.duplicateRows).toBe(1);
    expect(profile.missingCells).toBe(1);
  });
});

describe("dataset fingerprints", () => {
  it("is deterministic, independent of file name, and changes with content or row order", async () => {
    const first = parseCsv("id,value\n1,a\n2,b", "first.csv");
    const sameContent = parseCsv("id,value\n1,a\n2,b", "renamed.csv");
    const changed = parseCsv("id,value\n1,a\n2,c", "first.csv");
    const reordered = parseCsv("id,value\n2,b\n1,a", "first.csv");

    const [firstHash, sameHash, changedHash, reorderedHash] = await Promise.all([
      fingerprintDataset(first),
      fingerprintDataset(sameContent),
      fingerprintDataset(changed),
      fingerprintDataset(reordered),
    ]);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sameHash).toBe(firstHash);
    expect(changedHash).not.toBe(firstHash);
    expect(reorderedHash).not.toBe(firstHash);
  });

  it("reports numeric movements, missing transitions, categorical distribution changes, and configured significance", () => {
    const old = parseCsv("id,amount,email,status,priority\n1,10,a@example.com,active,low\n2,20,,active,low\n3,30,b@example.com,inactive,low");
    const next = parseCsv("id,amount,email,status,priority\n1,15,,pending,low\n2,18,c@example.com,closed,low\n3,30,b@example.com,active,high");
    const result = compareDatasets(old, next, "id", { importantFields: ["priority"], criticalFields: ["email"] });

    expect(result.metrics.numericMovement.find((item) => item.column === "amount")).toMatchObject({
      increased: 1, decreased: 1, unchanged: 1, netChange: 3,
    });
    const withMissingAmount = compareDatasets(
      parseCsv("id,amount\n1,\n2,2"),
      parseCsv("id,amount\n1,5\n2,2"),
      "id",
    );
    expect(withMissingAmount.metrics.numericMovement[0]).toMatchObject({
      increased: 0, decreased: 0, unchanged: 1, netChange: 0,
    });
    expect(result.metrics.missingValueChanges).toContainEqual({ column: "email", becameMissing: 1, becamePresent: 1 });
    expect(result.metrics.categoricalDistribution.find((item) => item.column === "status")?.baseline)
      .not.toEqual(result.metrics.categoricalDistribution.find((item) => item.column === "status")?.newer);
    expect(result.metrics.significanceCounts.informational).toBe(0);
    expect(result.records.find((record) => record.id === "1")?.significance).toBe("critical");
    expect(result.records.find((record) => record.id === "3")?.significance).toBe("high");
    expect(result.metrics.significanceCounts.critical).toBe(2);
    expect(result.metrics.columnChangeFrequency.find((item) => item.column === "amount")).toMatchObject({
      count: 2, percentOfMatchedRecords: 66.66666666666666,
    });
    expect(generateInsights(result)).toContain("status category distribution changed among matched records.");
    expect(generateInsights(result)).toContain("email became missing in 1 matched record and became present in 1 matched record.");
  });
});
