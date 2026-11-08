import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity, ArrowDown, ArrowDownToLine, ArrowLeftRight, ArrowRight, BarChart3, Check,
  ChevronDown, CircleHelp, Columns3, Database, FileCheck2, FileSpreadsheet,
  FolderOpen, Gauge, Info, LayoutDashboard, LockKeyhole, Menu, Plus, Search, Settings2,
  ShieldCheck, Sparkles, Upload, X,
} from "lucide-react";
import {
  generateInsights,
  type ChangeSignificance, type ComparisonResult, type IdentifierCandidate,
  type RecordChange,
} from "./core/compare";
import { readCsvFile, type Dataset } from "./core/csv";
import type { ColumnProfile, DatasetProfile } from "./core/profile";
import { compareDatasetsInWorker, rankIdentifierCandidatesInWorker } from "./core/worker-client";
import { exportDifferencesCsv, exportHtmlReport, exportSummaryCsv } from "./core/export";

const ChangeChart = lazy(() => import("./components/ChangeChart"));

type Screen = "dashboard" | "new" | "results" | "explorer" | "settings";
type FileSlot = "baseline" | "newer";

const navItems: Array<{ id: Screen; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "new", label: "New comparison", icon: Plus },
  { id: "results", label: "Results", icon: BarChart3 },
];

const changeColors: Record<string, string> = {
  added: "var(--green)", deleted: "var(--red)", modified: "var(--amber)", unchanged: "var(--muted)",
};

function formatNumber(number: number): string {
  return new Intl.NumberFormat("en-US").format(number);
}

function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [baseline, setBaseline] = useState<Dataset | null>(null);
  const [newer, setNewer] = useState<Dataset | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [identifierConfirmed, setIdentifierConfirmed] = useState(false);
  const [secondaryIdentifier, setSecondaryIdentifier] = useState("");
  const [secondaryConfirmed, setSecondaryConfirmed] = useState(false);
  const [identifierMappings, setIdentifierMappings] = useState<Array<{ before: string; after: string }>>([]);
  const [mappingsConfirmed, setMappingsConfirmed] = useState(false);
  const [fieldSignificance, setFieldSignificance] = useState<Record<string, ChangeSignificance>>({});
  const [identifierCandidates, setIdentifierCandidates] = useState<IdentifierCandidate[]>([]);
  const [analyzingIdentifiers, setAnalyzingIdentifiers] = useState(false);
  const [processingFiles, setProcessingFiles] = useState<FileSlot[]>([]);
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [compareError, setCompareError] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  const commonColumns = useMemo(
    () => baseline && newer ? baseline.headers.filter((header) => newer.headers.includes(header)) : [],
    [baseline, newer],
  );
  const currentScreen = result && (screen === "results" || screen === "explorer");

  useEffect(() => {
    if (!baseline || !newer) {
      setIdentifierCandidates([]);
      setAnalyzingIdentifiers(false);
      return;
    }
    let active = true;
    setIdentifierCandidates([]);
    setAnalyzingIdentifiers(true);
    rankIdentifierCandidatesInWorker(baseline, newer)
      .then((candidates) => {
        if (active) setIdentifierCandidates(candidates);
      })
      .catch((error: unknown) => {
        if (active) setCompareError(error instanceof Error ? error.message : "Could not analyze identifier candidates.");
      })
      .finally(() => {
        if (active) setAnalyzingIdentifiers(false);
      });
    return () => { active = false; };
  }, [baseline, newer]);

  async function addFile(slot: FileSlot, file: File) {
    setProcessingFiles((current) => [...current.filter((item) => item !== slot), slot]);
    try {
      const dataset = await readCsvFile(file);
      if (slot === "baseline") setBaseline(dataset);
      else setNewer(dataset);
      setCompareError("");
      setResult(null);
      setIdentifierConfirmed(false);
      setSecondaryIdentifier("");
      setSecondaryConfirmed(false);
      setIdentifierMappings([]);
      setMappingsConfirmed(false);
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : "The file could not be read.");
    } finally {
      setProcessingFiles((current) => current.filter((item) => item !== slot));
    }
  }

  async function runComparison() {
    if (!baseline || !newer || !identifier) return;
    setComparing(true);
    try {
      const comparison = await compareDatasetsInWorker(
        baseline,
        newer,
        identifier,
        {
          criticalFields: Object.keys(fieldSignificance).filter((column) => fieldSignificance[column] === "critical"),
          importantFields: Object.keys(fieldSignificance).filter((column) => fieldSignificance[column] === "high"),
          ...(secondaryIdentifier ? { secondaryIdentifier } : {}),
          ...(identifierMappings.length ? { identifierMappings } : {}),
        },
      );
      setResult(comparison);
      setCompareError("");
      setScreen("results");
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : "Comparison failed.");
    } finally {
      setComparing(false);
    }
  }

  function beginNew() {
    setBaseline(null);
    setNewer(null);
    setIdentifier("");
    setIdentifierConfirmed(false);
    setSecondaryIdentifier("");
    setSecondaryConfirmed(false);
    setIdentifierMappings([]);
    setMappingsConfirmed(false);
    setFieldSignificance({});
    setResult(null);
    setCompareError("");
    setScreen("new");
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setScreen("dashboard"); }}>
          <span className="brand-mark"><Activity size={19} strokeWidth={2.5} /></span>
          <span>drift<span className="brand-light">watch</span></span>
          <span className="brand-version">BETA</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switch"><span className="workspace-avatar">P</span><span>Personal workspace</span><ChevronDown size={14} /></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${screen === id || (id === "results" && screen === "explorer") ? "active" : ""}`} onClick={() => { setScreen(id); setMobileNav(false); }}>
              <Icon size={17} /><span>{label}</span>
              {id === "results" && result && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        {result && (
          <div className="sidebar-recent">
            <div className="nav-label">LATEST COMPARISON</div>
            <button className={`recent-link ${screen === "explorer" ? "active" : ""}`} onClick={() => { setScreen("explorer"); setMobileNav(false); }}>
              <FileCheck2 size={16} /><span>{result.baseline.name.replace(/\.csv$/i, "")}</span>
            </button>
          </div>
        )}
        <div className="sidebar-bottom">
          <div className="privacy-card"><span className="privacy-icon"><LockKeyhole size={15} /></span><div><strong>Your data stays yours</strong><p>Files are processed locally in your browser.</p></div></div>
          <button className={`nav-item ${screen === "settings" ? "active" : ""}`} onClick={() => { setScreen("settings"); setMobileNav(false); }}><Settings2 size={17} /><span>Settings & about</span></button>
          <div className="profile"><div className="profile-avatar">V</div><div className="profile-name"><strong>Local session</strong><span>Personal workspace</span></div><ChevronDown size={15} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobileNav((open) => !open)}><Menu size={19} /></button>
          <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-sep">/</span><strong>{screen === "new" ? "New comparison" : screen === "results" ? "Comparison results" : screen === "explorer" ? "Difference explorer" : screen === "settings" ? "Settings" : "Overview"}</strong></div>
          <div className="topbar-right"><span className="local-badge"><span /> LOCAL & PRIVATE</span><button className="icon-button help-button" aria-label="About DriftWatch" onClick={() => setScreen("settings")}><CircleHelp size={17} /></button></div>
        </header>

        <div className="page-content">
          {screen === "dashboard" && <Dashboard result={result} onNew={beginNew} onOpen={(next) => setScreen(next)} />}
          {screen === "new" && (
            <NewComparison
              baseline={baseline}
              newer={newer}
              identifier={identifier}
              commonColumns={commonColumns}
              identifierCandidates={identifierCandidates}
              analyzingIdentifiers={analyzingIdentifiers}
              identifierConfirmed={identifierConfirmed}
              secondaryIdentifier={secondaryIdentifier}
              secondaryConfirmed={secondaryConfirmed}
              identifierMappings={identifierMappings}
              mappingsConfirmed={mappingsConfirmed}
              fieldSignificance={fieldSignificance}
              processingFiles={processingFiles}
              comparing={comparing}
              error={compareError}
              onFile={addFile}
              onIdentifier={(value) => {
                setIdentifier(value);
                setIdentifierConfirmed(false);
                setSecondaryIdentifier("");
                setSecondaryConfirmed(false);
                setIdentifierMappings([]);
                setMappingsConfirmed(false);
              }}
              onConfirmIdentifier={setIdentifierConfirmed}
              onSecondaryIdentifier={(value) => { setSecondaryIdentifier(value); setSecondaryConfirmed(false); }}
              onConfirmSecondary={setSecondaryConfirmed}
              onIdentifierMappings={(mappings) => { setIdentifierMappings(mappings); setMappingsConfirmed(false); }}
              onConfirmMappings={setMappingsConfirmed}
              onFieldSignificance={(column, significance) => setFieldSignificance((current) => ({
                ...current,
                [column]: significance,
              }))}
              onCompare={runComparison}
            />
          )}
          {currentScreen && result && (
            <Results result={result} screen={screen} onScreen={setScreen} />
          )}
          {screen === "settings" && <Settings />}
        </div>
      </main>
      {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    </div>
  );
}

function Dashboard({ result, onNew, onOpen }: { result: ComparisonResult | null; onNew: () => void; onOpen: (screen: Screen) => void }) {
  return (
    <>
      <section className="welcome-row">
        <div><div className="eyebrow"><span className="eyebrow-line" /> DATA CHANGE INTELLIGENCE</div><h1>See what changed.<br /><span>Understand why it matters.</span></h1><p className="welcome-copy">Compare two snapshots of your data. Find the signal in every row — without sending a single byte anywhere.</p></div>
        <div className="welcome-art" aria-hidden="true"><div className="art-ring ring-one" /><div className="art-ring ring-two" /><div className="art-ring ring-three" /><div className="art-center"><Activity size={32} /></div><span className="art-node node-a" /><span className="art-node node-b" /><span className="art-node node-c" /><span className="art-node node-d" /></div>
      </section>
      <section className="action-card">
        <div className="action-icon"><ArrowLeftRight size={20} /></div>
        <div className="action-copy"><h2>Start with two snapshots</h2><p>Drop in a baseline and a newer CSV. DriftWatch handles the rest.</p></div>
        <button className="button button-primary" onClick={onNew}>New comparison <ArrowRight size={16} /></button>
      </section>
      <div className="section-heading"><div><h2>{result ? "Your latest comparison" : "A clearer picture of your data"}</h2><p>{result ? "Pick up where you left off." : "Everything you need to understand dataset drift."}</p></div>{result && <button className="text-button" onClick={() => onOpen("results")}>View results <ArrowRight size={15} /></button>}</div>
      {result ? (
        <div className="latest-card">
          <div className="latest-head"><span className="file-icon"><FileSpreadsheet size={18} /></span><div><strong>{result.baseline.name} <span className="muted">→</span> {result.newer.name}</strong><small>Just now · compared by {result.identifier}</small></div><span className="complete-chip"><Check size={13} /> Complete</span></div>
          <div className="latest-stats">{[["Added", result.metrics.added, "green"], ["Deleted", result.metrics.deleted, "red"], ["Modified", result.metrics.modified, "amber"], ["Unchanged", result.metrics.unchanged, "neutral"]].map(([label, value, color]) => <div key={String(label)}><span className={`stat-dot ${color}`} />{label}<strong>{formatNumber(Number(value))}</strong></div>)}</div>
        </div>
      ) : (
        <div className="feature-grid">
          <Feature icon={<Gauge size={17} />} number="01" title="Know the scale" text="A crisp overview of added, removed and changed records." />
          <Feature icon={<Columns3 size={17} />} number="02" title="Follow the details" text="Trace every field-level change back to its record." />
          <Feature icon={<ShieldCheck size={17} />} number="03" title="Keep it private" text="Your files never leave this browser tab." />
        </div>
      )}
      <div className="footnote"><LockKeyhole size={13} /><span>Private by design</span><span className="footnote-divider">·</span><span>No accounts, uploads or API keys required</span></div>
    </>
  );
}

function Feature({ icon, number, title, text }: { icon: ReactNode; number: string; title: string; text: string }) {
  return <article className="feature-card"><div className="feature-top"><span className="feature-icon">{icon}</span><span>{number}</span></div><h3>{title}</h3><p>{text}</p></article>;
}

function UploadCard({ slot, title, subtitle, dataset, loading, onFile }: { slot: FileSlot; title: string; subtitle: string; dataset: Dataset | null; loading: boolean; onFile: (slot: FileSlot, file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div className={`upload-card ${dataset ? "upload-complete" : ""}`}>
      <div className="upload-title-row"><div className={`slot-number ${dataset ? "slot-done" : ""}`}>{dataset ? <Check size={14} /> : slot === "baseline" ? "01" : "02"}</div><div><h3>{title}</h3><p>{subtitle}</p></div></div>
      {dataset ? (
        <div className="file-loaded"><span className="loaded-icon"><FileSpreadsheet size={19} /></span><div className="loaded-info"><strong title={dataset.name}>{dataset.name}</strong><span>{formatNumber(dataset.rows.length)} rows <i /> {dataset.headers.length} columns <i /> {Object.values(dataset.types).filter((type) => type === "number").length} numeric</span></div><button className="icon-button file-replace" title="Replace file" disabled={loading} onClick={() => inputRef.current?.click()}><Upload size={15} /></button></div>
      ) : (
        <button className={`drop-zone ${dragging ? "drag-active" : ""}`} disabled={loading} onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) onFile(slot, file); }}>
          <span className="upload-icon">{loading ? <Activity size={19} className="processing-spin" /> : <Upload size={19} />}</span><span className="drop-copy"><strong>{loading ? "Processing locally…" : <>Drop your CSV here, or <em>browse</em></>}</strong><small>{loading ? "Profiling and fingerprinting in a background worker" : "CSV files only · up to 150 MB"}</small></span><ArrowDown size={15} className="drop-arrow" />
        </button>
      )}
      <input ref={inputRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(slot, file); event.currentTarget.value = ""; }} />
      {dataset && <div className="type-list">{dataset.headers.slice(0, 5).map((header) => <span key={header}>{header}<small>{dataset.types[header]}</small></span>)}{dataset.headers.length > 5 && <span className="more-types">+{dataset.headers.length - 5} more</span>}</div>}
      {dataset?.fingerprint && <div className="fingerprint-value" title={dataset.fingerprint}>SHA-256 · {dataset.fingerprint.slice(0, 16)}…</div>}
    </div>
  );
}

function DataQualitySection({ baseline, newer }: { baseline: DatasetProfile; newer: DatasetProfile }) {
  const [expanded, setExpanded] = useState(false);
  const columns = [...new Set([...baseline.columnProfiles.map((item) => item.column), ...newer.columnProfiles.map((item) => item.column)])];
  const findings = columns.map((column) => ({
    column,
    before: baseline.columnProfiles.find((item) => item.column === column),
    after: newer.columnProfiles.find((item) => item.column === column),
  })).filter(({ before, after }) => [before, after].some((profile) => profile && (
    profile.missing || profile.duplicateValues || profile.invalidEmails || profile.numericOutliers
    || profile.dateFormats.length > 1 || profile.categoryVariants.length
  )));
  const issues = findings.reduce((sum, item) => sum + [item.before, item.after].filter(Boolean).reduce((count, profile) =>
    count + (profile?.missing ?? 0) + (profile?.duplicateValues ?? 0) + (profile?.invalidEmails ?? 0)
    + (profile?.numericOutliers ?? 0) + (profile?.categoryVariants.length ?? 0)
    + (profile && profile.dateFormats.length > 1 ? 1 : 0), 0), 0);

  return (
    <section className="panel quality-panel">
      <button className="quality-header" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
        <div><span className="quality-icon"><ShieldCheck size={17} /></span><span><strong>Data quality profile</strong><small>Before comparison · deterministic checks on both datasets</small></span></div>
        <span className="quality-summary">{formatNumber(baseline.missingCells + newer.missingCells)} missing cells · {formatNumber(baseline.duplicateRows + newer.duplicateRows)} duplicate rows · {formatNumber(issues)} column findings</span>
        <ChevronDown size={16} className={expanded ? "rotate-chevron" : ""} />
      </button>
      {expanded && <div className="quality-body">
        <div className="fingerprint-comparison"><div><small>Baseline SHA-256</small><code title={baseline.fingerprint}>{baseline.fingerprint.slice(0, 20)}…</code></div><div><small>Newer SHA-256</small><code title={newer.fingerprint}>{newer.fingerprint.slice(0, 20)}…</code></div><span className={baseline.fingerprint === newer.fingerprint ? "fingerprint-same" : "fingerprint-different"}>{baseline.fingerprint === newer.fingerprint ? "IDENTICAL CONTENT" : "DIFFERENT CONTENT"}</span></div>
        <div className="quality-table-scroll"><table className="quality-table"><thead><tr><th>Column</th><th>Dataset</th><th>Missing</th><th>Unique / duplicates</th><th>Quality findings</th></tr></thead><tbody>
          {columns.flatMap((column) => [
            { label: "Baseline", profile: baseline.columnProfiles.find((item) => item.column === column) },
            { label: "Newer", profile: newer.columnProfiles.find((item) => item.column === column) },
          ].map(({ label, profile }) => profile && <tr key={`${column}-${label}`}><td>{column}</td><td>{label}</td><td>{profile.missing} ({profile.missingPercent.toFixed(1)}%)</td><td>{profile.unique} / {profile.duplicateValues}</td><td><QualityFindings profile={profile} /></td></tr>))}
        </tbody></table></div>
        {!findings.length && <p className="quality-clean"><Check size={14} /> No missing cells, duplicate values/rows, invalid email candidates, date-format variation, numeric outliers, or low-cardinality category variants were detected.</p>}
        <p className="quality-method">Checks are heuristics: numeric outliers use the 1.5× IQR rule (at least four numeric values); email checks use a basic syntax pattern; date and category variation depend on recognizable formats and normalized casing/spacing.</p>
      </div>}
    </section>
  );
}

function QualityFindings({ profile }: { profile: ColumnProfile }) {
  const labels = [
    profile.invalidEmails ? `${profile.invalidEmails} invalid email` : "",
    profile.dateFormats.length > 1 ? `mixed dates: ${profile.dateFormats.join(", ")}` : "",
    profile.numericOutliers ? `${profile.numericOutliers} numeric outlier` : "",
    ...profile.categoryVariants.slice(0, 2).map((variant) => `category variants: ${variant.values.join(" / ")}`),
    profile.categoryVariants.length > 2 ? `+${profile.categoryVariants.length - 2} variants` : "",
  ].filter(Boolean);
  return labels.length ? <span className="quality-finding">{labels.join(" · ")}</span> : <span className="quality-none">—</span>;
}

function NewComparison({ baseline, newer, identifier, commonColumns, identifierCandidates, analyzingIdentifiers, identifierConfirmed, secondaryIdentifier, secondaryConfirmed, identifierMappings, mappingsConfirmed, fieldSignificance, processingFiles, comparing, error, onFile, onIdentifier, onConfirmIdentifier, onSecondaryIdentifier, onConfirmSecondary, onIdentifierMappings, onConfirmMappings, onFieldSignificance, onCompare }: {
  baseline: Dataset | null; newer: Dataset | null; identifier: string; commonColumns: string[];
  identifierCandidates: IdentifierCandidate[]; analyzingIdentifiers: boolean; identifierConfirmed: boolean;
  secondaryIdentifier: string; secondaryConfirmed: boolean;
  identifierMappings: Array<{ before: string; after: string }>; mappingsConfirmed: boolean;
  fieldSignificance: Record<string, ChangeSignificance>; processingFiles: FileSlot[]; comparing: boolean;
  error: string; onFile: (slot: FileSlot, file: File) => void; onIdentifier: (id: string) => void;
  onConfirmIdentifier: (confirmed: boolean) => void;
  onSecondaryIdentifier: (id: string) => void; onConfirmSecondary: (confirmed: boolean) => void;
  onIdentifierMappings: (mappings: Array<{ before: string; after: string }>) => void;
  onConfirmMappings: (confirmed: boolean) => void;
  onFieldSignificance: (column: string, significance: ChangeSignificance) => void; onCompare: () => void;
}) {
  const selectedAnalysis = identifierCandidates.find((candidate) => candidate.identifier === identifier) ?? null;
  const validIdentifier = Boolean(selectedAnalysis
    && selectedAnalysis.baseline.missingRows === 0
    && selectedAnalysis.newer.missingRows === 0
    && selectedAnalysis.baseline.duplicateRows === 0
    && selectedAnalysis.newer.duplicateRows === 0);
  const selectedSecondaryAnalysis = identifierCandidates.find((candidate) => candidate.identifier === secondaryIdentifier) ?? null;
  const validSecondary = Boolean(selectedSecondaryAnalysis
    && selectedSecondaryAnalysis.baseline.missingRows === 0
    && selectedSecondaryAnalysis.newer.missingRows === 0
    && selectedSecondaryAnalysis.baseline.duplicateRows === 0
    && selectedSecondaryAnalysis.newer.duplicateRows === 0);
  const completeMappings = identifierMappings.every((mapping) => mapping.before.trim() && mapping.after.trim());
  const ready = Boolean(baseline && newer && validIdentifier && identifierConfirmed
    && (!secondaryIdentifier || (validSecondary && secondaryConfirmed))
    && (!identifierMappings.length || (completeMappings && mappingsConfirmed)));
  return (
    <>
      <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR NEXT INSIGHT STARTS HERE</div><h1>New comparison</h1><p>Choose two snapshots and a stable key to track each record.</p></div><div className="step-indicator"><span className="step-active">1 <small>Upload</small></span><i /><span>2 <small>Compare</small></span><i /><span>3 <small>Explore</small></span></div></div>
      <div className="upload-grid">
        <UploadCard slot="baseline" title="Baseline dataset" subtitle="Your earlier snapshot" dataset={baseline} loading={processingFiles.includes("baseline")} onFile={onFile} />
        <div className="upload-connector"><ArrowLeftRight size={17} /></div>
        <UploadCard slot="newer" title="Newer dataset" subtitle="The version you want to check" dataset={newer} loading={processingFiles.includes("newer")} onFile={onFile} />
      </div>
      {baseline && newer && baseline.fingerprint && baseline.fingerprint === newer.fingerprint && (
        <div className="identical-datasets" role="status"><Check size={15} /> These files contain identical data (SHA-256 fingerprints match), regardless of filename.</div>
      )}
      {baseline && newer && baseline.profile && newer.profile && <DataQualitySection baseline={baseline.profile} newer={newer.profile} />}
      {baseline && newer && (
        <section className="identifier-card">
          <div className="identifier-icon"><Database size={19} /></div>
          <div className="identifier-copy"><h3>Confirm how records are matched</h3><p>Choose a shared, unique key. We will not select one for you: a wrong key can pair different records and label them as modified.</p></div>
          <label className="select-wrap"><span className="visually-hidden">Unique record identifier</span><select value={commonColumns.includes(identifier) ? identifier : ""} onChange={(event) => onIdentifier(event.target.value)} aria-label="Unique record identifier"><option value="">Choose a column…</option>{identifierCandidates.map((candidate) => <option key={candidate.identifier} value={candidate.identifier}>{candidate.identifier} — {candidate.recommendation === "likely" ? "likely ID" : candidate.recommendation === "avoid" ? "looks like row index" : "verify uniqueness"}</option>)}</select><ChevronDown size={15} /></label>
          {identifier && !commonColumns.includes(identifier) && <div className="identifier-note warning"><Info size={15} /> Your selected key “{identifier}” is not present in both current files. Choose a shared key explicitly; DriftWatch will not switch it for you.</div>}
          {commonColumns.length === 0 && <div className="identifier-note"><Info size={15} /> No columns are shared by these files. Add the same stable identifier column to both datasets.</div>}
          {selectedAnalysis && (
            <div className="identifier-stats">
              <div className="identifier-stats-heading"><strong>Key check: {identifier}</strong><span>{selectedAnalysis.indexLike ? "POSITION-LIKE KEY" : validIdentifier ? "UNIQUE IN BOTH FILES" : "NOT SAFE TO MATCH"}</span></div>
              <div className="identifier-stat-grid">
                <div><small>Baseline unique</small><strong>{formatNumber(selectedAnalysis.baseline.uniqueValues)} / {formatNumber(selectedAnalysis.baseline.rows)}</strong><span>{selectedAnalysis.baseline.duplicateRows} duplicate · {selectedAnalysis.baseline.missingRows} missing</span></div>
                <div><small>Newer unique</small><strong>{formatNumber(selectedAnalysis.newer.uniqueValues)} / {formatNumber(selectedAnalysis.newer.rows)}</strong><span>{selectedAnalysis.newer.duplicateRows} duplicate · {selectedAnalysis.newer.missingRows} missing</span></div>
                <div><small>Values matched</small><strong>{formatNumber(selectedAnalysis.sharedValues)}</strong><span>{selectedAnalysis.matchedPercentBaseline.toFixed(1)}% of baseline · {selectedAnalysis.matchedPercentNewer.toFixed(1)}% of newer</span></div>
                <div><small>By this key</small><strong>+{formatNumber(selectedAnalysis.addedByKey)} / −{formatNumber(selectedAnalysis.deletedByKey)}</strong><span>Potentially added / removed records</span></div>
              </div>
              {selectedAnalysis.warnings.map((warning) => <div className="identifier-warning" role="alert" key={warning}><Info size={15} /><span>{warning}</span></div>)}
              {validIdentifier && <label className="identifier-confirm"><input type="checkbox" checked={identifierConfirmed} onChange={(event) => onConfirmIdentifier(event.target.checked)} /><span>I reviewed these counts and confirm that <strong>{identifier}</strong> identifies the same real-world record in both files.</span></label>}
              {validIdentifier && (
                <div className="reconciliation-panel">
                  <strong>Reconcile changed identifiers (optional)</strong>
                  <p>A changed primary ID is otherwise a removal plus an addition. Choose a stable secondary key to link exact matches, or explicitly map old IDs to new IDs. Linked ID changes are Critical. Never use a field that can identify different entities over time.</p>
                  <label className="reconciliation-select">Secondary stable identifier
                    <select aria-label="Secondary stable identifier" value={secondaryIdentifier} onChange={(event) => onSecondaryIdentifier(event.target.value)}>
                      <option value="">Do not match by a secondary key</option>
                      {commonColumns.filter((column) => column !== identifier).map((column) => <option key={column} value={column}>{column}</option>)}
                    </select>
                  </label>
                  {selectedSecondaryAnalysis && (
                    <>
                      <div className="identifier-note"><Info size={14} /> {secondaryIdentifier}: {selectedSecondaryAnalysis.sharedValues} shared values; baseline {selectedSecondaryAnalysis.baseline.uniqueValues}/{selectedSecondaryAnalysis.baseline.rows} unique ({selectedSecondaryAnalysis.baseline.duplicateRows} duplicates, {selectedSecondaryAnalysis.baseline.missingRows} missing); newer {selectedSecondaryAnalysis.newer.uniqueValues}/{selectedSecondaryAnalysis.newer.rows} unique ({selectedSecondaryAnalysis.newer.duplicateRows} duplicates, {selectedSecondaryAnalysis.newer.missingRows} missing).</div>
                      {selectedSecondaryAnalysis.warnings.map((warning) => <div className="identifier-warning" role="alert" key={warning}><Info size={14} /><span>{warning}</span></div>)}
                      {validSecondary
                        ? <label className="identifier-confirm"><input type="checkbox" checked={secondaryConfirmed} onChange={(event) => onConfirmSecondary(event.target.checked)} /><span>I confirm <strong>{secondaryIdentifier}</strong> is a stable identifier for the same real-world records.</span></label>
                        : <div className="identifier-warning" role="alert"><Info size={14} /><span>This secondary key must be complete and unique in both files. Use explicit mappings for records it cannot safely link.</span></div>}
                    </>
                  )}
                  <div className="mapping-heading"><span>Explicit old → new mappings</span><button type="button" className="text-button" onClick={() => onIdentifierMappings([...identifierMappings, { before: "", after: "" }])}>Add mapping</button></div>
                  {identifierMappings.map((mapping, index) => (
                    <div className="mapping-row" key={index}>
                      <input aria-label={`Old identifier mapping ${index + 1}`} value={mapping.before} placeholder="Old ID" onChange={(event) => onIdentifierMappings(identifierMappings.map((item, itemIndex) => itemIndex === index ? { ...item, before: event.target.value } : item))} />
                      <ArrowRight size={14} />
                      <input aria-label={`New identifier mapping ${index + 1}`} value={mapping.after} placeholder="New ID" onChange={(event) => onIdentifierMappings(identifierMappings.map((item, itemIndex) => itemIndex === index ? { ...item, after: event.target.value } : item))} />
                      <button type="button" aria-label={`Remove mapping ${index + 1}`} className="icon-button" onClick={() => onIdentifierMappings(identifierMappings.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
                    </div>
                  ))}
                  {identifierMappings.length > 0 && <label className="identifier-confirm"><input type="checkbox" checked={mappingsConfirmed} disabled={!completeMappings} onChange={(event) => onConfirmMappings(event.target.checked)} /><span>I reviewed these old-to-new mappings. Each must reference a unique, existing record; conflicts will stop the comparison.</span></label>}
                </div>
              )}
            </div>
          )}
          {commonColumns.length > 0 && !selectedAnalysis && <div className="identifier-note"><Info size={15} /> {analyzingIdentifiers ? "Checking candidate uniqueness and overlap in a background worker…" : "Candidates are ranked by header meaning and uniqueness only as guidance. Index-like fields are marked to avoid; review statistics and confirm the key yourself."}</div>}
        </section>
      )}
      {baseline && newer && commonColumns.length > 0 && identifierConfirmed && (
        <section className="importance-panel">
          <div className="importance-heading"><div><h3>Change significance rules</h3><p>Classifications are rule-based, not an inferred business impact. Added, deleted and schema changes remain informational.</p></div><span>OPTIONAL</span></div>
          <div className="importance-list">{commonColumns.filter((column) => column !== identifier).map((column) => (
            <label key={column}><span>{column}</span><select aria-label={`Importance for ${column}`} value={fieldSignificance[column] ?? "moderate"} onChange={(event) => onFieldSignificance(column, event.target.value as ChangeSignificance)}><option value="moderate">Moderate · ordinary field</option><option value="high">High · important business field</option><option value="critical">Critical · explicitly designated</option></select></label>
          ))}</div>
          <p className="importance-rule"><strong>Critical</strong> applies to confirmed primary-identifier changes and fields explicitly marked critical. <strong>High</strong> applies to fields you designate important. Other value edits are <strong>Moderate</strong>. Adding/removing records and schema changes are <strong>Informational</strong>.</p>
        </section>
      )}
      {error && <div className="error-banner" role="alert"><X size={16} /><span>{error}</span></div>}
      <div className="comparison-footer"><div className="privacy-reminder"><LockKeyhole size={15} /><span><strong>100% local processing</strong><small>Your files stay in this browser and are cleared when you start a new comparison.</small></span></div><button className="button button-primary" disabled={!ready || comparing || processingFiles.length > 0} onClick={onCompare}>{comparing ? <>Comparing in background… <Activity size={15} className="processing-spin" /></> : <>Compare datasets <ArrowRight size={16} /></>}</button></div>
    </>
  );
}

function Results({ result, screen, onScreen }: { result: ComparisonResult; screen: Screen; onScreen: (screen: Screen) => void }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState(result.identifier);
  const [ascending, setAscending] = useState(true);
  const [selected, setSelected] = useState<RecordChange | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);
  const filtered = useMemo(() => result.records.filter((record) => {
    const searchable = [
      record.id,
      record.type,
      ...record.changes.map((change) => change.column),
      ...Object.values(record.before ?? {}),
      ...Object.values(record.after ?? {}),
    ].join(" ").toLowerCase();
    return (filter === "all" || record.type === filter) && searchable.includes(search.toLowerCase());
  }).sort((a, b) => {
    const valueFor = (record: RecordChange) => {
      if (sortColumn === "__type") return record.type;
      if (sortColumn === "__columns") return record.changes.map((change) => change.column).join(", ");
      return record.after?.[sortColumn] ?? record.before?.[sortColumn] ?? "";
    };
    const av = valueFor(a);
    const bv = valueFor(b);
    return (ascending ? 1 : -1) * av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
  }), [result.records, filter, search, sortColumn, ascending]);
  const chartData = [
    { name: "Added", value: result.metrics.added, color: "#5bd6a1" },
    { name: "Deleted", value: result.metrics.deleted, color: "#f0787b" },
    { name: "Modified", value: result.metrics.modified, color: "#f4bb66" },
    { name: "Unchanged", value: result.metrics.unchanged, color: "#566273" },
  ];
  const insights = generateInsights(result);
  const reconciledIdentifiers = result.records.filter((record) => record.identifierBefore).length;
  const isExplorer = screen === "explorer";

  function exportWith(extension: "csv" | "html", kind: "details" | "summary" = "details") {
    const stem = `${result.baseline.name.replace(/\.csv$/i, "")}-vs-${result.newer.name.replace(/\.csv$/i, "")}`;
    if (extension === "html") downloadFile(`${stem}-report.html`, exportHtmlReport(result), "text/html;charset=utf-8");
    else downloadFile(`${stem}-${kind}.csv`, kind === "summary" ? exportSummaryCsv(result) : exportDifferencesCsv(result), "text/csv;charset=utf-8");
  }

  return (
    <>
      <div className="result-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> COMPARISON COMPLETE</div><h1>Change, made clear.</h1><p><span className="file-name-inline">{result.baseline.name}</span><ArrowRight size={13} /><span className="file-name-inline">{result.newer.name}</span><span className="heading-divider">·</span> matched by <strong>{result.identifier}</strong></p></div><div className="export-menu"><details><summary className="button button-secondary"><ArrowDownToLine size={16} /> Export <ChevronDown size={14} /></summary><div className="export-options"><button onClick={() => exportWith("csv")}>Detailed differences CSV</button><button onClick={() => exportWith("csv", "summary")}>Summary CSV</button><button onClick={() => exportWith("html")}>Self-contained HTML report</button></div></details></div></div>
      <div className="result-tabs"><button className={!isExplorer ? "tab-active" : ""} onClick={() => onScreen("results")}>Overview</button><button className={isExplorer ? "tab-active" : ""} onClick={() => onScreen("explorer")}>Difference explorer <span>{formatNumber(result.records.length)}</span></button></div>
      <section className={`result-key-check ${result.identifierAnalysis.warnings.length ? "result-key-warning" : ""}`}>
        <div><strong>Matched by {result.identifier}</strong><span>{formatNumber(result.identifierAnalysis.sharedValues)} shared values · {formatNumber(result.identifierAnalysis.baseline.uniqueValues)} baseline unique · {formatNumber(result.identifierAnalysis.newer.uniqueValues)} newer unique</span></div>
        {reconciledIdentifiers > 0 && <p><Check size={14} /> {formatNumber(reconciledIdentifiers)} primary identifier change{reconciledIdentifiers === 1 ? " was" : "s were"} linked using a confirmed secondary key or explicit mapping and classified Critical.</p>}
        {result.identifierAnalysis.warnings.length > 0
          ? result.identifierAnalysis.warnings.map((warning) => <p role="alert" key={warning}><Info size={15} />{warning}</p>)
          : <p><Check size={14} /> Key is unique and complete in both datasets.</p>}
      </section>
      {!isExplorer ? (
        <>
          <div className="metrics-grid">
            <MetricCard label="Baseline records" value={result.metrics.baselineTotal} detail={result.baseline.name} icon={<Database size={17} />} tone="neutral" />
            <MetricCard label="Newer records" value={result.metrics.newerTotal} detail={result.newer.name} icon={<Database size={17} />} tone="neutral" />
            <MetricCard label="Added" value={result.metrics.added} detail="New in this version" icon={<Plus size={17} />} tone="green" />
            <MetricCard label="Deleted" value={result.metrics.deleted} detail="No longer present" icon={<X size={17} />} tone="red" />
            <MetricCard label="Modified" value={result.metrics.modified} detail="Values changed" icon={<ArrowLeftRight size={17} />} tone="amber" />
            <MetricCard label="Unchanged" value={result.metrics.unchanged} detail="Exactly the same" icon={<Check size={17} />} tone="neutral" />
          </div>
          <div className="analysis-grid">
            <section className="panel change-panel"><div className="panel-header"><div><h2>Change overview</h2><p>Every record, accounted for</p></div><div className="affected-pill"><span /> {result.metrics.affectedPercent.toFixed(1)}% affected</div></div><div className="chart-area"><Suspense fallback={<div className="chart-loading">Preparing chart…</div>}><ChangeChart data={chartData} /></Suspense></div><div className="chart-legend">{chartData.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}<strong>{formatNumber(item.value)}</strong></span>)}</div></section>
            <section className="panel insights-panel"><div className="panel-header"><div><h2><Sparkles size={16} className="sparkle" /> What stands out</h2><p>Evidence-based observations</p></div></div><div className="insights-list">{insights.map((insight, index) => <div className="insight-item" key={insight}><span>{String(index + 1).padStart(2, "0")}</span><p>{insight}</p></div>)}</div><div className="insight-foot"><ShieldCheck size={14} /> Generated locally from comparison results</div></section>
          </div>
          <AdvancedAnalytics result={result} />
          <section className="panel schema-panel"><div className="panel-header"><div><h2>Schema changes</h2><p>Structural differences between snapshots</p></div></div><div className="schema-chips">
            {result.schema.added.map((column) => <SchemaChip key={`a${column}`} label={column} detail="Added column" tone="green" />)}
            {result.schema.removed.map((column) => <SchemaChip key={`r${column}`} label={column} detail="Removed column" tone="red" />)}
            {result.schema.renamed.map((column) => <SchemaChip key={`n${column.from}`} label={`${column.from} → ${column.to}`} detail={`Possible rename · ${Math.round(column.confidence * 100)}% value overlap`} tone="amber" />)}
            {result.schema.typeChanged.map((column) => <SchemaChip key={`t${column}`} label={column} detail={`${result.baseline.types[column]} → ${result.newer.types[column]}`} tone="amber" />)}
            {!result.schema.added.length && !result.schema.removed.length && !result.schema.typeChanged.length && <span className="schema-empty"><Check size={14} /> The column structure is consistent.</span>}
          </div></section>
          <div className="quick-explorer"><div><span className="quick-icon"><FolderOpen size={18} /></span><div><strong>Want to see exactly what changed?</strong><small>Explore every record and inspect before / after values.</small></div></div><button className="text-button" onClick={() => onScreen("explorer")}>Open explorer <ArrowRight size={15} /></button></div>
        </>
      ) : (
        <section className="panel explorer-panel">
          <div className="explorer-toolbar"><div><h2>All records <span className="count-badge">{filtered.length}</span></h2><p>Sort, search and select a record to inspect its field values.</p></div><label className="search-field"><Search size={15} /><input ref={searchRef} placeholder={`Search ${result.identifier} or columns…`} value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search record values" /><kbd>⌘ K</kbd></label></div>
          <div className="filter-row"><div className="filter-buttons">{(["all", "added", "deleted", "modified", "unchanged"] as const).map((item) => <button key={item} className={`filter-chip ${filter === item ? "filter-selected" : ""}`} onClick={() => setFilter(item)}>{item === "all" ? "All changes" : <><i style={{ background: changeColors[item] }} />{item[0].toUpperCase() + item.slice(1)}</>} {item !== "all" && <span>{formatNumber(result.metrics[item])}</span>}</button>)}</div><span className="results-count">Showing {filtered.length} of {result.records.length} records</span></div>
          <div className="table-scroll"><table className="difference-table"><thead><tr><th><button onClick={() => { setSortColumn("__type"); setAscending((value) => !value); }}>Change<ArrowDown size={12} /></button></th><th><button onClick={() => { setSortColumn(result.identifier); setAscending((value) => !value); }}>{result.identifier}<ArrowDown size={12} /></button></th><th><button onClick={() => { setSortColumn("__columns"); setAscending((value) => !value); }}>Changed columns<ArrowDown size={12} /></button></th><th>Significance</th><th>Before</th><th>After</th></tr></thead><tbody>
            {filtered.map((record) => <tr key={record.id} className={`${selected?.id === record.id ? "row-selected" : ""} row-${record.type}`} onClick={() => setSelected(record)}><td><span className={`change-badge ${record.type}`}><i />{record.type}</span></td><td className="id-cell">{record.id}</td><td className="changes-cell">{record.changes.length ? record.changes.map((change) => change.column).join(", ") : <span className="muted">—</span>}</td><td><span className={`significance-badge significance-${record.significance}`}>{record.significance}</span></td><td className="value-cell">{record.before ? Object.entries(record.before).filter(([key]) => key !== result.identifier).slice(0, 2).map(([key, value]) => <span key={key}><small>{key}:</small> {value || <em>empty</em>}</span>) : <span className="muted">—</span>}</td><td className="value-cell">{record.after ? Object.entries(record.after).filter(([key]) => key !== result.identifier).slice(0, 2).map(([key, value]) => <span key={key}><small>{key}:</small> {value || <em>empty</em>}</span>) : <span className="muted">—</span>}</td></tr>)}
            {!filtered.length && <tr><td colSpan={6} className="empty-table">{search ? "No records match your search." : "No records in this filter."}</td></tr>}
          </tbody></table></div>
          <div className="table-footer"><span>Changes are matched using <strong>{result.identifier}</strong>.</span><button onClick={() => exportWith("csv")}>Export details <ArrowDownToLine size={14} /></button></div>
          {selected && <RecordDetail record={selected} result={result} onClose={() => setSelected(null)} />}
        </section>
      )}
    </>
  );
}

function MetricCard({ label, value, detail, icon, tone }: { label: string; value: number; detail: string; icon: ReactNode; tone: string }) {
  return <div className={`metric-card metric-${tone}`}><div className="metric-card-top"><span>{label}</span><i>{icon}</i></div><strong>{formatNumber(value)}</strong><small>{detail}</small></div>;
}

function AdvancedAnalytics({ result }: { result: ComparisonResult }) {
  const { metrics } = result;
  return (
    <section className="panel advanced-panel">
      <div className="panel-header"><div><h2>Change significance & movement</h2><p>Significance follows your field rules; analytics summarize matched records only unless noted.</p></div></div>
      <div className="significance-grid">{(["critical", "high", "moderate", "informational"] as const).map((level) =>
        <div className={`significance-card significance-${level}`} key={level}><span>{level}</span><strong>{formatNumber(metrics.significanceCounts[level])}</strong><small>{level === "critical" ? "explicit critical field changes" : level === "high" ? "user-designated important field changes" : level === "moderate" ? "other matched record changes" : "added, deleted or schema events"}</small></div>,
      )}</div>
      <div className="advanced-grid">
        <div className="advanced-subpanel"><h3>Most changed columns</h3>{metrics.columnChangeFrequency.length ? <div className="analytics-list">{metrics.columnChangeFrequency.slice(0, 8).map((item) => <div key={item.column}><span>{item.column}</span><div className="frequency-track"><i style={{ width: `${Math.min(item.percentOfMatchedRecords, 100)}%` }} /></div><strong>{item.count}</strong><small>{item.percentOfMatchedRecords.toFixed(1)}%</small></div>)}</div> : <p className="analytics-empty">No changed values in matched records.</p>}</div>
        <div className="advanced-subpanel"><h3>Numeric movement</h3>{metrics.numericMovement.length ? <div className="analytics-list">{metrics.numericMovement.map((item) => <div key={item.column}><span>{item.column}</span><strong className="movement-up">+{item.increased}</strong><strong className="movement-down">−{item.decreased}</strong><small>net {item.netChange > 0 ? "+" : ""}{item.netChange.toLocaleString()}</small></div>)}</div> : <p className="analytics-empty">No shared numeric columns.</p>}</div>
      </div>
      {metrics.missingValueChanges.length > 0 && <div className="advanced-subpanel advanced-wide"><h3>Missing-value changes</h3><div className="analytics-list">{metrics.missingValueChanges.map((item) => <div key={item.column}><span>{item.column}</span><strong className="movement-down">{item.becameMissing} became missing</strong><strong className="movement-up">{item.becamePresent} became present</strong></div>)}</div></div>}
      {metrics.categoricalDistribution.length > 0 && <div className="advanced-subpanel advanced-wide"><h3>Categorical distribution changes <small>(matched records)</small></h3><div className="category-distribution">{metrics.categoricalDistribution.slice(0, 6).map((item) => <div key={item.column}><strong>{item.column}</strong><span>Before: {item.baseline.slice(0, 4).map(({ value, count }) => `${value} (${count})`).join(" · ") || "no values"}</span><span>After: {item.newer.slice(0, 4).map(({ value, count }) => `${value} (${count})`).join(" · ") || "no values"}</span></div>)}</div></div>}
      <p className="importance-rule"><strong>Rules:</strong> Critical = confirmed primary identifier change or explicitly critical field; High = user-designated important field; Moderate = other modified matched record; Informational = additions, removals and schema changes. A primary-key edit is linked only through a confirmed secondary key or explicit mapping. These labels describe configured rules, not inferred business impact.</p>
    </section>
  );
}

function SchemaChip({ label, detail, tone }: { label: string; detail: string; tone: string }) {
  return <div className={`schema-chip schema-${tone}`}><span className="schema-dot" /><span><strong>{label}</strong><small>{detail}</small></span></div>;
}

function RecordDetail({ record, result, onClose }: { record: RecordChange; result: ComparisonResult; onClose: () => void }) {
  const columns = record.type === "modified" ? record.changes.map((change) => change.column) : result.newer.headers.filter((column) => column !== result.identifier);
  return <div className="detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="detail-drawer"><div className="drawer-head"><div><span className={`change-badge ${record.type}`}><i />{record.type}</span><h2>Record <code>{record.id}</code></h2><p>{record.identifierBefore ? `Identifier changed from ${record.identifierBefore} to ${record.identifierAfter}; linked by ${record.matchedBy}.` : record.changes.length ? `${record.changes.length} field${record.changes.length === 1 ? "" : "s"} changed` : "Field values for this record"}</p><span className={`significance-badge significance-${record.significance}`}>{record.significance}</span></div><button className="icon-button" aria-label="Close details" onClick={onClose}><X size={17} /></button></div><div className="detail-columns"><span>FIELD / SIGNIFICANCE</span><span>BEFORE</span><span>AFTER</span></div><div className="detail-fields">{columns.map((column) => <div className="detail-field" key={column}><strong>{column}{record.changes.find((change) => change.column === column) && <small className={`significance-badge significance-${record.changes.find((change) => change.column === column)?.significance}`}>{record.changes.find((change) => change.column === column)?.significance}</small>}</strong><span className={record.before?.[column] !== record.after?.[column] ? "old-value" : ""}>{record.before?.[column] || <em>empty</em>}</span><span className={record.before?.[column] !== record.after?.[column] ? "new-value" : ""}>{record.after?.[column] || <em>empty</em>}</span></div>)}</div><div className="drawer-footer"><LockKeyhole size={14} /> Values remain in this browser only</div></aside></div>;
}

function Settings() {
  return (
    <>
      <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> TRANSPARENT BY DESIGN</div><h1>Settings & about</h1><p>A little context on how DriftWatch handles your data.</p></div></div>
      <section className="panel settings-panel"><div className="settings-title"><span className="settings-icon"><ShieldCheck size={19} /></span><div><h2>Privacy is the default</h2><p>DriftWatch is a client-side tool. It does not have a backend or send your CSV contents anywhere.</p></div></div><div className="settings-list"><div><LockKeyhole size={16} /><span><strong>Local processing</strong><small>CSV parsing, comparison, and report generation happen entirely in this browser.</small></span><span className="settings-state"><i /> Always on</span></div><div><Database size={16} /><span><strong>In-memory data</strong><small>Uploaded files are held only in the current page session, not stored persistently.</small></span><span className="settings-state"><i /> Session only</span></div><div><Sparkles size={16} /><span><strong>Deterministic insights</strong><small>Every observation is generated from the comparison results. No AI API or key required.</small></span><span className="settings-state"><i /> No API</span></div></div></section>
      <section className="panel about-panel"><div><h2>About DriftWatch</h2><p>CSV change intelligence for people who care about what changed — and where their data goes.</p></div><span className="about-version">VERSION 1.0.0 · MVP</span></section>
      <div className="footnote"><Info size={13} /><span>Very large files can use significant browser memory. The current file-size limit is 150 MB.</span></div>
    </>
  );
}

export default App;
