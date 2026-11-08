import type { Dataset } from "./csv";

export async function fingerprintDataset(dataset: Dataset): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser does not support secure dataset fingerprinting.");
  }
  const canonical = JSON.stringify({
    headers: dataset.headers,
    rows: dataset.rows.map((row) => dataset.headers.map((header) => row[header] ?? "")),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
