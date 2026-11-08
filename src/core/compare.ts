import type { Dataset } from "./csv";

export type ChangeType = "added" | "deleted" | "modified" | "unchanged";
export type ChangeSignificance = "critical" | "high" | "moderate" | "informational";

export interface ComparisonOptions {
  criticalFields?: string[];
  importantFields?: string[];
  secondaryIdentifier?: string;
  identifierMappings?: Array<{ before: string; after: string }>;
}

export interface FieldChange {
  column: string;
  before: string;
  after: string;
  significance: ChangeSignificance;
}

export interface RecordChange {
  id: string;
  identifierBefore?: string;
  identifierAfter?: string;
  matchedBy?: "primary" | "secondary" | "mapping";
  type: ChangeType;
  before?: Record<string, string>;
  after?: Record<string, string>;
  changes: FieldChange[];
  significance: ChangeSignificance;
}

export interface ColumnRename {
  from: string;
  to: string;
  confidence: number;
}

export interface DatasetIdentifierStats {
  rows: number;
  nonEmptyValues: number;
  uniqueValues: number;
  duplicateRows: number;
  missingRows: number;
  uniquePercent: number;
}

export interface IdentifierAnalysis {
  identifier: string;
  baseline: DatasetIdentifierStats;
  newer: DatasetIdentifierStats;
  sharedValues: number;
  matchedPercentBaseline: number;
  matchedPercentNewer: number;
  addedByKey: number;
  deletedByKey: number;
  indexLike: boolean;
  sequentialIndex: boolean;
  warnings: string[];
}

export interface IdentifierCandidate extends IdentifierAnalysis {
  score: number;
  recommendation: "likely" | "verify" | "avoid";
}

export interface ComparisonResult {
  identifier: string;
  identifierAnalysis: IdentifierAnalysis;
  criticalFields: string[];
  importantFields: string[];
  baseline: Dataset;
  newer: Dataset;
  records: RecordChange[];
  schema: {
    added: string[];
    removed: string[];
    renamed: ColumnRename[];
    typeChanged: string[];
  };
  metrics: {
    baselineTotal: number;
    newerTotal: number;
    added: number;
    deleted: number;
    modified: number;
    unchanged: number;
    affectedPercent: number;
    modifiedColumns: Array<{ column: string; count: number }>;
    columnChangeFrequency: Array<{ column: string; count: number; percentOfMatchedRecords: number }>;
    missingValueChanges: Array<{ column: string; becameMissing: number; becamePresent: number }>;
    numericMovement: Array<{
      column: string;
      increased: number;
      decreased: number;
      unchanged: number;
      netChange: number;
    }>;
    categoricalDistribution: Array<{
      column: string;
      baseline: Array<{ value: string; count: number }>;
      newer: Array<{ value: string; count: number }>;
    }>;
    significanceCounts: Record<ChangeSignificance, number>;
  };
}

export class ComparisonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComparisonError";
  }
}

function assertUniqueIdentifiers(dataset: Dataset, identifier: string, label: string): Map<string, Record<string, string>> {
  if (!dataset.headers.includes(identifier)) {
    throw new ComparisonError(`"${identifier}" is not a column in ${label}.`);
  }
  const map = new Map<string, Record<string, string>>();
  for (const [index, row] of dataset.rows.entries()) {
    const value = row[identifier]?.trim();
    if (!value) {
      throw new ComparisonError(`${label} row ${index + 2} has a missing "${identifier}" value.`);
    }
    if (map.has(value)) {
      throw new ComparisonError(`${label} contains duplicate "${identifier}" value "${value}".`);
    }
    map.set(value, row);
  }
  return map;
}

function getIdentifierStats(dataset: Dataset, identifier: string): DatasetIdentifierStats {
  const counts = new Map<string, number>();
  let missingRows = 0;
  for (const row of dataset.rows) {
    const value = row[identifier]?.trim();
    if (!value) {
      missingRows += 1;
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const nonEmptyValues = dataset.rows.length - missingRows;
  const uniqueValues = counts.size;
  return {
    rows: dataset.rows.length,
    nonEmptyValues,
    uniqueValues,
    duplicateRows: nonEmptyValues - uniqueValues,
    missingRows,
    uniquePercent: dataset.rows.length ? (uniqueValues / dataset.rows.length) * 100 : 0,
  };
}

function isIndexLikeColumn(column: string): boolean {
  const normalized = column.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /^(index|idx|row|rownum|rownumber|recordnum|recordnumber|line|linenum|lineno|unnamed\d*)$/.test(normalized);
}

function isSequentialIndex(dataset: Dataset, identifier: string): boolean {
  if (!dataset.rows.length) return false;
  const values = dataset.rows.map((row) => row[identifier]?.trim() ?? "");
  const numbers = values.map(Number);
  if (numbers.some((value, index) => !values[index] || !Number.isInteger(value))) return false;
  const start = numbers[0];
  if (start !== 0 && start !== 1) return false;
  return numbers.every((value, index) => value === start + index);
}

export function analyzeIdentifier(
  baseline: Dataset,
  newer: Dataset,
  identifier: string,
): IdentifierAnalysis {
  const baselineStats = getIdentifierStats(baseline, identifier);
  const newerStats = getIdentifierStats(newer, identifier);
  const baselineValues = new Set(baseline.rows.map((row) => row[identifier]?.trim()).filter(Boolean));
  const newerValues = new Set(newer.rows.map((row) => row[identifier]?.trim()).filter(Boolean));
  const sharedValues = [...baselineValues].filter((value) => newerValues.has(value)).length;
  const indexLike = isIndexLikeColumn(identifier);
  const sequentialIndex = indexLike
    && isSequentialIndex(baseline, identifier)
    && isSequentialIndex(newer, identifier);
  const warnings: string[] = [];

  if (indexLike) {
    warnings.push(sequentialIndex
      ? `"${identifier}" contains consecutive row positions in both files. Matching on it creates positional matches and may incorrectly associate different records.`
      : `"${identifier}" looks like a row index, not a stable record identifier. Matching on it may incorrectly associate different records.`);
  }
  if (baselineStats.duplicateRows || newerStats.duplicateRows || baselineStats.missingRows || newerStats.missingRows) {
    warnings.push(`"${identifier}" is not unique and complete in both files. Comparison cannot safely use this key.`);
  }
  if (baselineStats.rows && newerStats.rows && sharedValues === 0) {
    warnings.push(`No "${identifier}" values overlap. Confirm that these files represent snapshots with a shared population; no rows will match by this key alone.`);
  } else if (baselineStats.rows && newerStats.rows && sharedValues < Math.min(baselineStats.rows, newerStats.rows) * 0.1) {
    warnings.push(`Only ${sharedValues} "${identifier}" values overlap. Review whether the selected key identifies the same records in both files.`);
  }

  return {
    identifier,
    baseline: baselineStats,
    newer: newerStats,
    sharedValues,
    matchedPercentBaseline: baselineStats.uniqueValues ? (sharedValues / baselineStats.uniqueValues) * 100 : 0,
    matchedPercentNewer: newerStats.uniqueValues ? (sharedValues / newerStats.uniqueValues) * 100 : 0,
    addedByKey: newerStats.uniqueValues - sharedValues,
    deletedByKey: baselineStats.uniqueValues - sharedValues,
    indexLike,
    sequentialIndex,
    warnings,
  };
}

export function rankIdentifierCandidates(baseline: Dataset, newer: Dataset): IdentifierCandidate[] {
  const sharedColumns = baseline.headers.filter((column) => newer.headers.includes(column));
  return sharedColumns.map((identifier) => {
    const analysis = analyzeIdentifier(baseline, newer, identifier);
    const normalized = identifier.toLowerCase().replace(/[^a-z0-9]/g, "");
    const semanticId = /(^|customer|account|client|user|record|order|product|transaction)(id|uuid|guid|key)$/.test(normalized)
      || /^(id|uuid|guid|key)$/.test(normalized);
    const completeUnique = analysis.baseline.rows > 0
      && analysis.newer.rows > 0
      && analysis.baseline.duplicateRows === 0
      && analysis.newer.duplicateRows === 0
      && analysis.baseline.missingRows === 0
      && analysis.newer.missingRows === 0;
    const score = (completeUnique ? 50 : 0) + (semanticId ? 40 : 0) - (analysis.indexLike ? 100 : 0);
    const recommendation: IdentifierCandidate["recommendation"] = analysis.indexLike
      ? "avoid"
      : completeUnique && semanticId ? "likely" : "verify";
    return { ...analysis, score, recommendation };
  }).sort((a, b) => b.score - a.score || a.identifier.localeCompare(b.identifier));
}

function detectRenames(baseline: Dataset, newer: Dataset, removed: string[], added: string[]): ColumnRename[] {
  const renames: ColumnRename[] = [];
  const unmatchedAdded = new Set(added);
  for (const from of removed) {
    const oldValues = baseline.rows.map((row) => row[from] ?? "");
    const candidates = [...unmatchedAdded]
      .map((to) => {
        const newValues = newer.rows.map((row) => row[to] ?? "");
        const oldSet = new Set(oldValues.filter(Boolean));
        const newSet = new Set(newValues.filter(Boolean));
        const overlap = [...oldSet].filter((value) => newSet.has(value)).length;
        const union = new Set([...oldSet, ...newSet]).size;
        const valueSimilarity = union ? overlap / union : 0;
        const lengthSimilarity = Math.min(oldValues.length, newValues.length) / Math.max(oldValues.length, newValues.length, 1);
        return { to, confidence: valueSimilarity * lengthSimilarity };
      })
      .sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];
    if (best && best.confidence >= 0.8) {
      renames.push({ from, to: best.to, confidence: best.confidence });
      unmatchedAdded.delete(best.to);
    }
  }
  return renames;
}

export function compareDatasets(
  baseline: Dataset,
  newer: Dataset,
  identifier: string,
  options: ComparisonOptions = {},
): ComparisonResult {
  const identifierAnalysis = analyzeIdentifier(baseline, newer, identifier);
  const oldRows = assertUniqueIdentifiers(baseline, identifier, "Baseline");
  const newRows = assertUniqueIdentifiers(newer, identifier, "Newer dataset");
  const secondaryIdentifier = options.secondaryIdentifier;
  const oldSecondaryRows = secondaryIdentifier
    ? assertUniqueIdentifiers(baseline, secondaryIdentifier, "Baseline secondary identifier")
    : undefined;
  const newSecondaryRows = secondaryIdentifier
    ? assertUniqueIdentifiers(newer, secondaryIdentifier, "Newer secondary identifier")
    : undefined;
  if (secondaryIdentifier === identifier) {
    throw new ComparisonError("The secondary identifier must be different from the primary matching identifier.");
  }
  if (secondaryIdentifier && !newer.headers.includes(secondaryIdentifier)) {
    throw new ComparisonError(`"${secondaryIdentifier}" is not a shared column and cannot be used as a secondary identifier.`);
  }
  const pairedOldIds = new Set<string>();
  const pairedNewIds = new Set<string>();
  const pairs: Array<{ beforeId: string; afterId: string; matchedBy: "primary" | "secondary" | "mapping" }> = [];
  for (const id of newRows.keys()) {
    if (!oldRows.has(id)) continue;
    if (secondaryIdentifier && oldRows.get(id)?.[secondaryIdentifier]?.trim() !== newRows.get(id)?.[secondaryIdentifier]?.trim()) {
      throw new ComparisonError(`Primary identifier "${id}" conflicts with secondary identifier "${secondaryIdentifier}". Review the keys or provide a corrected explicit mapping.`);
    }
    pairs.push({ beforeId: id, afterId: id, matchedBy: "primary" });
    pairedOldIds.add(id);
    pairedNewIds.add(id);
  }

  const mappings = options.identifierMappings ?? [];
  const mappedBefore = new Set<string>();
  const mappedAfter = new Set<string>();
  for (const mapping of mappings) {
    const beforeId = mapping.before.trim();
    const afterId = mapping.after.trim();
    if (!beforeId || !afterId) throw new ComparisonError("Explicit identifier mappings cannot contain empty values.");
    if (!oldRows.has(beforeId) || !newRows.has(afterId)) {
      throw new ComparisonError(`Identifier mapping "${beforeId}" → "${afterId}" must reference an existing baseline and newer identifier.`);
    }
    if (mappedBefore.has(beforeId) || mappedAfter.has(afterId)) {
      throw new ComparisonError("Explicit identifier mappings must use each old and new identifier at most once.");
    }
    if (beforeId === afterId || pairedOldIds.has(beforeId) || pairedNewIds.has(afterId)) {
      throw new ComparisonError(`Identifier mapping "${beforeId}" → "${afterId}" conflicts with an existing primary-key match.`);
    }
    if (secondaryIdentifier
      && oldRows.get(beforeId)?.[secondaryIdentifier]?.trim() !== newRows.get(afterId)?.[secondaryIdentifier]?.trim()) {
      throw new ComparisonError(`Identifier mapping "${beforeId}" → "${afterId}" conflicts with secondary identifier "${secondaryIdentifier}".`);
    }
    mappedBefore.add(beforeId);
    mappedAfter.add(afterId);
    pairs.push({ beforeId, afterId, matchedBy: "mapping" });
    pairedOldIds.add(beforeId);
    pairedNewIds.add(afterId);
  }

  if (secondaryIdentifier && oldSecondaryRows && newSecondaryRows) {
    const newerIdBySecondary = new Map<string, string>();
    for (const [newId, row] of newRows) {
      newerIdBySecondary.set(row[secondaryIdentifier].trim(), newId);
    }
    for (const [oldId, row] of oldRows) {
      if (pairedOldIds.has(oldId)) continue;
      const afterId = newerIdBySecondary.get(row[secondaryIdentifier].trim());
      if (!afterId || pairedNewIds.has(afterId)) continue;
      pairs.push({ beforeId: oldId, afterId, matchedBy: "secondary" });
      pairedOldIds.add(oldId);
      pairedNewIds.add(afterId);
    }
  }
  const oldColumns = new Set(baseline.headers);
  const newColumns = new Set(newer.headers);
  const addedColumns = newer.headers.filter((column) => !oldColumns.has(column));
  const removedColumns = baseline.headers.filter((column) => !newColumns.has(column));
  const commonColumns = baseline.headers.filter((column) => newColumns.has(column) && column !== identifier);
  const criticalFields = [...new Set(options.criticalFields ?? [])];
  const importantFields = [...new Set((options.importantFields ?? []).filter((column) => !criticalFields.includes(column)))];
  const significanceFor = (column: string): ChangeSignificance => {
    if (column === identifier || criticalFields.includes(column)) return "critical";
    if (importantFields.includes(column)) return "high";
    return "moderate";
  };
  const records: RecordChange[] = [];

  for (const { beforeId, afterId, matchedBy } of pairs) {
    const before = oldRows.get(beforeId)!;
    const after = newRows.get(afterId)!;
    const changes = commonColumns
      .filter((column) => (before[column] ?? "") !== (after[column] ?? ""))
      .map((column) => ({
        column,
        before: before[column] ?? "",
        after: after[column] ?? "",
        significance: significanceFor(column),
      }));
    if (beforeId !== afterId) {
      changes.unshift({
        column: identifier,
        before: beforeId,
        after: afterId,
        significance: "critical",
      });
    }
    const significance = changes.some((change) => change.significance === "critical")
      ? "critical"
      : changes.some((change) => change.significance === "high")
        ? "high"
        : changes.length ? "moderate" : "informational";
    records.push({
      id: afterId,
      ...(beforeId !== afterId ? { identifierBefore: beforeId, identifierAfter: afterId } : {}),
      matchedBy,
      type: changes.length ? "modified" : "unchanged",
      before,
      after,
      changes,
      significance,
    });
  }
  for (const [id, after] of newRows) {
    if (!pairedNewIds.has(id)) records.push({ id, type: "added", after, changes: [], significance: "informational" });
  }
  for (const [id, before] of oldRows) {
    if (!pairedOldIds.has(id)) records.push({ id, type: "deleted", before, changes: [], significance: "informational" });
  }

  const added = records.filter((record) => record.type === "added").length;
  const deleted = records.filter((record) => record.type === "deleted").length;
  const modified = records.filter((record) => record.type === "modified").length;
  const unchanged = records.filter((record) => record.type === "unchanged").length;
  const affected = added + deleted + modified;
  const unionSize = records.length;
  const columnCounts = new Map<string, number>();
  for (const record of records) {
    for (const change of record.changes) columnCounts.set(change.column, (columnCounts.get(change.column) ?? 0) + 1);
  }
  const matchedRecords = records.filter((record) => record.before && record.after);
  const columnChangeFrequency = [...columnCounts.entries()]
    .map(([column, count]) => ({
      column,
      count,
      percentOfMatchedRecords: matchedRecords.length ? (count / matchedRecords.length) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.column.localeCompare(b.column));
  const missingValueChanges = commonColumns.map((column) => {
    let becameMissing = 0;
    let becamePresent = 0;
    for (const record of matchedRecords) {
      const beforeMissing = !(record.before?.[column] ?? "").trim();
      const afterMissing = !(record.after?.[column] ?? "").trim();
      if (!beforeMissing && afterMissing) becameMissing += 1;
      if (beforeMissing && !afterMissing) becamePresent += 1;
    }
    return { column, becameMissing, becamePresent };
  }).filter((change) => change.becameMissing || change.becamePresent);
  const numericMovement = commonColumns
    .filter((column) => baseline.types[column] === "number" && newer.types[column] === "number")
    .map((column) => {
      let increased = 0;
      let decreased = 0;
      let unchanged = 0;
      let netChange = 0;
      for (const record of matchedRecords) {
        const beforeText = record.before?.[column] ?? "";
        const afterText = record.after?.[column] ?? "";
        if (!beforeText.trim() || !afterText.trim()) continue;
        const beforeValue = Number(beforeText);
        const afterValue = Number(afterText);
        if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) continue;
        const difference = afterValue - beforeValue;
        netChange += difference;
        if (difference > 0) increased += 1;
        else if (difference < 0) decreased += 1;
        else unchanged += 1;
      }
      return { column, increased, decreased, unchanged, netChange };
    });
  const categoricalDistribution = commonColumns
    .filter((column) => baseline.types[column] === "text" && newer.types[column] === "text")
    .map((column) => {
      const oldCounts = new Map<string, number>();
      const newCounts = new Map<string, number>();
      for (const record of matchedRecords) {
        const beforeValue = record.before?.[column] ?? "";
        const afterValue = record.after?.[column] ?? "";
        if (beforeValue.trim()) oldCounts.set(beforeValue, (oldCounts.get(beforeValue) ?? 0) + 1);
        if (afterValue.trim()) newCounts.set(afterValue, (newCounts.get(afterValue) ?? 0) + 1);
      }
      const serialize = (counts: Map<string, number>) =>
        [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      return { column, baseline: serialize(oldCounts), newer: serialize(newCounts) };
    }).filter((distribution) =>
      JSON.stringify(distribution.baseline) !== JSON.stringify(distribution.newer),
    );
  const significanceCounts: Record<ChangeSignificance, number> = {
    critical: 0, high: 0, moderate: 0, informational: 0,
  };
  for (const record of records) {
    if (record.type !== "unchanged") significanceCounts[record.significance] += 1;
  }
  significanceCounts.informational += addedColumns.length + removedColumns.length
    + commonColumns.filter((column) => baseline.types[column] !== newer.types[column]).length;

  return {
    identifier,
    identifierAnalysis,
    criticalFields,
    importantFields,
    baseline,
    newer,
    records,
    schema: {
      added: addedColumns,
      removed: removedColumns,
      renamed: detectRenames(baseline, newer, removedColumns, addedColumns),
      typeChanged: commonColumns.filter((column) => baseline.types[column] !== newer.types[column]),
    },
    metrics: {
      baselineTotal: baseline.rows.length,
      newerTotal: newer.rows.length,
      added,
      deleted,
      modified,
      unchanged,
      affectedPercent: unionSize ? (affected / unionSize) * 100 : 0,
      modifiedColumns: [...columnCounts.entries()]
        .map(([column, count]) => ({ column, count }))
        .sort((a, b) => b.count - a.count || a.column.localeCompare(b.column)),
      columnChangeFrequency,
      missingValueChanges,
      numericMovement,
      categoricalDistribution,
      significanceCounts,
    },
  };
}

export function generateInsights(result: ComparisonResult): string[] {
  const { metrics } = result;
  const insights: string[] = [];
  if (metrics.added) insights.push(`${metrics.added} ${metrics.added === 1 ? "record was" : "records were"} added to the newer dataset.`);
  if (metrics.deleted) insights.push(`${metrics.deleted} ${metrics.deleted === 1 ? "record was" : "records were"} removed from the newer dataset.`);
  for (const item of metrics.modifiedColumns.slice(0, 3)) {
    insights.push(`${item.column} changed in ${item.count} ${item.count === 1 ? "record" : "records"}.`);
  }
  for (const item of metrics.numericMovement.filter((movement) => movement.increased || movement.decreased).slice(0, 2)) {
    insights.push(`${item.column} increased in ${item.increased} matched records and decreased in ${item.decreased}; net movement ${item.netChange > 0 ? "+" : ""}${item.netChange}.`);
  }
  for (const item of metrics.missingValueChanges.slice(0, 2)) {
    const missingRecords = item.becameMissing === 1 ? "record" : "records";
    const presentRecords = item.becamePresent === 1 ? "record" : "records";
    insights.push(`${item.column} became missing in ${item.becameMissing} matched ${missingRecords} and became present in ${item.becamePresent} matched ${presentRecords}.`);
  }
  for (const item of metrics.categoricalDistribution.slice(0, 2)) {
    insights.push(`${item.column} category distribution changed among matched records.`);
  }
  for (const column of result.schema.added) insights.push(`A new column, ${column}, appears in the newer dataset.`);
  for (const column of result.schema.removed) insights.push(`The column ${column} is absent from the newer dataset.`);
  if (!insights.length) insights.push("No record-level changes were found between these datasets.");
  return insights;
}
