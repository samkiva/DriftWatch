import {
  compareDatasets, rankIdentifierCandidates,
  type ComparisonOptions, type ComparisonResult, type RecordChange,
} from "./compare";
import { fingerprintDataset } from "./fingerprint";
import type { Dataset } from "./csv";
import { parseCsv } from "./csv";
import { profileDataset, type DatasetProfile } from "./profile";

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
  | { type: "identifiers-ranked"; candidates: ReturnType<typeof rankIdentifierCandidates> }
  | { type: "error"; message: string };

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse): void;
}

const workerScope = self as unknown as WorkerScope;

async function parseContents(contents: string, name: string): Promise<WorkerResponse> {
  const parsed = parseCsv(contents, name);
  const [fingerprint, baseProfile] = await Promise.all([
    fingerprintDataset(parsed),
    Promise.resolve(profileDataset(parsed)),
  ]);
  const profile: DatasetProfile = { ...baseProfile, fingerprint };
  return { type: "parsed", dataset: { ...parsed, fingerprint, profile } };
}

workerScope.addEventListener("message", async ({ data }) => {
  try {
    let response: WorkerResponse;
    if (data.type === "parse-file") {
      if (data.file.size > 150_000_000) throw new Error("This file exceeds the 150 MB in-browser limit.");
      response = await parseContents(await data.file.text(), data.file.name);
    } else if (data.type === "parse-text") {
      response = await parseContents(data.contents, data.name);
    } else if (data.type === "rank-identifiers") {
      response = {
        type: "identifiers-ranked",
        candidates: rankIdentifierCandidates(data.baseline, data.newer),
      };
    } else {
      const fullResult = compareDatasets(data.baseline, data.newer, data.identifier, data.options);
      response = {
        type: "compared",
        result: {
          identifier: fullResult.identifier,
          identifierAnalysis: fullResult.identifierAnalysis,
          criticalFields: fullResult.criticalFields,
          importantFields: fullResult.importantFields,
          schema: fullResult.schema,
          metrics: fullResult.metrics,
          records: fullResult.records.map((record) => ({
            id: record.id,
            identifierBefore: record.identifierBefore,
            identifierAfter: record.identifierAfter,
            matchedBy: record.matchedBy,
            type: record.type,
            changes: record.changes,
            significance: record.significance,
          })),
        },
      };
    }
    workerScope.postMessage(response);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Background data processing failed.",
    });
  }
});
