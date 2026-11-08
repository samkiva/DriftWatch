import type {
  ComparisonOptions, ComparisonResult, IdentifierCandidate, RecordChange,
} from "./compare";
import type { Dataset } from "./csv";
import type { DatasetProfile } from "./profile";

type WorkerRequest =
  | { type: "parse-text"; contents: string; name: string }
  | { type: "parse-file"; file: File }
  | { type: "rank-identifiers"; baseline: Dataset; newer: Dataset }
  | { type: "compare"; baseline: Dataset; newer: Dataset; identifier: string; options: ComparisonOptions };

type CompactComparisonResult = Omit<ComparisonResult, "baseline" | "newer" | "records"> & {
  records: Array<Omit<RecordChange, "before" | "after">>;
};

type WorkerResponse =
  | { type: "parsed"; dataset: Dataset & { fingerprint: string; profile: DatasetProfile } }
  | { type: "compared"; result: CompactComparisonResult }
  | { type: "identifiers-ranked"; candidates: IdentifierCandidate[] }
  | { type: "error"; message: string };

function requestWorker(request: WorkerRequest): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./data.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      worker.terminate();
      if (data.type === "error") reject(new Error(data.message));
      else resolve(data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Background data worker failed."));
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      worker.terminate();
      reject(error instanceof Error ? error : new Error("Could not send data to the background worker."));
    }
  });
}

export async function parseCsvInWorker(contents: string, name: string): Promise<Dataset & { fingerprint: string; profile: DatasetProfile }> {
  const response = await requestWorker({ type: "parse-text", contents, name });
  if (response.type !== "parsed") throw new Error("Background parser returned an unexpected response.");
  return response.dataset;
}

export async function parseFileInWorker(file: File): Promise<Dataset & { fingerprint: string; profile: DatasetProfile }> {
  const response = await requestWorker({ type: "parse-file", file });
  if (response.type !== "parsed") throw new Error("Background parser returned an unexpected response.");
  return response.dataset;
}

export async function compareDatasetsInWorker(
  baseline: Dataset,
  newer: Dataset,
  identifier: string,
  options: ComparisonOptions,
): Promise<ComparisonResult> {
  const response = await requestWorker({ type: "compare", baseline, newer, identifier, options });
  if (response.type !== "compared") throw new Error("Background comparator returned an unexpected response.");
  const baselineRows = new Map(baseline.rows.map((row) => [row[identifier].trim(), row]));
  const newerRows = new Map(newer.rows.map((row) => [row[identifier].trim(), row]));
  const records: RecordChange[] = response.result.records.map((record) => ({
    ...record,
    ...(record.type !== "added" ? { before: baselineRows.get(record.identifierBefore ?? record.id) } : {}),
    ...(record.type !== "deleted" ? { after: newerRows.get(record.identifierAfter ?? record.id) } : {}),
  }));
  return { ...response.result, baseline, newer, records };
}

export async function rankIdentifierCandidatesInWorker(
  baseline: Dataset,
  newer: Dataset,
): Promise<IdentifierCandidate[]> {
  const response = await requestWorker({ type: "rank-identifiers", baseline, newer });
  if (response.type !== "identifiers-ranked") throw new Error("Background identifier analysis returned an unexpected response.");
  return response.candidates;
}
