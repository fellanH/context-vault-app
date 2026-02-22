import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Progress } from "../components/ui/progress";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Copy, Check, Loader2, Terminal } from "lucide-react";
import { toast } from "sonner";
import { useImportEntry } from "../lib/hooks";
import { consumePendingFiles, hasPendingFiles } from "../lib/pendingImport";
import { setOnboardingMode } from "../lib/onboarding";

const API_URL = import.meta.env.VITE_API_URL || "/api";

// ── Import utilities (mirrors Import.tsx) ────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const importMutation = useImportEntry();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);

  // Import state — populated when files were selected on the Login page
  const [filesToImport, setFilesToImport] = useState<File[] | null>(null);
  const [importRunning, setImportRunning] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importCurrent, setImportCurrent] = useState(0);
  const [importResult, setImportResult] = useState<{
    succeeded: number;
    total: number;
  } | null>(null);

  const handleGoogleRegister = () => {
    if (hasPendingFiles()) {
      // Files won't survive the OAuth redirect — set migration mode so the
      // dashboard shows the import step on first visit instead.
      setOnboardingMode("migration");
    }
    setIsRedirecting(true);
    const origin = encodeURIComponent(window.location.origin);
    window.location.href = `${API_URL}/auth/google?origin=${origin}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await register(email.trim(), name.trim() || undefined);
      setGeneratedKey(result.apiKey);
      toast.success("Account created!");
      // Pick up any vault files selected on the login page
      const pending = consumePendingFiles();
      if (pending && pending.length > 0) {
        setFilesToImport(pending);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          toast.error("An account with this email already exists");
        } else if (err.status === 429) {
          toast.error("Too many requests. Please try again later.");
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error("Failed to create account");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyKey = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    toast.success("API key copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const connectCmd = generatedKey
    ? `npx context-vault connect --key ${generatedKey}`
    : "";

  const copyCommand = async () => {
    await navigator.clipboard.writeText(connectCmd);
    setCopiedCmd(true);
    toast.success("Command copied");
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const runImport = async (files: File[]) => {
    setImportRunning(true);
    setImportTotal(files.length);
    setImportCurrent(0);
    setImportProgress(0);
    let succeeded = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        const raw = await files[i].text();
        const { meta, body } = parseFrontmatter(raw);
        const kind =
          (meta.kind as string) ||
          guessKindFromPath(
            (files[i] as File & { webkitRelativePath: string })
              .webkitRelativePath || files[i].name,
          );
        await importMutation.mutateAsync({
          id: meta.id,
          kind,
          title: (meta.title as string) || null,
          body,
          tags: (meta.tags as string[]) || [],
          source: (meta.source as string) || "import",
          identity_key: (meta.identity_key as string) || null,
          expires_at: (meta.expires_at as string) || null,
          created_at: (meta.created as string) || null,
          meta: extractCustomMeta(meta),
        });
        succeeded++;
      } catch {
        // skip malformed entry
      }
      setImportCurrent(i + 1);
      setImportProgress(((i + 1) / files.length) * 100);
    }
    setImportRunning(false);
    setImportResult({ succeeded, total: files.length });
  };

  if (generatedKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold">Welcome to Context Vault</h1>
            <p className="text-sm text-muted-foreground">
              Your account is ready
            </p>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Terminal className="size-5" />
                Connect your AI tools
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Run this command to auto-configure all your AI tools:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-xs font-mono break-all">
                    {connectCmd}
                  </code>
                  <Button variant="outline" size="icon" onClick={copyCommand}>
                    {copiedCmd ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    Or manual config
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Your API Key</p>
                <p className="text-xs text-muted-foreground">
                  Save this key — it won't be shown again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono break-all">
                    {generatedKey}
                  </code>
                  <Button variant="outline" size="icon" onClick={copyKey}>
                    {copied ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>
              </div>

              <details className="text-sm">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:underline">
                  Show JSON config
                </summary>
                <pre className="bg-muted p-3 rounded text-xs font-mono overflow-x-auto mt-2">
                  {`{
  "mcpServers": {
    "context-vault": {
      "url": "https://api.context-vault.com/mcp",
      "headers": {
        "Authorization": "Bearer ${generatedKey}"
      }
    }
  }
}`}
                </pre>
              </details>

              {/* Vault import — only shown when files were selected on the login page */}
              {filesToImport && !importResult && (
                <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
                  <p className="text-sm font-medium">Import your local vault</p>
                  {importRunning ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        {importCurrent} / {importTotal}
                      </p>
                      <Progress value={importProgress} className="h-1.5" />
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {filesToImport.length} markdown files selected — import
                        them into your vault now.
                      </p>
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => runImport(filesToImport)}
                      >
                        Import {filesToImport.length} files
                      </Button>
                    </>
                  )}
                </div>
              )}

              {importResult && (
                <p className="text-xs text-muted-foreground text-center">
                  <span className="font-medium text-foreground">
                    {importResult.succeeded}
                  </span>{" "}
                  of {importResult.total} vault entries imported.
                </p>
              )}

              <Button className="w-full" onClick={() => navigate("/")}>
                Continue to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Context Vault</h1>
          <p className="text-sm text-muted-foreground">Create your account</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Get started</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasPendingFiles() && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Your vault folder is ready — entries will be imported after
                  account creation.
                </p>
              </div>
            )}

            <Button
              variant="default"
              className="w-full gap-2"
              onClick={handleGoogleRegister}
              disabled={isRedirecting}
            >
              {isRedirecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <svg className="size-4" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Sign up with Google
                </>
              )}
            </Button>

            {!showEmailForm ? (
              <button
                type="button"
                className="w-full text-xs text-muted-foreground hover:underline"
                onClick={() => setShowEmailForm(true)}
              >
                Or register with email
              </button>
            ) : (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      Or email
                    </span>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Name (optional)</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="Alex Chen"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="secondary"
                    className="w-full"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      "Create account"
                    )}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/login"
            className="text-foreground hover:underline font-medium"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
