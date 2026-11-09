import Papa from "papaparse";
import { parseFileInWorker, type WorkerRequestOptions } from "./worker-client";

export type CellValue = string;
export type DataType = "text" | "number" | "date" | "boolean" | "empty";
export type CsvRecord = Record<string, CellValue>;

export interface Dataset {
  name: string;
  headers: string[];
  rows: CsvRecord[];
  types: Record<string, DataType>;
  fingerprint?: string;
  profile?: import("./profile").DatasetProfile;
}

export class CsvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvValidationError";
  }
}

const isDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value) && !Number.isNaN(Date.parse(value));

export function inferType(values: string[]): DataType {
  const present = values.map((value) => value.trim()).filter(Boolean);
  if (!present.length) return "empty";
  if (present.every((value) => /^(true|false)$/i.test(value))) return "boolean";
  if (present.every((value) => value !== "" && Number.isFinite(Number(value)))) return "number";
  if (present.every(isDate)) return "date";
  return "text";
}

export function parseCsv(contents: string, name = "dataset.csv"): Dataset {
  if (!contents.trim()) throw new CsvValidationError("This file is empty.");
  if (contents.length > 150_000_000) {
    throw new CsvValidationError("This file exceeds the 150 MB in-browser limit.");
  }

  const parsed = Papa.parse<string[]>(contents, {
    header: false,
    skipEmptyLines: false,
    dynamicTyping: false,
  });
  const fatalError = parsed.errors.find((error) => error.code !== "UndetectableDelimiter");
  if (fatalError) {
    const error = fatalError;
    throw new CsvValidationError(`Could not parse CSV near row ${error.row ?? 1}: ${error.message}`);
  }

  const parsedRows = [...parsed.data];
  if (/(?:\r\n|\r|\n)$/.test(contents)) {
    const lastRow = parsedRows[parsedRows.length - 1];
    if (lastRow?.length === 1 && lastRow[0] === "") parsedRows.pop();
  }
  const [headerRow, ...dataRows] = parsedRows;
  if (!headerRow?.length) throw new CsvValidationError("The CSV must include a header row.");
  const headers = headerRow.map((header) => header.trim());
  if (headers.some((header) => !header)) throw new CsvValidationError("Column names cannot be empty.");
  const repeated = headers.find((header, index) => headers.indexOf(header) !== index);
  if (repeated) throw new CsvValidationError(`The column "${repeated}" appears more than once.`);

  const malformedRow = dataRows.findIndex((row) => row.length !== headers.length);
  if (malformedRow !== -1) {
    throw new CsvValidationError(
      `Row ${malformedRow + 2} has ${dataRows[malformedRow].length} values; expected ${headers.length}.`,
    );
  }

  const rows = dataRows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
  const types = Object.fromEntries(
    headers.map((header) => [header, inferType(rows.map((row) => row[header]))]),
  ) as Record<string, DataType>;
  return { name, headers, rows, types };
}

export async function readCsvFile(file: File, options?: WorkerRequestOptions): Promise<Dataset> {
  if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
    throw new CsvValidationError("Choose a .csv file to continue.");
  }
  if (file.size > 150_000_000) {
    throw new CsvValidationError("This file exceeds the 150 MB in-browser limit.");
  }
  return parseFileInWorker(file, options);
}
