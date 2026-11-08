import type { Dataset } from "./csv";

export interface CategoryVariant {
  normalized: string;
  values: string[];
  rows: number;
}

export interface ColumnProfile {
  column: string;
  rows: number;
  missing: number;
  missingPercent: number;
  unique: number;
  duplicateValues: number;
  invalidEmails: number;
  dateFormats: string[];
  numericOutliers: number;
  outlierBounds?: { lower: number; upper: number };
  categoryVariants: CategoryVariant[];
}

export interface DatasetProfile {
  rows: number;
  columns: number;
  missingCells: number;
  duplicateRows: number;
  fingerprint: string;
  columnProfiles: ColumnProfile[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isMissing(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function dateFormat(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return "YYYY-MM-DD";
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return "ISO date-time";
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) return "slash date (MM/DD or DD/MM)";
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(trimmed)) return "dash date (DD-MM or MM-DD)";
  return null;
}

function getOutlierBounds(values: number[]): { lower: number; upper: number } | undefined {
  if (values.length < 4) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const medianOf = (items: number[]) => {
    const middle = Math.floor(items.length / 2);
    return items.length % 2 ? items[middle] : (items[middle - 1] + items[middle]) / 2;
  };
  const midpoint = Math.floor(sorted.length / 2);
  const lowerHalf = sorted.slice(0, midpoint);
  const upperHalf = sorted.slice(Math.ceil(sorted.length / 2));
  const q1 = medianOf(lowerHalf);
  const q3 = medianOf(upperHalf);
  const spread = q3 - q1;
  return { lower: q1 - 1.5 * spread, upper: q3 + 1.5 * spread };
}

function getCategoryVariants(values: string[]): CategoryVariant[] {
  const isLowCardinality = new Set(values.map((value) => value.trim().toLowerCase())).size
    <= Math.max(20, Math.ceil(values.length * 0.2));
  if (!isLowCardinality || values.length < 2) return [];
  const groups = new Map<string, Map<string, number>>();
  for (const rawValue of values) {
    const normalized = rawValue.trim().toLowerCase().replace(/\s+/g, " ");
    const variants = groups.get(normalized) ?? new Map<string, number>();
    variants.set(rawValue, (variants.get(rawValue) ?? 0) + 1);
    groups.set(normalized, variants);
  }
  return [...groups.entries()]
    .filter(([, variants]) => variants.size > 1)
    .map(([normalized, variants]) => ({
      normalized,
      values: [...variants.keys()],
      rows: [...variants.values()].reduce((sum, count) => sum + count, 0),
    }));
}

export function profileDataset(dataset: Dataset): Omit<DatasetProfile, "fingerprint"> {
  const columnProfiles = dataset.headers.map((column): ColumnProfile => {
    const cells = dataset.rows.map((row) => row[column] ?? "");
    const present = cells.filter((value) => !isMissing(value));
    const unique = new Set(present).size;
    const emailLike = /email/i.test(column) || present.some((value) => value.includes("@"));
    const dates = present.map(dateFormat).filter((value): value is string => value !== null);
    const dateLike = /date|time/i.test(column) || dates.length === present.length;
    const numericValues = present.map(Number);
    const numeric = dataset.types[column] === "number"
      ? numericValues.filter(Number.isFinite)
      : [];
    const outlierBounds = getOutlierBounds(numeric);
    const numericOutliers = outlierBounds
      ? numeric.filter((value) => value < outlierBounds.lower || value > outlierBounds.upper).length
      : 0;
    const dateFormats = dateLike ? [...new Set(dates)] : [];
    return {
      column,
      rows: cells.length,
      missing: cells.length - present.length,
      missingPercent: cells.length ? ((cells.length - present.length) / cells.length) * 100 : 0,
      unique,
      duplicateValues: present.length - unique,
      invalidEmails: emailLike ? present.filter((value) => !EMAIL_PATTERN.test(value.trim())).length : 0,
      dateFormats,
      numericOutliers,
      ...(outlierBounds ? { outlierBounds } : {}),
      categoryVariants: dataset.types[column] === "text" ? getCategoryVariants(present) : [],
    };
  });
  const rowKeys = new Set<string>();
  let duplicateRows = 0;
  for (const row of dataset.rows) {
    const key = JSON.stringify(dataset.headers.map((column) => row[column] ?? ""));
    if (rowKeys.has(key)) duplicateRows += 1;
    else rowKeys.add(key);
  }
  return {
    rows: dataset.rows.length,
    columns: dataset.headers.length,
    missingCells: columnProfiles.reduce((sum, column) => sum + column.missing, 0),
    duplicateRows,
    columnProfiles,
  };
}
