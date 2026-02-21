import { useState, useRef } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import { Progress } from "../../components/ui/progress";
import { Input } from "../../components/ui/input";
import {
  Upload,
  Download,
  Trash2,
  Lock,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { useAuth } from "../../lib/auth";
import {
  useImportEntry,
  useExportVault,
  useDeleteAccount,
  useRawUsage,
} from "../../lib/hooks";
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

export function DataManagement() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { data: rawUsage } = useRawUsage();
  const importMutation = useImportEntry();
  const { refetch: fetchExport } = useExportVault();
  const deleteMutation = useDeleteAccount();

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
  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
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

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await fetchExport();
      if (result.data) {
        const blob = new Blob([JSON.stringify(result.data.entries, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `context-vault-export-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Export downloaded");
      }
    } catch {
      toast.error("Failed to export vault data");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        logout();
        navigate("/login");
      },
      onError: () => {
        toast.error("Failed to delete account");
      },
    });
  };

  const exportEnabled = rawUsage?.limits.exportEnabled ?? false;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import, export, and manage your vault data.
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
            <div className="mt-3 space-y-2">
              <Textarea
                id="jsonInput"
                placeholder={`[\n  {\n    "category": "knowledge",\n    "kind": "insight",\n    "title": "...",\n    "body": "...",\n    "tags": ["tag1"]\n  }\n]`}
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="min-h-[160px] font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleJsonImport}
                  disabled={importing || !jsonInput.trim()}
                >
                  {importing ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin mr-1.5" />
                      {importCurrent}/{importTotal}
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

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Download className="size-4" />
            <CardTitle className="text-base">Export</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {!exportEnabled ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="size-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Export is available on Pro and Team plans.
                </span>
              </div>
              <Badge variant="secondary">Upgrade to Pro</Badge>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <Download className="size-3.5 mr-1.5" />
              )}
              Download vault data
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Trash2 className="size-4 text-destructive" />
            <CardTitle className="text-base text-destructive">
              Danger Zone
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Permanently delete your account and all vault data. This action
            cannot be undone.
          </p>
          <div className="space-y-2">
            <Label htmlFor="deleteConfirm" className="text-xs">
              Type{" "}
              <span className="font-mono font-bold">delete my account</span> to
              confirm
            </Label>
            <Input
              id="deleteConfirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="delete my account"
              className="max-w-xs"
            />
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={
              deleteConfirm !== "delete my account" || deleteMutation.isPending
            }
            onClick={handleDeleteAccount}
          >
            {deleteMutation.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                Deleting...
              </>
            ) : (
              "Delete Account"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
