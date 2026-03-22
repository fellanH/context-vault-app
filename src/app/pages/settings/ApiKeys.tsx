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
  Copy,
  Check,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  Info,
} from "lucide-react";
import {
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
} from "../../lib/hooks";
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
  const [fullAccess, setFullAccess] = useState(true);
  const [customScopes, setCustomScopes] = useState<string[]>([]);

  const now = Date.now();

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
