import type { ComparisonResult } from "./compare";
import type { Dataset } from "./csv";

const DATABASE_NAME = "driftwatch-local";
const DATABASE_VERSION = 1;
const METADATA_STORE = "saved-comparisons";
const PAYLOAD_STORE = "comparison-payloads";

export interface SavedComparisonMetadata {
  id: string;
  savedAt: number;
  baselineName: string;
  newerName: string;
  identifier: string;
  baselineFingerprint: string;
  newerFingerprint: string;
}

interface SavedComparisonPayload {
  id: string;
  result: ComparisonResult;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("This browser does not support local comparison storage."));
  }
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(PAYLOAD_STORE)) {
        database.createObjectStore(PAYLOAD_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open local comparison storage."));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Local comparison storage is blocked by another open DriftWatch tab."));
    };
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local comparison storage failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local comparison storage was interrupted."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not read local comparison storage."));
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDataset(value: unknown): value is Dataset {
  if (!isObject(value) || typeof value.name !== "string"
    || !Array.isArray(value.headers) || !Array.isArray(value.rows) || !isObject(value.types)) return false;
  const headers = value.headers;
  const rows = value.rows;
  return headers.every((header): header is string => typeof header === "string")
    && rows.every((row) => isObject(row)
      && headers.every((header) => typeof row[header] === "string"));
}

function isComparisonResult(value: unknown): value is ComparisonResult {
  if (!isObject(value) || typeof value.identifier !== "string"
    || !isDataset(value.baseline) || !isDataset(value.newer)
    || !Array.isArray(value.records) || !isObject(value.identifierAnalysis)
    || !isObject(value.schema) || !isObject(value.metrics)) return false;
  return Array.isArray(value.records)
    && Array.isArray(value.schema.added) && Array.isArray(value.schema.removed)
    && Array.isArray(value.schema.renamed) && Array.isArray(value.schema.typeChanged)
    && typeof value.metrics.baselineTotal === "number"
    && typeof value.metrics.newerTotal === "number"
    && typeof value.metrics.added === "number"
    && typeof value.metrics.deleted === "number"
    && typeof value.metrics.modified === "number"
    && typeof value.metrics.unchanged === "number"
    && Array.isArray(value.metrics.modifiedColumns)
    && Array.isArray(value.metrics.columnChangeFrequency)
    && Array.isArray(value.metrics.missingValueChanges)
    && Array.isArray(value.metrics.numericMovement)
    && Array.isArray(value.metrics.categoricalDistribution)
    && isObject(value.metrics.significanceCounts);
}

export async function saveComparison(result: ComparisonResult): Promise<SavedComparisonMetadata> {
  const metadata: SavedComparisonMetadata = {
    id: crypto.randomUUID(),
    savedAt: Date.now(),
    baselineName: result.baseline.name,
    newerName: result.newer.name,
    identifier: result.identifier,
    baselineFingerprint: result.baseline.fingerprint ?? "",
    newerFingerprint: result.newer.fingerprint ?? "",
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction([METADATA_STORE, PAYLOAD_STORE], "readwrite");
    transaction.objectStore(METADATA_STORE).put(metadata);
    transaction.objectStore(PAYLOAD_STORE).put({ id: metadata.id, result } satisfies SavedComparisonPayload);
    await transactionDone(transaction);
    return metadata;
  } finally {
    database.close();
  }
}

export async function listSavedComparisons(): Promise<SavedComparisonMetadata[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(METADATA_STORE, "readonly");
    const metadata = await requestResult(transaction.objectStore(METADATA_STORE).getAll()) as SavedComparisonMetadata[];
    await transactionDone(transaction);
    return metadata.sort((left, right) => right.savedAt - left.savedAt);
  } finally {
    database.close();
  }
}

export async function openSavedComparison(id: string): Promise<ComparisonResult> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PAYLOAD_STORE, "readonly");
    const payload = await requestResult(transaction.objectStore(PAYLOAD_STORE).get(id)) as SavedComparisonPayload | undefined;
    await transactionDone(transaction);
    if (!payload || payload.id !== id || !isComparisonResult(payload.result)) {
      throw new Error("This saved comparison is missing or has an unsupported format.");
    }
    return payload.result;
  } finally {
    database.close();
  }
}

export async function deleteSavedComparison(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([METADATA_STORE, PAYLOAD_STORE], "readwrite");
    transaction.objectStore(METADATA_STORE).delete(id);
    transaction.objectStore(PAYLOAD_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
