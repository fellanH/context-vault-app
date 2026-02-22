import { useState, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Progress } from "../components/ui/progress";
import { Upload, FolderOpen, Loader2 } from "lucide-react";
import { useImportEntry } from "../lib/hooks";
import { toast } from "sonner";

function parseFrontmatter(raw: string): {
  meta: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };

  const yamlStr = match[1];
  const body = match[2].trim();
  const meta: Record<string, unknown> = {};

  // Multi-line arrays: detect "key:\n  - val" blocks
  const mlArr = yamlStr.replace(
    /^(\w[\w-]*):\s*\n((?:[ \t]+-[^\n]*\n?)+)/gm,
    (_, k, block) => {
      meta[k] = block
        .match(/^[ \t]+-\s*(.+)$/gm)!
        .map((l: string) => l.replace(/^[ \t]+-\s*/, "").trim());
      return "";
    },
  );

  // Single-line key: value pairs
  for (const line of mlArr.split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (!m) continue;
    const [, k, v] = m;
    if (k in meta) continue; // already parsed as multi-line
    // Inline array
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

export function ImportPage() {
  const importMutation = useImportEntry();

  const [jsonInput, setJsonInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importCurrent, setImportCurrent] = useState(0);
  const [importErrors, setImportErrors] = useState<
    Array<{ title: string; error: string }>
  >([]);
  const [importResult, setImportResult] = useState<{
    succeeded: number;
    total: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.name.endsWith(".md"),
    );
    if (!files.length) return;

    setImporting(true);
    setImportProgress(0);
    setImportTotal(files.length);
    setImportCurrent(0);
    setImportResult(null);
    setImportErrors([]);

    let succeeded = 0;
    const errors: Array<{ title: string; error: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const raw = await file.text();
        const { meta, body } = parseFrontmatter(raw);
        const kind =
          (meta.kind as string) ||
          guessKindFromPath(
            (file as File & { webkitRelativePath: string }).webkitRelativePath,
          );
        const title = (meta.title as string) || undefined;

        await importMutation.mutateAsync({
          id: meta.id,
          kind,
          title: title || null,
          body,
          tags: (meta.tags as string[]) || [],
          source: (meta.source as string) || "import",
          identity_key: (meta.identity_key as string) || null,
          expires_at: (meta.expires_at as string) || null,
          created_at: (meta.created as string) || null,
          meta: extractCustomMeta(meta),
        });
        succeeded++;
      } catch (err) {
        errors.push({
          title: file.name,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
      setImportCurrent(i + 1);
      setImportProgress(((i + 1) / files.length) * 100);
    }

    setImporting(false);
    setImportResult({ succeeded, total: files.length });
    setImportErrors(errors);
    // Reset file input so same folder can be re-selected
    e.target.value = "";
  };

  const handleJsonImport = async () => {
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

    setImporting(true);
    setImportProgress(0);
    setImportTotal(data.length);
    setImportCurrent(0);
    setImportResult(null);
    setImportErrors([]);

    let succeeded = 0;
    const errors: Array<{ title: string; error: string }> = [];

    for (let i = 0; i < data.length; i++) {
      try {
        await importMutation.mutateAsync(data[i]);
        succeeded++;
      } catch (err) {
        errors.push({
          title: (data[i].title as string) || `Entry ${i + 1}`,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
      setImportCurrent(i + 1);
      setImportProgress(((i + 1) / data.length) * 100);
    }

    setImporting(false);
    setJsonInput("");
    setImportResult({ succeeded, total: data.length });
    setImportErrors(errors);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setJsonInput(ev.target?.result as string);
    };
    reader.readAsText(file);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import entries from your local vault or a JSON export.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Upload className="size-4" />
            <CardTitle className="text-base">Import</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Primary: folder upload */}
          <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 text-center space-y-2">
            <FolderOpen className="size-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Select your local vault folder
            </p>
            <p className="text-xs text-muted-foreground/70">
              All .md files will be imported
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => folderInputRef.current?.click()}
              disabled={importing}
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
              onChange={handleFolderUpload}
            />
          </div>

          {/* Markdown format reference */}
          <details className="text-xs rounded-md border bg-muted/40">
            <summary className="cursor-pointer px-3 py-2 text-muted-foreground hover:text-foreground transition-colors select-none">
              Expected .md format
            </summary>
            <pre className="px-3 pb-3 pt-1 text-[11px] leading-relaxed font-mono text-muted-foreground overflow-x-auto whitespace-pre">{`---
kind: insight          # required — insight | event | entity
title: My note         # optional
tags: [tag1, tag2]     # optional
source: obsidian       # optional
identity_key: my-key   # optional — dedup on reimport
---
Entry content here`}</pre>
          </details>

          {importing && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {importCurrent} / {importTotal}
              </p>
              <Progress value={importProgress} className="h-1.5" />
            </div>
          )}

          {importResult && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Imported{" "}
                <span className="font-medium text-foreground">
                  {importResult.succeeded}
                </span>{" "}
                of {importResult.total} entries.
              </p>
              {importErrors.length > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1 max-h-48 overflow-y-auto">
                  <p className="text-xs font-medium text-destructive mb-1.5">
                    {importErrors.length} failed:
                  </p>
                  {importErrors.map((e, i) => (
                    <div key={i} className="text-xs">
                      <span className="font-medium">{e.title}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        — {e.error}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setImportResult(null)}
                className="h-7 text-xs"
              >
                Dismiss
              </Button>
            </div>
          )}

          {/* Secondary: JSON (collapsible) */}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
              Import from JSON instead
            </summary>
            <div className="mt-3 space-y-3">
              {/* Format reference — shown before file pick */}
              <details className="rounded-md border bg-muted/40">
                <summary className="cursor-pointer px-3 py-2 text-muted-foreground hover:text-foreground transition-colors select-none">
                  Expected format
                </summary>
                <pre className="px-3 pb-3 pt-1 text-[11px] leading-relaxed font-mono text-muted-foreground overflow-x-auto whitespace-pre">{`[
  {
    "kind": "insight",        // required — insight | event | entity
    "body": "Entry text",     // required
    "title": "My note",       // optional
    "tags": ["tag1", "tag2"], // optional
    "source": "import",       // optional
    "identity_key": "my-key", // optional — dedup on reimport
    "expires_at": null        // optional — ISO 8601 date
  }
]`}</pre>
              </details>

              <Textarea
                id="jsonInput"
                placeholder={`[\n  {\n    "kind": "insight",\n    "title": "...",\n    "body": "...",\n    "tags": ["tag1"]\n  }\n]`}
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="min-h-[160px] font-mono text-xs"
              />

              {importing && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {importCurrent} / {importTotal}
                  </p>
                  <Progress value={importProgress} className="h-1.5" />
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleJsonImport}
                  disabled={importing || !jsonInput.trim()}
                >
                  {importing ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin mr-1.5" />
                      Importing…
                    </>
                  ) : (
                    "Import JSON"
                  )}
                </Button>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".json"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                >
                  Upload file
                </Button>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
