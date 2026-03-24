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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  Copy,
  Check,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  Info,
  Activity,
  Shield,
  Zap,
} from "lucide-react";
import {
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  useRawUsage,
} from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import type { ApiKey } from "../../lib/types";
import { toast } from "sonner";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const SCOPE_OPTIONS = [
  {
    value: "vault:read",
    label: "vault:read",
    description: "Read entries, search, and check vault status",
  },
  {
    value: "vault:write",
    label: "vault:write",
    description: "Create, update, and delete vault entries",
  },
  {
    value: "vault:export",
    label: "vault:export",
    description: "Export all vault data to a file",
  },
  {
    value: "mcp",
    label: "mcp",
    description: "Access the MCP endpoint for Claude Code integration",
  },
  {
    value: "keys:read",
    label: "keys:read",
    description: "List and inspect your API keys (read-only)",
  },
] as const;

const RATE_LIMITS: Record<string, { requestsPerDay: string; requestsPerMin: string; entries: string }> = {
  free: { requestsPerDay: "200 / day", requestsPerMin: "~3 / min", entries: "1,000" },
  pro: { requestsPerDay: "Unlimited", requestsPerMin: "Unlimited", entries: "Unlimited" },
  team: { requestsPerDay: "Unlimited", requestsPerMin: "Unlimited", entries: "Unlimited" },
};

function ScopeBadges({ scopes }: { scopes: string[] }) {
  if (scopes.includes("*")) {
    return (
      <Badge variant="secondary" className="text-[10px]">
        Full access
      </Badge>
    );
  }
  const readOnly = scopes.every((s) => s.endsWith(":read") || s === "keys:read");
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {readOnly && (
        <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-600 dark:text-blue-400">
          Read-only
        </Badge>
      )}
      {!readOnly &&
        scopes.map((s) => (
          <Badge key={s} variant="outline" className="text-[10px] font-mono">
            {s}
          </Badge>
        ))}
    </div>
  );
}

function formatRelativeDate(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function KeyRow({
  apiKey,
  now,
  onDelete,
}: {
  apiKey: ApiKey;
  now: number;
  onDelete: (id: string, name: string) => void;
}) {
  const expiringSoon =
    apiKey.expiresAt &&
    apiKey.expiresAt > new Date() &&
    apiKey.expiresAt.getTime() - now < SEVEN_DAYS_MS;

  const expired = apiKey.expiresAt && apiKey.expiresAt <= new Date();

  return (
    <div className={`rounded-lg border ${expired ? "border-destructive/30 bg-destructive/5" : "border-border"}`}>
      <div className="flex items-center justify-between py-3 px-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium truncate">{apiKey.name}</p>
            {expired && (
              <Badge variant="destructive" className="text-[10px]">
                Expired
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <code className="text-xs text-muted-foreground font-mono">
              {apiKey.prefix}...
            </code>
            <ScopeBadges scopes={apiKey.scopes} />
          </div>
        </div>

        <div className="flex items-center gap-4 ml-4 shrink-0">
          {/* Stats */}
          <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1">
                  <Activity className="size-3" />
                  <span className="tabular-nums">{apiKey.requestCount.toLocaleString()}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {apiKey.requestCount.toLocaleString()} total requests
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  {apiKey.lastUsedAt
                    ? formatRelativeDate(apiKey.lastUsedAt)
                    : "Never used"}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {apiKey.lastUsedAt
                  ? `Last used: ${apiKey.lastUsedAt.toLocaleString()}`
                  : "This key has never been used"}
              </TooltipContent>
            </Tooltip>

            <span className="text-muted-foreground/50">
              {apiKey.createdAt.toLocaleDateString()}
            </span>
          </div>

          {expiringSoon && !expired && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="size-3.5 text-amber-500" />
              </TooltipTrigger>
              <TooltipContent>
                Expires {apiKey.expiresAt!.toLocaleDateString()}
              </TooltipContent>
            </Tooltip>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(apiKey.id, apiKey.name)}
            aria-label={`Revoke API key ${apiKey.name}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Mobile stats row */}
      <div className="sm:hidden flex items-center gap-3 px-4 pb-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Activity className="size-3" />
          <span>{apiKey.requestCount.toLocaleString()} requests</span>
        </div>
        <span>
          {apiKey.lastUsedAt
            ? `Used ${formatRelativeDate(apiKey.lastUsedAt)}`
            : "Never used"}
        </span>
        <span>{apiKey.createdAt.toLocaleDateString()}</span>
      </div>
    </div>
  );
}

export function ApiKeys() {
  const { data: keys, isLoading } = useApiKeys();
  const { data: rawUsage } = useRawUsage();
  const { user } = useAuth();
  const createMutation = useCreateApiKey();
  const deleteMutation = useDeleteApiKey();
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiry, setNewKeyExpiry] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [fullAccess, setFullAccess] = useState(true);
  const [customScopes, setCustomScopes] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const now = Date.now();
  const tier = user?.tier || "free";
  const limits = RATE_LIMITS[tier] || RATE_LIMITS.free;

  const toggleScope = (scope: string) => {
    setCustomScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const handleFullAccessChange = (checked: boolean) => {
    setFullAccess(checked);
    if (checked) {
      setCustomScopes([]);
    }
  };

  const resetCreateForm = () => {
    setShowCreate(false);
    setNewKeyName("");
    setNewKeyExpiry("");
    setFullAccess(true);
    setCustomScopes([]);
  };

  const createKey = () => {
    if (!newKeyName.trim()) return;
    const scopes = fullAccess ? ["*"] : customScopes;
    if (!fullAccess && scopes.length === 0) {
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
          resetCreateForm();
          toast.success(`API key "${newKeyName.trim()}" created`);
        },
        onError: () => {
          toast.error("Failed to create API key");
        },
      },
    );
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success(`API key "${deleteTarget.name}" revoked`);
        setDeleteTarget(null);
      },
      onError: () => {
        toast.error("Failed to revoke API key");
        setDeleteTarget(null);
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

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  const totalRequests = keys?.reduce((sum, k) => sum + k.requestCount, 0) ?? 0;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your API keys for connecting Context Vault to Claude Code and
          other tools.
        </p>
      </div>

      {/* Rate limits and usage overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="size-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Rate Limit</span>
            </div>
            <p className="text-lg font-semibold tabular-nums">{limits.requestsPerDay}</p>
            <p className="text-[11px] text-muted-foreground">
              {rawUsage?.usage.requestsToday ?? 0} used today
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="size-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Requests</span>
            </div>
            <p className="text-lg font-semibold tabular-nums">{totalRequests.toLocaleString()}</p>
            <p className="text-[11px] text-muted-foreground">
              across {keys?.length ?? 0} key{(keys?.length ?? 0) !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="size-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Tier</span>
            </div>
            <p className="text-lg font-semibold capitalize">{tier}</p>
            <p className="text-[11px] text-muted-foreground">
              {limits.entries} entries max
            </p>
          </CardContent>
        </Card>
      </div>

      {newlyCreatedKey && (
        <Card className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
          <CardContent className="pt-4 space-y-2">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              Your new API key (copy it now, it won't be shown again):
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
                <div className="rounded-md border border-border divide-y divide-border">
                  <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors">
                    <Checkbox
                      checked={fullAccess}
                      onCheckedChange={(checked) =>
                        handleFullAccessChange(!!checked)
                      }
                      disabled={createMutation.isPending}
                    />
                    <span className="text-xs font-mono font-medium">*</span>
                    <span className="text-xs text-muted-foreground flex-1">
                      Full access, all current and future scopes
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3 text-muted-foreground/60 shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        Grants unrestricted access. Checking this disables
                        individual scope selection.
                      </TooltipContent>
                    </Tooltip>
                  </label>

                  {SCOPE_OPTIONS.map(({ value, label, description }) => (
                    <label
                      key={value}
                      className={`flex items-center gap-2.5 px-3 py-2 transition-colors ${
                        fullAccess
                          ? "opacity-40 cursor-not-allowed"
                          : "cursor-pointer hover:bg-muted/40"
                      }`}
                    >
                      <Checkbox
                        checked={!fullAccess && customScopes.includes(value)}
                        onCheckedChange={() =>
                          !fullAccess && toggleScope(value)
                        }
                        disabled={createMutation.isPending || fullAccess}
                      />
                      <span className="text-xs font-mono">{label}</span>
                      <span className="text-xs text-muted-foreground flex-1" />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="size-3 text-muted-foreground/60 shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          {description}
                        </TooltipContent>
                      </Tooltip>
                    </label>
                  ))}
                </div>
                {!fullAccess && customScopes.length === 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    Select at least one scope.
                  </p>
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
                <Button size="sm" variant="ghost" onClick={resetCreateForm}>
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
                  className="h-16 rounded-lg bg-muted animate-pulse"
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
                  onDelete={(id, name) => setDeleteTarget({ id, name })}
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

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.name}
              </span>
              . Any tools or integrations using this key will stop working
              immediately. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : null}
              Revoke Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
