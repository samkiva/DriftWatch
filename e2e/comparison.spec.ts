import { expect, test } from "@playwright/test";

test("uploads CSVs, selects an identifier, and explores the resulting changes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New comparison/ }).first().click();
  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: "baseline.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,name,value\n1,Ada,10\n2,Lin,20"),
  });
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "newer.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,name,value\n1,Ada,11\n3,Sam,30"),
  });
  await expect(page.getByRole("button", { name: /Data quality profile/ })).toBeVisible();
  await page.getByRole("button", { name: /Data quality profile/ }).click();
  await expect(page.getByText("Baseline SHA-256")).toBeVisible();
  await expect(page.getByText("DIFFERENT CONTENT")).toBeVisible();
  await page.getByRole("button", { name: /Data quality profile/ }).click();
  await expect(page.getByLabel("Unique record identifier").locator('option[value="id"]')).toBeAttached();
  await page.getByLabel("Unique record identifier").selectOption("id");
  await page.getByRole("checkbox", { name: /I reviewed these counts/ }).check();
  await page.getByLabel("Importance for value").selectOption("high");
  await page.getByRole("button", { name: "Compare datasets" }).click();
  await expect(page.getByRole("heading", { name: "Change, made clear." })).toBeVisible();
  await expect(page.getByText("user-designated important field changes")).toBeVisible();
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Difference explorer/ }).click();
  await expect(page.getByText("Showing 3 of 3 records")).toBeVisible();
  await page.getByPlaceholder(/Search/).fill("Ada");
  await expect(page.getByText("Showing 1 of 3 records")).toBeVisible();
});

test("fingerprints recognize identical parsed data independently of file names", async ({ page }) => {
  const contents = Buffer.from("id,value\n1,alpha\n2,beta");
  await page.goto("/");
  await page.getByRole("button", { name: /New comparison/ }).first().click();
  await page.locator('input[type="file"]').nth(0).setInputFiles({ name: "original.csv", mimeType: "text/csv", buffer: contents });
  await page.locator('input[type="file"]').nth(1).setInputFiles({ name: "renamed-copy.csv", mimeType: "text/csv", buffer: contents });
  await expect(page.getByRole("status")).toContainText(/identical data.*fingerprints match/i);
});

test("benchmarks main-thread processing against workers on 10k-row datasets", async ({ page }) => {
  await page.goto("/");
  const benchmark = await page.evaluate(async () => {
    const [{ parseCsv }, { profileDataset }, { fingerprintDataset }, { compareDatasets, rankIdentifierCandidates }, { parseCsvInWorker, compareDatasetsInWorker, rankIdentifierCandidatesInWorker }] = await Promise.all([
      import("/src/core/csv.ts"),
      import("/src/core/profile.ts"),
      import("/src/core/fingerprint.ts"),
      import("/src/core/compare.ts"),
      import("/src/core/worker-client.ts"),
    ]);
    const rowCount = 10_000;
    const makeCsv = (valueOffset: number) => [
      "id,amount,status,email",
      ...Array.from({ length: rowCount }, (_, index) =>
        `${index + 1},${index + valueOffset},${index % 2 ? "active" : "inactive"},person${index}@example.test`),
    ].join("\n");
    const beforeText = makeCsv(0);
    const afterText = makeCsv(1);

    let syncTimerAt = 0;
    const syncTimer = new Promise<void>((resolve) => setTimeout(() => { syncTimerAt = performance.now(); resolve(); }, 0));
    const syncStart = performance.now();
    const baseline = parseCsv(beforeText, "baseline.csv");
    const newer = parseCsv(afterText, "newer.csv");
    profileDataset(baseline);
    profileDataset(newer);
    const [baselineFingerprint, newerFingerprint] = await Promise.all([
      fingerprintDataset(baseline),
      fingerprintDataset(newer),
    ]);
    let syncAnalysisTimerAt = 0;
    const syncAnalysisTimer = new Promise<void>((resolve) => setTimeout(() => { syncAnalysisTimerAt = performance.now(); resolve(); }, 0));
    const syncAnalysisStart = performance.now();
    rankIdentifierCandidates(baseline, newer);
    const syncResult = compareDatasets(baseline, newer, "id");
    const synchronousAnalysisBlockMs = performance.now() - syncAnalysisStart;
    const synchronousMs = performance.now() - syncStart;
    await syncTimer;
    await syncAnalysisTimer;
    const synchronousTimerDelayMs = Math.max(syncTimerAt - syncStart, syncAnalysisTimerAt - syncAnalysisStart);

    let workerTimerAt = 0;
    const workerTimer = new Promise<void>((resolve) => setTimeout(() => { workerTimerAt = performance.now(); resolve(); }, 0));
    const workerStart = performance.now();
    const [workerBaseline, workerNewer] = await Promise.all([
      parseCsvInWorker(beforeText, "baseline.csv"),
      parseCsvInWorker(afterText, "newer.csv"),
    ]);
    let workerAnalysisTimerAt = 0;
    const workerAnalysisTimer = new Promise<void>((resolve) => setTimeout(() => { workerAnalysisTimerAt = performance.now(); resolve(); }, 0));
    const workerAnalysisStart = performance.now();
    await rankIdentifierCandidatesInWorker(workerBaseline, workerNewer);
    const workerResult = await compareDatasetsInWorker(workerBaseline, workerNewer, "id", {});
    const workerAnalysisBlockMs = performance.now() - workerAnalysisStart;
    const workerMs = performance.now() - workerStart;
    await workerTimer;
    await workerAnalysisTimer;
    const workerTimerDelayMs = Math.max(workerTimerAt - workerStart, workerAnalysisTimerAt - workerAnalysisStart);

    return {
      rowsPerDataset: rowCount,
      synchronousMs: Number(synchronousMs.toFixed(1)),
      workerMs: Number(workerMs.toFixed(1)),
      synchronousAnalysisBlockMs: Number(synchronousAnalysisBlockMs.toFixed(1)),
      workerAnalysisWallMs: Number(workerAnalysisBlockMs.toFixed(1)),
      synchronousTimerDelayMs: Number(synchronousTimerDelayMs.toFixed(1)),
      workerTimerDelayMs: Number(workerTimerDelayMs.toFixed(1)),
      syncModified: syncResult.metrics.modified,
      workerModified: workerResult.metrics.modified,
      sameBaselineFingerprint: baselineFingerprint === workerBaseline.fingerprint,
      sameNewerFingerprint: newerFingerprint === workerNewer.fingerprint,
    };
  });
  console.log(`PROCESSING_BENCHMARK ${JSON.stringify(benchmark)}`);
  expect(benchmark.syncModified).toBe(10_000);
  expect(benchmark.workerModified).toBe(benchmark.syncModified);
  expect(benchmark.sameBaselineFingerprint).toBe(true);
  expect(benchmark.sameNewerFingerprint).toBe(true);
  expect(benchmark.workerTimerDelayMs).toBeLessThan(benchmark.synchronousTimerDelayMs);
});

test("benchmarks comparison responsiveness at 1k, 10k, 50k, and 100k rows", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const benchmarks = await page.evaluate(async () => {
    const [{ parseCsv }, { compareDatasets }, { compareDatasetsInWorker }] = await Promise.all([
      import("/src/core/csv.ts"),
      import("/src/core/compare.ts"),
      import("/src/core/worker-client.ts"),
    ]);
    const memoryUsage = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    async function runSize(rowCount: number) {
      const makeCsv = (offset: number) => [
        "id,amount,status",
        ...Array.from({ length: rowCount }, (_, index) =>
          `${index + 1},${index + offset},${index % 2 ? "active" : "inactive"}`),
      ].join("\n");
      const beforeText = makeCsv(0);
      const afterText = makeCsv(1);
      const inputBytes = new Blob([beforeText, afterText]).size;
      const baseline = parseCsv(beforeText);
      const newer = parseCsv(afterText);
      const heapBefore = memoryUsage();

      let syncTimerAt = 0;
      const syncTimer = new Promise<void>((resolve) => setTimeout(() => { syncTimerAt = performance.now(); resolve(); }, 0));
      const syncStart = performance.now();
      const syncResult = compareDatasets(baseline, newer, "id");
      const synchronousMs = performance.now() - syncStart;
      await syncTimer;
      const synchronousTimerDelayMs = Math.max(0, syncTimerAt - syncStart);

      let workerTimerAt = 0;
      const workerTimer = new Promise<void>((resolve) => setTimeout(() => { workerTimerAt = performance.now(); resolve(); }, 0));
      const workerStart = performance.now();
      const workerResult = await compareDatasetsInWorker(baseline, newer, "id", {});
      const workerMs = performance.now() - workerStart;
      await workerTimer;
      const workerTimerDelayMs = Math.max(0, workerTimerAt - workerStart);
      const heapAfter = memoryUsage();
      return {
        rowsPerDataset: rowCount,
        inputBytes,
        synchronousMs: Number(synchronousMs.toFixed(1)),
        workerMs: Number(workerMs.toFixed(1)),
        synchronousTimerDelayMs: Number(synchronousTimerDelayMs.toFixed(1)),
        workerTimerDelayMs: Number(workerTimerDelayMs.toFixed(1)),
        heapBeforeBytes: heapBefore,
        heapAfterBytes: heapAfter,
        heapDeltaBytes: heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
        syncModified: syncResult.metrics.modified,
        workerModified: workerResult.metrics.modified,
      };
    }
    const results = [];
    for (const rowCount of [1_000, 10_000, 50_000, 100_000]) results.push(await runSize(rowCount));
    return results;
  });
  console.log(`SCALING_BENCHMARK ${JSON.stringify(benchmarks)}`);
  expect(benchmarks.map(({ rowsPerDataset }) => rowsPerDataset)).toEqual([1_000, 10_000, 50_000, 100_000]);
  for (const benchmark of benchmarks) {
    expect(benchmark.syncModified).toBe(benchmark.rowsPerDataset);
    expect(benchmark.workerModified).toBe(benchmark.syncModified);
  }
});

test("benchmarks a near-limit CSV upload through worker parsing, profiling, and fingerprinting", async ({ page }) => {
  test.skip(!process.env.RUN_LIMIT_BENCHMARK, "Opt-in benchmark; requires substantial browser memory.");
  test.setTimeout(180_000);
  await page.goto("/");
  const benchmark = await page.evaluate(async () => {
    const { parseFileInWorker } = await import("/src/core/worker-client.ts");
    const payloadBytes = 120_000_000;
    const file = new File([`payload\n${"x".repeat(payloadBytes)}`], "near-limit.csv", { type: "text/csv" });
    const heapBefore = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const start = performance.now();
    const dataset = await parseFileInWorker(file);
    const elapsedMs = performance.now() - start;
    const heapAfter = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    return {
      fileBytes: file.size,
      rows: dataset.rows.length,
      fingerprintLength: dataset.fingerprint.length,
      elapsedMs: Number(elapsedMs.toFixed(1)),
      heapBeforeBytes: heapBefore,
      heapAfterBytes: heapAfter,
      heapDeltaBytes: heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
    };
  });
  console.log(`NEAR_LIMIT_BENCHMARK ${JSON.stringify(benchmark)}`);
  expect(benchmark.fileBytes).toBeGreaterThan(100_000_000);
  expect(benchmark.rows).toBe(1);
  expect(benchmark.fingerprintLength).toBe(64);
});

test("does not default to Index and warns before an explicit positional-key comparison", async ({ page }) => {
  const baseline = [
    "Index,Customer Id,Name",
    ...Array.from({ length: 100 }, (_, index) => `${index + 1},OLD-${index + 1},Baseline ${index + 1}`),
  ].join("\n");
  const newer = [
    "Index,Customer Id,Name",
    ...Array.from({ length: 1000 }, (_, index) => `${index + 1},NEW-${index + 1},New ${index + 1}`),
  ].join("\n");
  await page.goto("/");
  await page.getByRole("button", { name: /New comparison/ }).first().click();
  await page.locator('input[type="file"]').nth(0).setInputFiles({ name: "old.csv", mimeType: "text/csv", buffer: Buffer.from(baseline) });
  await page.locator('input[type="file"]').nth(1).setInputFiles({ name: "new.csv", mimeType: "text/csv", buffer: Buffer.from(newer) });

  const keySelect = page.getByLabel("Unique record identifier");
  await expect(keySelect).toHaveValue("");
  await expect(keySelect.locator('option[value="Customer Id"]')).toBeAttached();
  await expect(keySelect.locator("option").nth(1)).toContainText("Customer Id");
  await expect(page.getByRole("button", { name: "Compare datasets" })).toBeDisabled();

  await keySelect.selectOption("Index");
  await expect(page.getByRole("alert")).toContainText(/positional matches/i);
  await expect(page.getByText("100 / 100")).toBeVisible();
  await page.getByRole("checkbox", { name: /I reviewed these counts/ }).check();
  await page.getByRole("button", { name: "Compare datasets" }).click();
  await expect(page.getByText("900", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/positional matches/i).last()).toBeVisible();
});

test("reconciles changed primary identifiers with a confirmed secondary key and exports the change", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: /New comparison/ }).first().click();
  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: "before.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("customer_id,account_ref,name,value\nOLD-1,ACCOUNT-1,Ada,10"),
  });
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "after.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("customer_id,account_ref,name,value\nNEW-1,ACCOUNT-1,Ada,10"),
  });
  await page.getByRole("button", { name: /Data quality profile/ }).click();
  await expect(page.getByText("Baseline SHA-256")).toBeVisible();
  await page.getByRole("button", { name: /Data quality profile/ }).click();
  await page.getByLabel("Unique record identifier").selectOption("customer_id");
  await page.getByRole("checkbox", { name: /I reviewed these counts/ }).check();
  await page.getByLabel("Secondary stable identifier").selectOption("account_ref");
  await expect(page.getByText(/baseline 1\/1 unique.*newer 1\/1 unique/i)).toBeVisible();
  await page.getByRole("checkbox", { name: /I confirm account_ref/ }).check();
  await page.getByRole("button", { name: "Compare datasets" }).click();
  await expect(page.getByText(/1 primary identifier change was linked/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Change significance & movement" })).toBeVisible();
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Difference explorer/ }).click();
  await expect(page.getByText("customer_id", { exact: true }).first()).toBeVisible();
  await page.locator(".difference-table tbody tr").first().click();
  await expect(page.getByText(/Identifier changed from OLD-1 to NEW-1; linked by secondary/)).toBeVisible();
  await expect(page.locator(".detail-drawer .significance-critical").first()).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  await page.locator(".result-tabs button").first().click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".export-menu summary").click();
  await page.getByRole("button", { name: "Detailed differences CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-details\.csv$/);
});

test("terminates a worker when posting an upload request fails", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    let terminated = 0;
    class FailingWorker extends NativeWorker {
      postMessage() {
        throw new Error("Synthetic postMessage failure");
      }
      terminate() {
        terminated += 1;
        super.terminate();
      }
    }
    window.Worker = FailingWorker;
    Object.defineProperty(window, "__workerTerminations", { get: () => terminated });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /New comparison/ }).first().click();
  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: "worker-failure.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,value\n1,a"),
  });
  await expect(page.getByRole("alert")).toContainText("Synthetic postMessage failure");
  await expect.poll(() => page.evaluate(() => (window as Window & { __workerTerminations?: number }).__workerTerminations)).toBe(1);
});

test("requires explicit confirmation before applying old-to-new identifier mappings", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New comparison/ }).first().click();
  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: "before.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,name\nOLD,Ada"),
  });
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "after.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,name\nNEW,Ada"),
  });
  await page.getByLabel("Unique record identifier").selectOption("id");
  await page.getByRole("checkbox", { name: /I reviewed these counts/ }).check();
  await page.getByRole("button", { name: "Add mapping" }).click();
  await page.getByLabel("Old identifier mapping 1").fill("OLD");
  await page.getByLabel("New identifier mapping 1").fill("NEW");
  await expect(page.getByRole("button", { name: "Compare datasets" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /I reviewed these old-to-new mappings/ }).check();
  await page.getByRole("button", { name: "Compare datasets" }).click();
  await expect(page.getByText(/1 primary identifier change was linked/i)).toBeVisible();
  await expect(page.locator(".significance-critical").first()).toBeVisible();
});
