import { useState, useRef, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Progress } from "../components/ui/progress";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import {
  Upload,
  FolderOpen,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { useJobStatus } from "../lib/hooks";
import {
  streamImport,
  pollVaultImportJobUntilTerminal,
} from "../lib/api";
import { toast } from "sonner";
import { Link } from "react-router";

// ─── Types ──────────────────────────────────────────────────────────────────

type ImportState = "select" | "preview" | "uploading" | "indexing" | "complete";

type PreviewSource = "markdown" | "json";

/** Staged markdown files — bodies read only during upload batches (memory-safe). */
interface FolderRow {
  file: File;
  relPath: string;
  size: number;
  selected: boolean;
  kindGuess: string;
  titleGuess: string;
}

interface ParsedEntry {
  file: File;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  source: string;
  identity_key: string | null;
  expires_at: string | null;
  created_at: string | null;
  meta: Record<string, unknown> | undefined;
  selected: boolean;
  size: number;
}

// ─── Large-import tuning ─────────────────────────────────────────────────────

/** Stay under server `bodyLimit` (32 MiB) with JSON escaping overhead */
const FOLDER_IMPORT_MAX_BATCH_BYTES = 24 * 1024 * 1024;

/** Per-file list UI — above this, show summary + global select only */
const FOLDER_PREVIEW_LIST_CAP = 500;

// ─── Frontmatter parsing (kept from original) ──────────────────────────────

function parseFrontmatter(raw: string): {
  meta: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };

  const yamlStr = match[1];
  const body = match[2].trim();
  const meta: Record<string, unknown> = {};

  const mlArr = yamlStr.replace(
    /^(\w[\w-]*):\s*\n((?:[ \t]+-[^\n]*\n?)+)/gm,
    (_, k, block) => {
      meta[k] = block
        .match(/^[ \t]+-\s*(.+)$/gm)!
        .map((l: string) => l.replace(/^[ \t]+-\s*/, "").trim());
      return "";
    },
  );

  for (const line of mlArr.split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (!m) continue;
    const [, k, v] = m;
    if (k in meta) continue;
    if (v.startsWith("[")) {
      meta[k] = v
        .slice(1, -1)
        .split(",")
        .map((s: string) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      meta[k] = v.replace(/^["']|["']$/g, "").trim();
    }
  }

  return { meta, body };
}

function guessKindFromPath(relPath: string): string {
  const parts = relPath.split("/");
  if (parts.length >= 2) return parts[parts.length - 2].replace(/s$/, "");
  return "insight";
}

const RESERVED_FM_KEYS = new Set([
  "id",
  "kind",
  "title",
  "tags",
  "source",
  "created",
  "identity_key",
  "expires_at",
]);

function extractCustomMeta(meta: Record<string, unknown>) {
  const custom: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!RESERVED_FM_KEYS.has(k)) custom[k] = v;
  }
  return Object.keys(custom).length ? custom : undefined;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const KIND_COLORS: Record<string, string> = {
  insight: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  pattern: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  decision: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  reference: "bg-green-500/10 text-green-600 dark:text-green-400",
  event: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
};

function kindColor(kind: string): string {
  return KIND_COLORS[kind] || "bg-muted text-muted-foreground";
}

function entriesToNdjson(entries: ParsedEntry[]): string {
  return entries
    .map((e) => {
      const obj: Record<string, unknown> = {
        kind: e.kind,
        body: e.body,
        tags: e.tags,
        source: e.source || "import",
      };
      if (e.title) obj.title = e.title;
      if (e.identity_key) obj.identity_key = e.identity_key;
      if (e.expires_at) obj.expires_at = e.expires_at;
      if (e.created_at) obj.created_at = e.created_at;
      if (e.meta) obj.meta = e.meta;
      return JSON.stringify(obj);
    })
    .join("\n");
}

async function fileToNdjsonLine(file: File, relPath: string): Promise<string> {
  const raw = await file.text();
  const { meta, body } = parseFrontmatter(raw);
  const kind = (meta.kind as string) || guessKindFromPath(relPath || file.name);
  const title = (meta.title as string) || file.name.replace(/\.md$/, "");
  const obj: Record<string, unknown> = {
    kind,
    body,
    tags: (meta.tags as string[]) || [],
    source: (meta.source as string) || "import",
  };
  if (title) obj.title = title;
  const idKey = meta.identity_key as string | undefined;
  if (idKey) obj.identity_key = idKey;
  const exp = meta.expires_at as string | undefined;
  if (exp) obj.expires_at = exp;
  const created = meta.created as string | undefined;
  if (created) obj.created_at = created;
  const m = extractCustomMeta(meta);
  if (m) obj.meta = m;
  return JSON.stringify(obj);
}

const textEncoder = new TextEncoder();

async function* ndjsonBatchesFromFolderRows(
  rows: FolderRow[],
  maxBatchBytes: number,
  signal?: AbortSignal,
): AsyncGenerator<{ ndjson: string; lineCount: number }> {
  let lines: string[] = [];
  let batchBytes = 0;

  for (const row of rows) {
    if (signal?.aborted) {
      throw new DOMException("Import cancelled", "AbortError");
    }
    const line = await fileToNdjsonLine(row.file, row.relPath);
    const lineBytes = textEncoder.encode(`${line}\n`).length;

    if (lineBytes > maxBatchBytes) {
      throw new Error(
        `One file is larger than the ${Math.round(maxBatchBytes / (1024 * 1024))} MiB web import limit (${row.relPath}). Use the CLI or split the file.`,
      );
    }

    if (lines.length > 0 && batchBytes + lineBytes > maxBatchBytes) {
      yield { ndjson: lines.join("\n"), lineCount: lines.length };
      lines = [];
      batchBytes = 0;
    }
    lines.push(line);
    batchBytes += lineBytes;
  }

  if (lines.length > 0) {
    yield { ndjson: lines.join("\n"), lineCount: lines.length };
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ImportPage() {
  const qc = useQueryClient();
  const [state, setState] = useState<ImportState>("select");
  const [previewSource, setPreviewSource] = useState<PreviewSource | null>(null);
  const [mdRows, setMdRows] = useState<FolderRow[]>([]);
  const [jsonEntries, setJsonEntries] = useState<ParsedEntry[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    entries_uploaded: number;
    errors: string[];
    batchCount: number;
  } | null>(null);
  const [jsonInput, setJsonInput] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{
    uploadedFiles: number;
    totalFiles: number;
    batchIndex: number;
  } | null>(null);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const jobStatus = useJobStatus(jobId);

  const selectedMd = useMemo(
    () => mdRows.filter((r) => r.selected),
    [mdRows],
  );
  const selectedJson = useMemo(
    () => jsonEntries.filter((e) => e.selected),
    [jsonEntries],
  );

  const previewRowsMd = useMemo(() => {
    if (mdRows.length <= FOLDER_PREVIEW_LIST_CAP) return mdRows;
    return mdRows.slice(0, FOLDER_PREVIEW_LIST_CAP);
  }, [mdRows]);

  const selectedCount =
    previewSource === "markdown" ? selectedMd.length : selectedJson.length;
  const totalSize = useMemo(() => {
    if (previewSource === "markdown") {
      return selectedMd.reduce((s, r) => s + r.size, 0);
    }
    return selectedJson.reduce((s, e) => s + e.size, 0);
  }, [previewSource, selectedMd, selectedJson]);

  const kindBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    if (previewSource === "markdown") {
      for (const r of selectedMd) {
        counts[r.kindGuess] = (counts[r.kindGuess] || 0) + 1;
      }
    } else {
      for (const e of selectedJson) {
        counts[e.kind] = (counts[e.kind] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [previewSource, selectedMd, selectedJson]);

  const allSelected =
    previewSource === "markdown"
      ? mdRows.length > 0 && mdRows.every((r) => r.selected)
      : jsonEntries.length > 0 && jsonEntries.every((e) => e.selected);

  // ─── Markdown staging (no file bodies in memory) ──────────────────────────

  const stageMarkdownFiles = (files: File[]) => {
    const mdFiles = files.filter((f) => f.name.endsWith(".md"));
    if (!mdFiles.length) {
      toast.error("No .md files found");
      return;
    }

    const rows: FolderRow[] = mdFiles.map((file) => {
      const relPath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;
      return {
        file,
        relPath,
        size: file.size,
        selected: true,
        kindGuess: guessKindFromPath(relPath),
        titleGuess: file.name.replace(/\.md$/, ""),
      };
    });

    setMdRows(rows);
    setJsonEntries([]);
    setPreviewSource("markdown");
    setState("preview");
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    stageMarkdownFiles(files);
    e.target.value = "";
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    stageMarkdownFiles(files);
    e.target.value = "";
  };

  // ─── Selection ──────────────────────────────────────────────────────────

  const toggleMdRowByPath = (relPath: string) => {
    if (mdRows.length > FOLDER_PREVIEW_LIST_CAP) return;
    setMdRows((prev) =>
      prev.map((r) =>
        r.relPath === relPath ? { ...r, selected: !r.selected } : r,
      ),
    );
  };

  const toggleJsonEntry = (index: number) => {
    setJsonEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, selected: !e.selected } : e)),
    );
  };

  const toggleAll = () => {
    const newVal = !allSelected;
    if (previewSource === "markdown") {
      setMdRows((prev) => prev.map((r) => ({ ...r, selected: newVal })));
    } else {
      setJsonEntries((prev) => prev.map((e) => ({ ...e, selected: newVal })));
    }
  };

  const invalidateVaultQueries = () => {
    qc.invalidateQueries({ queryKey: ["entries"] });
    qc.invalidateQueries({ queryKey: ["usage"] });
  };

  // ─── Upload ─────────────────────────────────────────────────────────────

  const startUpload = async () => {
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    setState("uploading");
    setUploadProgress(null);

    try {
      if (previewSource === "markdown") {
        const rows = selectedMd;
        if (!rows.length) {
          setState("preview");
          return;
        }

        let totalUploaded = 0;
        const allErrors: string[] = [];
        let lastJobId: string | null = null;
        let batchCount = 0;
        let uploadedFiles = 0;

        setUploadProgress({
          uploadedFiles: 0,
          totalFiles: rows.length,
          batchIndex: 0,
        });

        for await (const { ndjson, lineCount } of ndjsonBatchesFromFolderRows(
          rows,
          FOLDER_IMPORT_MAX_BATCH_BYTES,
          controller.signal,
        )) {
          batchCount += 1;
          setUploadProgress({
            uploadedFiles,
            totalFiles: rows.length,
            batchIndex: batchCount,
          });

          const result = await streamImport(ndjson);
          totalUploaded += result.entries_uploaded;
          allErrors.push(...result.errors);
          lastJobId = result.job_id;

          uploadedFiles += lineCount;
          setUploadProgress({
            uploadedFiles,
            totalFiles: rows.length,
            batchIndex: batchCount,
          });

          await pollVaultImportJobUntilTerminal(result.job_id, {
            signal: controller.signal,
          });
        }

        if (!lastJobId) {
          toast.error("Nothing to upload");
          setState("preview");
          return;
        }

        invalidateVaultQueries();
        setUploadResult({
          entries_uploaded: totalUploaded,
          errors: allErrors,
          batchCount,
        });
        setJobId(lastJobId);
        setState("indexing");
      } else {
        const ndjson = entriesToNdjson(selectedJson);
        const result = await streamImport(ndjson);
        invalidateVaultQueries();
        setUploadResult({
          entries_uploaded: result.entries_uploaded,
          errors: result.errors,
          batchCount: 1,
        });
        setJobId(result.job_id);
        setState("indexing");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.message("Import cancelled");
      } else {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      }
      setState("preview");
    } finally {
      uploadAbortRef.current = null;
      setUploadProgress(null);
    }
  };

  // ─── JSON import ────────────────────────────────────────────────────────

  const handleJsonImport = () => {
    if (!jsonInput.trim()) return;
    let data: Record<string, unknown>[];
    try {
      data = JSON.parse(jsonInput);
      if (!Array.isArray(data)) {
        toast.error("Expected a JSON array of entries");
        return;
      }
    } catch {
      toast.error("Invalid JSON");
      return;
    }

    const parsed: ParsedEntry[] = data.map((item, i) => ({
      file: new File([""], `entry-${i + 1}.json`),
      kind: (item.kind as string) || "insight",
      title: (item.title as string) || `Entry ${i + 1}`,
      body: (item.body as string) || "",
      tags: (item.tags as string[]) || [],
      source: (item.source as string) || "import",
      identity_key: (item.identity_key as string) || null,
      expires_at: (item.expires_at as string) || null,
      created_at: (item.created_at as string) || null,
      meta: item.meta as Record<string, unknown> | undefined,
      selected: true,
      size: JSON.stringify(item).length,
    }));

    setJsonEntries(parsed);
    setMdRows([]);
    setPreviewSource("json");
    setJsonInput("");
    setState("preview");
  };

  const handleJsonFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setJsonInput(ev.target?.result as string);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ─── Reset ──────────────────────────────────────────────────────────────

  const reset = () => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    setState("select");
    setMdRows([]);
    setJsonEntries([]);
    setPreviewSource(null);
    setJobId(null);
    setUploadResult(null);
    setJsonInput("");
    setUploadProgress(null);
  };

  const job = jobStatus.data;

  useEffect(() => {
    if (state !== "indexing") return;
    if (!job) return;
    if (job.status === "complete" || job.status === "failed") {
      setState("complete");
    }
  }, [state, job?.status]);

  const previewCount =
    previewSource === "markdown" ? mdRows.length : jsonEntries.length;

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import entries from your local vault or a JSON export. Large folders
          upload in batches (bodies are read per batch, not all at once).
        </p>
      </div>

      {/* ─── State 1: Select ──────────────────────────────────────────── */}
      {state === "select" && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="size-4" />
                <CardTitle className="text-base">Vault Folder</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center space-y-3">
                <FolderOpen className="size-10 mx-auto text-muted-foreground/40" />
                <div>
                  <p className="text-sm font-medium">
                    Select your vault folder
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    All .md files — preview uses paths only; content uploads in
                    chunks
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => folderInputRef.current?.click()}
                >
                  Select folder
                </Button>
                <input
                  type="file"
                  ref={folderInputRef}
                  // @ts-expect-error webkitdirectory not in standard types
                  webkitdirectory=""
                  multiple
                  className="hidden"
                  onChange={handleFolderSelect}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4" />
                <CardTitle className="text-base">
                  Or select individual files
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Select files
              </Button>
              <input
                type="file"
                ref={fileInputRef}
                accept=".md"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </CardContent>
          </Card>

          {/* JSON import (collapsible) */}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
              <ChevronDown className="size-3.5" />
              Import from JSON
            </summary>
            <Card className="mt-3">
              <CardContent className="pt-4 space-y-3">
                <details className="text-xs rounded-md border bg-muted/40">
                  <summary className="cursor-pointer px-3 py-2 text-muted-foreground hover:text-foreground transition-colors select-none">
                    Expected format
                  </summary>
                  <pre className="px-3 pb-3 pt-1 text-[11px] leading-relaxed font-mono text-muted-foreground overflow-x-auto whitespace-pre">{`[
  {
    "kind": "insight",
    "body": "Entry text",
    "title": "My note",
    "tags": ["tag1", "tag2"],
    "source": "import"
  }
]`}</pre>
                </details>
                <Textarea
                  placeholder={`[\n  {\n    "kind": "insight",\n    "title": "...",\n    "body": "...",\n    "tags": ["tag1"]\n  }\n]`}
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  className="min-h-[140px] font-mono text-xs"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleJsonImport}
                    disabled={!jsonInput.trim()}
                  >
                    Parse JSON
                  </Button>
                  <input
                    type="file"
                    ref={jsonFileInputRef}
                    accept=".json"
                    className="hidden"
                    onChange={handleJsonFileUpload}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => jsonFileInputRef.current?.click()}
                  >
                    Upload file
                  </Button>
                </div>
              </CardContent>
            </Card>
          </details>
        </>
      )}

      {/* ─── State 2: Preview ─────────────────────────────────────────── */}
      {state === "preview" && previewSource && (
        <>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-medium">
                    {previewCount}{" "}
                    {previewSource === "markdown" ? "files" : "entries"} (
                    {formatBytes(totalSize)})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {kindBreakdown.map(([kind, count]) => (
                      <span
                        key={kind}
                        className="text-xs text-muted-foreground"
                      >
                        {count} {kind}
                        {count !== 1 ? "s" : ""}
                      </span>
                    ))}
                  </div>
                  {previewSource === "markdown" &&
                    mdRows.length > FOLDER_PREVIEW_LIST_CAP && (
                      <p className="text-xs text-muted-foreground pt-1">
                        Showing first {FOLDER_PREVIEW_LIST_CAP} paths. Kinds are
                        inferred from folder names until upload (then
                        frontmatter is read). Use Select all / Deselect all for
                        the full set of {mdRows.length} files.
                      </p>
                    )}
                </div>
                <Button variant="ghost" size="sm" onClick={toggleAll}>
                  {allSelected ? "Deselect all" : "Select all"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="max-h-[400px] overflow-y-auto divide-y">
                {previewSource === "markdown" &&
                  previewRowsMd.map((row, i) => (
                    <div
                      key={`${row.relPath}-${i}`}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={row.selected}
                        disabled={mdRows.length > FOLDER_PREVIEW_LIST_CAP}
                        onCheckedChange={() => toggleMdRowByPath(row.relPath)}
                      />
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0 font-normal shrink-0 ${kindColor(row.kindGuess)}`}
                      >
                        {row.kindGuess}
                      </Badge>
                      <span className="text-sm truncate flex-1 min-w-0">
                        {row.titleGuess}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatBytes(row.size)}
                      </span>
                    </div>
                  ))}
                {previewSource === "json" &&
                  jsonEntries.map((entry, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={entry.selected}
                        onCheckedChange={() => toggleJsonEntry(i)}
                      />
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0 font-normal shrink-0 ${kindColor(entry.kind)}`}
                      >
                        {entry.kind}
                      </Badge>
                      <span className="text-sm truncate flex-1 min-w-0">
                        {entry.title}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatBytes(entry.size)}
                      </span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={reset}>
              Back
            </Button>
            <div className="flex items-center gap-3">
              {previewCount > 5000 && (
                <p className="text-xs text-muted-foreground">
                  Large vault — upload runs in batches; expect several minutes.
                </p>
              )}
              <Button onClick={startUpload} disabled={selectedCount === 0}>
                <Upload className="size-4 mr-2" />
                Upload {selectedCount}{" "}
                {selectedCount === 1 ? "entry" : "entries"}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ─── State 3a: Uploading ──────────────────────────────────────── */}
      {state === "uploading" && (
        <Card>
          <CardContent className="pt-6 pb-6 space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <p className="text-sm font-medium">
                {uploadProgress
                  ? `Uploading ${uploadProgress.uploadedFiles} / ${uploadProgress.totalFiles} files (batch ${uploadProgress.batchIndex})…`
                  : `Uploading ${selectedCount} entries…`}
              </p>
            </div>
            <Progress
              className="h-2"
              value={
                uploadProgress && uploadProgress.totalFiles > 0
                  ? (uploadProgress.uploadedFiles / uploadProgress.totalFiles) *
                    100
                  : undefined
              }
            />
          </CardContent>
        </Card>
      )}

      {/* ─── State 3b: Indexing ───────────────────────────────────────── */}
      {state === "indexing" && uploadResult && (
        <Card>
          <CardContent className="pt-6 pb-6 space-y-4">
            <p className="text-sm font-medium">
              Uploaded {uploadResult.entries_uploaded} entries
              {uploadResult.batchCount > 1
                ? ` in ${uploadResult.batchCount} batches`
                : ""}
              . Indexing…
            </p>
            {job && (
              <>
                <Progress
                  value={
                    uploadResult.batchCount > 1
                      ? job.status === "complete"
                        ? 100
                        : job.entries_uploaded > 0
                          ? (job.entries_embedded / job.entries_uploaded) * 100
                          : 0
                      : job.entries_uploaded > 0
                        ? (job.entries_embedded / job.entries_uploaded) * 100
                        : 0
                  }
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {uploadResult.batchCount > 1
                    ? `Final batch: ${job.entries_embedded} / ${job.entries_uploaded}`
                    : `Indexing: ${job.entries_embedded} / ${job.entries_uploaded}`}
                </p>
              </>
            )}
            {!job && (
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Waiting for job status…
                </p>
              </div>
            )}
            {uploadResult.errors.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 max-h-32 overflow-y-auto">
                <p className="text-xs font-medium text-destructive mb-1">
                  {uploadResult.errors.length} upload errors:
                </p>
                {uploadResult.errors.map((err, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {err}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── State 3c: Complete ───────────────────────────────────────── */}
      {state === "complete" && (
        <Card>
          <CardContent className="pt-6 pb-6 space-y-4">
            {job?.status === "failed" ? (
              <div className="flex items-center gap-3">
                <AlertCircle className="size-6 text-destructive" />
                <div>
                  <p className="text-sm font-medium">Import failed</p>
                  {job.errors.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {job.errors[0]}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-6 text-green-500" />
                <div>
                  <p className="text-sm font-medium">Import complete</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {uploadResult?.entries_uploaded ?? 0} entries uploaded
                    {uploadResult && uploadResult.batchCount > 1
                      ? ` (${uploadResult.batchCount} batches)`
                      : ""}
                    {job && uploadResult?.batchCount === 1
                      ? `, ${job.entries_embedded} indexed`
                      : job
                        ? " — search indexing finished for the final batch"
                        : ""}
                  </p>
                </div>
              </div>
            )}

            {job && job.errors.length > 0 && job.status !== "failed" && (
              <details className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <summary className="text-xs font-medium text-destructive cursor-pointer">
                  {job.errors.length} entries failed
                </summary>
                <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                  {job.errors.map((err, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {err}
                    </p>
                  ))}
                </div>
              </details>
            )}

            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={reset}>
                Import more
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/vault/knowledge">View vault</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
