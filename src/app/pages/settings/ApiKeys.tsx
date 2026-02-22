import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Copy,
  Check,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Activity,
} from "lucide-react";
import {
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  useKeyActivity,
} from "../../lib/hooks";
import type { ApiKey } from "../../lib/types";
import { toast } from "sonner";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const SCOPE_OPTIONS = [
  {
    value: "vault:read",
    label: "vault:read",
    description: "Read entries, search, status",
  },
  {
    value: "vault:write",
    label: "vault:write",
    description: "Create, update, delete entries",
  },
  {
    value: "vault:export",
    label: "vault:export",
    description: "Export vault data",
  },
  { value: "mcp", label: "mcp", description: "MCP endpoint access" },
  { value: "keys:read", label: "keys:read", description: "List API keys" },
] as const;

function ScopeBadges({ scopes }: { scopes: string[] }) {
  if (scopes.includes("*")) {
    return (
      <Badge variant="secondary" className="text-[10px]">
        Full access
      </Badge>
    );
  }
  return (
    <>
      {scopes.map((s) => (
        <Badge key={s} variant="outline" className="text-[10px] font-mono">
          {s}
        </Badge>
      ))}
    </>
  );
}

function formatRelativeTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function KeyActivityPanel({ keyId }: { keyId: string }) {
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;
  const { data, isLoading } = useKeyActivity(keyId, {
    limit: LIMIT,
    offset,
  });

  if (isLoading) {
    return (
      <div className="pt-2 pb-1 space-y-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-6 bg-muted rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data || data.logs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        No requests logged yet. Activity appears once this key is used.
      </p>
    );
  }

  const hasMore = offset + data.logs.length < data.total;
  const hasPrev = offset > 0;

  return (
    <div className="pt-2 space-y-0.5">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-1 pb-1">
        <span>Operation</span>
        <span className="text-right">Time</span>
        <span className="text-right">Status</span>
      </div>
      {data.logs.map((log, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center py-0.5 px-1 rounded text-xs hover:bg-muted/50"
        >
          <span className="font-mono truncate">{log.operation}</span>
          <span className="text-muted-foreground whitespace-nowrap">
            {formatRelativeTime(log.timestamp)}
          </span>
          <Badge
            variant={log.status === "success" ? "secondary" : "destructive"}
            className="text-[9px] h-4 px-1"
          >
            {log.status}
          </Badge>
        </div>
      ))}
      {(hasMore || hasPrev) && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-muted-foreground">
            {offset + 1}–{offset + data.logs.length} of {data.total}
          </span>
          <div className="flex gap-1">
            {hasPrev && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                Prev
              </Button>
            )}
            {hasMore && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setOffset(offset + LIMIT)}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KeyRow({
  apiKey,
  now,
  onDelete,
  deleteIsPending,
}: {
  apiKey: ApiKey;
  now: number;
  onDelete: (id: string) => void;
  deleteIsPending: boolean;
}) {
  const [showActivity, setShowActivity] = useState(false);

  const expiringSoon =
    apiKey.expiresAt &&
    apiKey.expiresAt > new Date() &&
    apiKey.expiresAt.getTime() - now < SEVEN_DAYS_MS;

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between py-2 px-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <p className="text-sm font-medium">{apiKey.name}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {apiKey.prefix}...
            </p>
          </div>
          <ScopeBadges scopes={apiKey.scopes} />
          <Badge variant="secondary" className="text-[10px]">
            {apiKey.createdAt.toLocaleDateString()}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {apiKey.lastUsedAt
              ? `Used ${apiKey.lastUsedAt.toLocaleDateString()}`
              : "Never used"}
          </Badge>
          {apiKey.expiresAt && (
            <Badge
              variant={expiringSoon ? "destructive" : "outline"}
              className="text-[10px] gap-1"
            >
              {expiringSoon && <AlertTriangle className="size-2.5" />}
              Expires {apiKey.expiresAt.toLocaleDateString()}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground gap-1"
            onClick={() => setShowActivity((v) => !v)}
          >
            <Activity className="size-3" />
            {showActivity ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(apiKey.id)}
            disabled={deleteIsPending}
          >
            {deleteIsPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
      {showActivity && (
        <div className="border-t border-border px-3 pb-3">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide pt-2 pb-1">
            Recent Activity
          </p>
          <KeyActivityPanel keyId={apiKey.id} />
        </div>
      )}
    </div>
  );
}

export function ApiKeys() {
  const { data: keys, isLoading } = useApiKeys();
  const createMutation = useCreateApiKey();
  const deleteMutation = useDeleteApiKey();
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiry, setNewKeyExpiry] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<"full" | "custom">("full");
  const [customScopes, setCustomScopes] = useState<string[]>([]);

  // eslint-disable-next-line react-hooks/purity -- stable snapshot for expiry badge display
  const now = Date.now();

  const toggleScope = (scope: string) => {
    setCustomScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const createKey = () => {
    if (!newKeyName.trim()) return;
    const scopes = scopeMode === "full" ? ["*"] : customScopes;
    if (scopeMode === "custom" && scopes.length === 0) {
      toast.error("Select at least one scope");
      return;
    }
    createMutation.mutate(
      {
        name: newKeyName.trim(),
        expires_at: newKeyExpiry || undefined,
        scopes,
      },
      {
        onSuccess: (data) => {
          setNewlyCreatedKey(data.key);
          setNewKeyName("");
          setNewKeyExpiry("");
          setScopeMode("full");
          setCustomScopes([]);
          setShowCreate(false);
          toast.success(`API key "${newKeyName.trim()}" created`);
        },
        onError: () => {
          toast.error("Failed to create API key");
        },
      },
    );
  };

  const deleteKey = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        toast.success("API key deleted");
      },
      onError: () => {
        toast.error("Failed to delete API key");
      },
    });
  };

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(`${label} copied`);
    setTimeout(() => setCopied(null), 2000);
  };

  const hostedConfig = JSON.stringify(
    {
      mcpServers: {
        "context-vault": {
          url: "https://api.context-vault.com/mcp",
          headers: {
            Authorization: "Bearer YOUR_API_KEY",
          },
        },
      },
    },
    null,
    2,
  );

  const copyConfig = () => copyToClipboard(hostedConfig, "Config");

  // Min date for the expiry picker = tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your API keys for connecting Context Vault to Claude Code and
          other tools.
        </p>
      </div>

      {newlyCreatedKey && (
        <Card className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
          <CardContent className="pt-4 space-y-2">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              Your new API key (copy it now — it won't be shown again):
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white dark:bg-black/20 px-3 py-2 rounded text-xs font-mono border border-green-300 dark:border-green-700 break-all">
                {newlyCreatedKey}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => copyToClipboard(newlyCreatedKey, "API key")}
              >
                {copied === "API key" ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => setNewlyCreatedKey(null)}
            >
              I've saved it
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Your Keys</CardTitle>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="size-3.5" />
            Create New Key
          </Button>
        </CardHeader>
        <CardContent>
          {showCreate && (
            <div className="flex flex-col gap-3 mb-4 pb-4 border-b border-border">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="keyName" className="text-xs">
                    Key name
                  </Label>
                  <Input
                    id="keyName"
                    placeholder="e.g. Development, Production"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createKey()}
                    disabled={createMutation.isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="keyExpiry" className="text-xs">
                    Expires (optional)
                  </Label>
                  <Input
                    id="keyExpiry"
                    type="date"
                    min={minDate}
                    value={newKeyExpiry}
                    onChange={(e) => setNewKeyExpiry(e.target.value)}
                    disabled={createMutation.isPending}
                    className="w-40"
                  />
                </div>
              </div>

              {/* Scope selection */}
              <div className="space-y-2">
                <Label className="text-xs">Permissions</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setScopeMode("full")}
                    className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                      scopeMode === "full"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Full access
                  </button>
                  <button
                    type="button"
                    onClick={() => setScopeMode("custom")}
                    className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                      scopeMode === "custom"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Custom scopes
                  </button>
                </div>
                {scopeMode === "custom" && (
                  <div className="grid grid-cols-1 gap-2 pt-1">
                    {SCOPE_OPTIONS.map(({ value, label, description }) => (
                      <label
                        key={value}
                        className="flex items-center gap-2.5 cursor-pointer group"
                      >
                        <Checkbox
                          checked={customScopes.includes(value)}
                          onCheckedChange={() => toggleScope(value)}
                          disabled={createMutation.isPending}
                        />
                        <span className="text-xs font-mono">{label}</span>
                        <span className="text-xs text-muted-foreground">
                          — {description}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={createKey}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    "Create"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowCreate(false);
                    setNewKeyExpiry("");
                    setScopeMode("full");
                    setCustomScopes([]);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 rounded-lg bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : !keys || keys.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No API keys yet. Create one to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {keys.map((key) => (
                <KeyRow
                  key={key.id}
                  apiKey={key}
                  now={now}
                  onDelete={deleteKey}
                  deleteIsPending={deleteMutation.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Setup Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add this configuration to your Claude Code MCP settings to connect:
          </p>
          <div className="relative">
            <pre className="bg-muted p-4 rounded-lg text-xs font-mono overflow-x-auto">
              {hostedConfig}
            </pre>
            <Button
              variant="outline"
              size="sm"
              className="absolute top-2 right-2 gap-1.5 text-xs"
              onClick={copyConfig}
            >
              {copied === "Config" ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Replace <code className="font-mono">YOUR_API_KEY</code> with a key
            from above.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
