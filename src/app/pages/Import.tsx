import { useState, useRef, useMemo } from "react";
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
import { useStreamImport, useJobStatus } from "../lib/hooks";
import { toast } from "sonner";
import { Link } from "react-router";

// ─── Types ──────────────────────────────────────────────────────────────────

type ImportState = "select" | "preview" | "uploading" | "indexing" | "complete";

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

// ─── Component ──────────────────────────────────────────────────────────────

export function ImportPage() {
  const [state, setState] = useState<ImportState>("select");
  const [entries, setEntries] = useState<ParsedEntry[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    entries_uploaded: number;
    errors: string[];
  } | null>(null);
  const [jsonInput, setJsonInput] = useState("");

  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  const streamImport = useStreamImport();
  const jobStatus = useJobStatus(jobId);

  // Derived
  const selectedEntries = useMemo(
    () => entries.filter((e) => e.selected),
    [entries],
  );
  const selectedCount = selectedEntries.length;
  const totalSize = useMemo(
    () => selectedEntries.reduce((sum, e) => sum + e.size, 0),
    [selectedEntries],
  );
  const kindBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of selectedEntries) {
      counts[e.kind] = (counts[e.kind] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [selectedEntries]);

  const allSelected = entries.length > 0 && entries.every((e) => e.selected);

  // ─── File parsing ───────────────────────────────────────────────────────

  const parseFiles = async (files: File[]) => {
    const mdFiles = files.filter((f) => f.name.endsWith(".md"));
    if (!mdFiles.length) {
      toast.error("No .md files found");
      return;
    }

    const parsed: ParsedEntry[] = [];
    for (const file of mdFiles) {
      const raw = await file.text();
      const { meta, body } = parseFrontmatter(raw);
      const relPath = (file as File & { webkitRelativePath: string })
        .webkitRelativePath;
      const kind = (meta.kind as string) || guessKindFromPath(relPath || file.name);
      const title = (meta.title as string) || file.name.replace(/\.md$/, "");

      parsed.push({
        file,
        kind,
        title,
        body,
        tags: (meta.tags as string[]) || [],
        source: (meta.source as string) || "import",
        identity_key: (meta.identity_key as string) || null,
        expires_at: (meta.expires_at as string) || null,
        created_at: (meta.created as string) || null,
        meta: extractCustomMeta(meta),
        selected: true,
        size: file.size,
      });
    }

    setEntries(parsed);
    setState("preview");
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    parseFiles(files);
    e.target.value = "";
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    parseFiles(files);
    e.target.value = "";
  };

  // ─── Selection ──────────────────────────────────────────────────────────

  const toggleEntry = (index: number) => {
    setEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, selected: !e.selected } : e)),
    );
  };

  const toggleAll = () => {
    const newVal = !allSelected;
    setEntries((prev) => prev.map((e) => ({ ...e, selected: newVal })));
  };

  // ─── Upload ─────────────────────────────────────────────────────────────

  const startUpload = async () => {
    setState("uploading");
    const ndjson = entriesToNdjson(selectedEntries);

    try {
      const result = await streamImport.mutateAsync(ndjson);
      setUploadResult({
        entries_uploaded: result.entries_uploaded,
        errors: result.errors,
      });
      setJobId(result.job_id);
      setState("indexing");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Upload failed",
      );
      setState("preview");
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

    setEntries(parsed);
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
    setState("select");
    setEntries([]);
    setJobId(null);
    setUploadResult(null);
    setJsonInput("");
  };

  // ─── Check if indexing is complete ──────────────────────────────────────

  const job = jobStatus.data;
  if (
    state === "indexing" &&
    job &&
    (job.status === "complete" || job.status === "failed")
  ) {
    // Transition to complete on next render
    if (state === "indexing") {
      setTimeout(() => setState("complete"), 0);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import entries from your local vault or a JSON export.
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
                    All .md files will be parsed
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
      {state === "preview" && (
        <>
          {/* Summary bar */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-medium">
                    {entries.length} files selected ({formatBytes(totalSize)})
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
                </div>
                <Button variant="ghost" size="sm" onClick={toggleAll}>
                  {allSelected ? "Deselect all" : "Select all"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* File list */}
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[400px] overflow-y-auto divide-y">
                {entries.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <Checkbox
                      checked={entry.selected}
                      onCheckedChange={() => toggleEntry(i)}
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

          {/* Action bar */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={reset}>
              Back
            </Button>
            <div className="flex items-center gap-3">
              {entries.length > 10000 && (
                <p className="text-xs text-muted-foreground">
                  Large upload. Indexing may take a few minutes.
                </p>
              )}
              <Button
                onClick={startUpload}
                disabled={selectedCount === 0}
              >
                <Upload className="size-4 mr-2" />
                Upload {selectedCount} {selectedCount === 1 ? "entry" : "entries"}
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
                Uploading {selectedCount} entries...
              </p>
            </div>
            <Progress className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* ─── State 3b: Indexing ───────────────────────────────────────── */}
      {state === "indexing" && uploadResult && (
        <Card>
          <CardContent className="pt-6 pb-6 space-y-4">
            <p className="text-sm font-medium">
              Uploaded {uploadResult.entries_uploaded} entries. Indexing...
            </p>
            {job && (
              <>
                <Progress
                  value={
                    job.entries_uploaded > 0
                      ? (job.entries_embedded / job.entries_uploaded) * 100
                      : 0
                  }
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  Indexing: {job.entries_embedded} / {job.entries_uploaded}
                </p>
              </>
            )}
            {!job && (
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Waiting for job status...
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
                    {job?.entries_uploaded ?? uploadResult?.entries_uploaded ?? 0}{" "}
                    entries uploaded, {job?.entries_embedded ?? 0} indexed
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
