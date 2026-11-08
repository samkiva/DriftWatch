import type { ComparisonResult } from "./compare";
import Papa from "papaparse";

export function exportDifferencesCsv(result: ComparisonResult): string {
  const identifierField = ["change_type", "changed_columns", "before", "after"].includes(result.identifier)
    ? `${result.identifier}_value`
    : result.identifier;
  const rows = result.records.map((record) => ({
    change_type: record.type,
    [identifierField]: record.id,
    changed_columns: record.changes.map((change) => change.column).join("; "),
    significance: record.significance,
    changed_fields: JSON.stringify(record.changes.map(({ column, significance }) => ({ column, significance }))),
    before: record.before ? JSON.stringify(record.before) : "",
    after: record.after ? JSON.stringify(record.after) : "",
    matching_identifier: result.identifier,
    matching_warning: result.identifierAnalysis.warnings.join(" "),
    identifier_before: record.identifierBefore ?? "",
    identifier_after: record.identifierAfter ?? "",
    matched_by: record.matchedBy ?? "",
    significance_rule: "Critical=confirmed primary identifier change or explicit critical field; High=user-designated important field; Moderate=other matched change; Informational=add/remove/schema change",
  }));
  return Papa.unparse({
    fields: ["change_type", identifierField, "changed_columns", "significance", "changed_fields", "before", "after", "matching_identifier", "matching_warning", "identifier_before", "identifier_after", "matched_by", "significance_rule"],
    data: rows,
  }, { newline: "\r\n", escapeFormulae: true });
}

export function exportSummaryCsv(result: ComparisonResult): string {
  return Papa.unparse([
    { metric: "Matching identifier", value: result.identifier },
    { metric: "Baseline unique values", value: result.identifierAnalysis.baseline.uniqueValues },
    { metric: "Baseline duplicate rows", value: result.identifierAnalysis.baseline.duplicateRows },
    { metric: "Baseline missing values", value: result.identifierAnalysis.baseline.missingRows },
    { metric: "Newer unique values", value: result.identifierAnalysis.newer.uniqueValues },
    { metric: "Newer duplicate rows", value: result.identifierAnalysis.newer.duplicateRows },
    { metric: "Newer missing values", value: result.identifierAnalysis.newer.missingRows },
    { metric: "Matched identifier values", value: result.identifierAnalysis.sharedValues },
    { metric: "Primary identifier changes linked", value: result.records.filter((record) => record.identifierBefore).length },
    { metric: "Linked by secondary identifier", value: result.records.filter((record) => record.matchedBy === "secondary").length },
    { metric: "Linked by explicit mapping", value: result.records.filter((record) => record.matchedBy === "mapping").length },
    { metric: "Significance rules", value: "Critical=confirmed primary identifier change or explicit critical field; High=user-designated important field; Moderate=other matched change; Informational=add/remove/schema change" },
    { metric: "Baseline dataset SHA-256", value: result.baseline.fingerprint ?? "Not available" },
    { metric: "Newer dataset SHA-256", value: result.newer.fingerprint ?? "Not available" },
    ...result.identifierAnalysis.warnings.map((warning, index) => ({ metric: `Matching warning ${index + 1}`, value: warning })),
    ...Object.entries(result.metrics.significanceCounts).map(([level, count]) => ({ metric: `${level} records`, value: count })),
    ...result.metrics.columnChangeFrequency.map((item) => ({
      metric: `Column changes: ${item.column}`,
      value: `${item.count} (${item.percentOfMatchedRecords.toFixed(2)}% of matched records)`,
    })),
    ...result.metrics.missingValueChanges.map((item) => ({
      metric: `Missing changes: ${item.column}`,
      value: `${item.becameMissing} became missing; ${item.becamePresent} became present`,
    })),
    ...result.metrics.numericMovement.map((item) => ({
      metric: `Numeric movement: ${item.column}`,
      value: `${item.increased} increased; ${item.decreased} decreased; net ${item.netChange}`,
    })),
    ...result.metrics.categoricalDistribution.map((item) => ({
      metric: `Categorical distribution: ${item.column}`,
      value: `before ${JSON.stringify(item.baseline)}; after ${JSON.stringify(item.newer)}`,
    })),
    { metric: "Baseline records", value: result.metrics.baselineTotal },
    { metric: "Newer records", value: result.metrics.newerTotal },
    { metric: "Added", value: result.metrics.added },
    { metric: "Deleted", value: result.metrics.deleted },
    { metric: "Modified", value: result.metrics.modified },
    { metric: "Unchanged", value: result.metrics.unchanged },
    { metric: "Affected records (%)", value: result.metrics.affectedPercent.toFixed(2) },
  ], { escapeFormulae: true });
}

export function exportHtmlReport(result: ComparisonResult): string {
  const escape = (value: string) =>
    value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  const tableRows = result.records.map((record) =>
    `<tr><td>${escape(record.type)}</td><td>${escape(record.significance)}</td><td>${escape(record.id)}</td><td>${escape(record.changes.map((change) => `${change.column} (${change.significance})`).join(", "))}</td><td>${escape(record.before ? JSON.stringify(record.before) : "")}</td><td>${escape(record.after ? JSON.stringify(record.after) : "")}</td></tr>`,
  ).join("");
  const identifierWarnings = result.identifierAnalysis.warnings.length
    ? `<section class="warnings"><strong>Matching key warning · ${escape(result.identifier)}</strong><ul>${result.identifierAnalysis.warnings.map((warning) => `<li>${escape(warning)}</li>`).join("")}</ul><p>Unique values: ${result.identifierAnalysis.baseline.uniqueValues}/${result.identifierAnalysis.baseline.rows} baseline and ${result.identifierAnalysis.newer.uniqueValues}/${result.identifierAnalysis.newer.rows} newer. Matched values: ${result.identifierAnalysis.sharedValues}.</p></section>`
    : `<p>Matching key check: ${result.identifierAnalysis.baseline.uniqueValues}/${result.identifierAnalysis.baseline.rows} baseline and ${result.identifierAnalysis.newer.uniqueValues}/${result.identifierAnalysis.newer.rows} newer values unique; ${result.identifierAnalysis.sharedValues} values matched.</p>`;
  const distributionItems = result.metrics.categoricalDistribution.map((item) =>
    `<li>${escape(item.column)} distribution: before ${escape(JSON.stringify(item.baseline))}; after ${escape(JSON.stringify(item.newer))}.</li>`,
  ).join("");
  const analyticsItems = [
    ...result.metrics.columnChangeFrequency.map((item) =>
      `<li>${escape(item.column)} changed in ${item.count} matched records (${item.percentOfMatchedRecords.toFixed(1)}%).</li>`),
    ...result.metrics.numericMovement.map((item) =>
      `<li>${escape(item.column)} increased ${item.increased} times, decreased ${item.decreased} times; net movement ${item.netChange}.</li>`),
    ...result.metrics.missingValueChanges.map((item) =>
      `<li>${escape(item.column)} became missing ${item.becameMissing} times and became present ${item.becamePresent} times.</li>`),
  ].join("");
  const significanceRules = "Critical = confirmed primary identifier changes or explicitly designated critical fields; High = user-designated important fields; Moderate = other matched value changes; Informational = additions, removals and schema changes.";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DriftWatch comparison report</title><style>body{font:15px system-ui;background:#0b0f16;color:#e5e7eb;margin:40px}h1{color:#71dfad}p{color:#aab2c0}.metrics{display:flex;gap:14px;flex-wrap:wrap}.metric{border:1px solid #29313f;border-radius:10px;padding:14px;min-width:110px}.metric b{display:block;font-size:23px;margin-top:8px}.warnings{border:1px solid #764b24;background:#2a2115;color:#f2c77f;border-radius:8px;padding:14px;margin:18px 0}.warnings p{color:#e2c99e}.fingerprints{font:12px monospace;overflow-wrap:anywhere;color:#aab2c0}.rules{border-left:2px solid #61754e;padding:8px 12px;color:#aab2c0;font-size:13px}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{text-align:left;padding:10px;border-bottom:1px solid #29313f;vertical-align:top}th{color:#9ba6b7}code{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>DriftWatch</h1><p>Comparison report · ${escape(result.baseline.name)} → ${escape(result.newer.name)} · Identifier: ${escape(result.identifier)}</p>${identifierWarnings}<p class="fingerprints">Baseline SHA-256: ${escape(result.baseline.fingerprint ?? "Unavailable")}<br>Newer SHA-256: ${escape(result.newer.fingerprint ?? "Unavailable")}</p><section class="metrics">${Object.entries({Added:result.metrics.added,Deleted:result.metrics.deleted,Modified:result.metrics.modified,Unchanged:result.metrics.unchanged,"Affected %":`${result.metrics.affectedPercent.toFixed(1)}%`,...result.metrics.significanceCounts}).map(([label,value])=>`<div class="metric">${escape(label)}<b>${escape(String(value))}</b></div>`).join("")}</section><p class="rules">${escape(significanceRules)}</p><h2>Column analytics</h2><ul>${analyticsItems}${distributionItems}</ul><table><thead><tr><th>Change</th><th>Significance</th><th>${escape(result.identifier)}</th><th>Changed columns</th><th>Before</th><th>After</th></tr></thead><tbody>${tableRows}</tbody></table></html>`;
}
