import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { UsageMeter } from "../components/UsageMeter";
import { useEntries, useUsage, useApiKeys } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import {
  getOnboardingSteps,
  getMigrationSteps,
  isOnboardingDismissed,
  dismissOnboarding,
  resetOnboarding,
  markExtensionInstalled,
  getOnboardingMode,
  setOnboardingMode,
  type OnboardingMode,
} from "../lib/onboarding";
import { formatMegabytes, formatRelativeTime } from "../lib/format";
import {
  FileText,
  HardDrive,
  Zap,
  Key,
  Search,
  Plus,
  Upload,
  X,
  Copy,
  Check,
  ExternalLink,
  CircleCheck,
  Link2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

const STEP_ICONS: Record<string, React.ElementType> = {
  "connect-tools": Link2,
  "first-entry": Plus,
  "install-extension": ExternalLink,
  "import-local-vault": Upload,
  "switch-to-hosted-mcp": Link2,
};

const MCP_JSON_SNIPPET = `{
  "mcpServers": {
    "context-vault": {
      "command": "npx",
      "args": ["-y", "context-vault", "mcp"],
      "env": {
        "CV_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}`;

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: entriesData, isLoading: entriesLoading } = useEntries({
    limit: 10,
  });
  const { data: usage, isLoading: usageLoading } = useUsage();
  const { data: apiKeys } = useApiKeys();

  const entriesUsed = usage?.entries.used ?? 0;
  const hasMcpActivity = (apiKeys ?? []).some((key) => Boolean(key.lastUsedAt));

  const [onboardingMode, setOnboardingModeState] =
    useState<OnboardingMode | null>(() => getOnboardingMode());

  const steps =
    onboardingMode === "migration"
      ? getMigrationSteps({ entriesUsed, hasMcpActivity })
      : getOnboardingSteps({ entriesUsed, hasMcpActivity });

  const [showOnboarding, setShowOnboarding] = useState(
    () => !isOnboardingDismissed(),
  );
  const [copiedCmd, setCopiedCmd] = useState(false);
  // Used only to trigger re-render after markExtensionInstalled() writes to localStorage
  const [, setExtensionInstalled] = useState(false);
  const [showConnectGuide, setShowConnectGuide] = useState(false);

  const allComplete = steps.every((s) => s.completed);
  const completedCount = steps.filter((s) => s.completed).length;
  const totalRequired = steps.length;

  const handleDismiss = () => {
    dismissOnboarding();
    setShowOnboarding(false);
  };

  const connectCommand = "npx context-vault connect --key YOUR_API_KEY";

  const copyConnectCommand = async () => {
    await navigator.clipboard.writeText(connectCommand);
    setCopiedCmd(true);
    toast.success("Connect command copied");
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const handleStepAction = (step: (typeof steps)[0]) => {
    if (step.action === "copy-connect-command") {
      copyConnectCommand();
    } else if (step.action === "chrome-web-store-link") {
      window.open(
        "https://chromewebstore.google.com/detail/context-vault",
        "_blank",
      );
    } else if (step.action?.startsWith("/")) {
      navigate(step.action);
    }
  };

  const handleMarkExtensionInstalled = () => {
    markExtensionInstalled();
    setExtensionInstalled(true);
  };

  const handleSelectMode = (mode: OnboardingMode) => {
    setOnboardingMode(mode);
    setOnboardingModeState(mode);
  };

  const isUnlimited = (limit: number) => !Number.isFinite(limit);

  const usageCards = usage
    ? [
        {
          label: "Entries",
          icon: FileText,
          used: usage.entries.used,
          limit: usage.entries.limit,
          display: `${usage.entries.used}`,
          sub: isUnlimited(usage.entries.limit)
            ? null
            : `of ${usage.entries.limit}`,
        },
        {
          label: "Storage",
          icon: HardDrive,
          used: usage.storage.usedMb,
          limit: usage.storage.limitMb,
          display: `${formatMegabytes(usage.storage.usedMb)} MB`,
          sub: isUnlimited(usage.storage.limitMb)
            ? null
            : `of ${formatMegabytes(usage.storage.limitMb)} MB`,
        },
        {
          label: "Requests Today",
          icon: Zap,
          used: usage.requestsToday.used,
          limit: usage.requestsToday.limit,
          display: `${usage.requestsToday.used}`,
          sub: isUnlimited(usage.requestsToday.limit)
            ? null
            : `of ${usage.requestsToday.limit}`,
        },
        {
          label: "API Keys",
          icon: Key,
          used: apiKeys?.length ?? 0,
          limit: Infinity,
          display: `${apiKeys?.length ?? 0} active`,
          sub: null,
        },
      ]
    : [];

  const entries = entriesData?.entries ?? [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {allComplete
            ? "Welcome back. Here's your vault at a glance."
            : "Get started by completing the steps below."}
        </p>
      </div>

      {/* Onboarding Journey — hidden once dismissed or all steps complete */}
      {showOnboarding && !allComplete && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Getting Started</CardTitle>
                {onboardingMode !== null && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {completedCount} of {totalRequired} steps complete
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={handleDismiss}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {onboardingMode === null ? (
              /* Mode selector — shown before the user picks a path */
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  How are you setting up Context Vault?
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => handleSelectMode("new")}
                    className="text-left rounded-lg border border-border p-4 space-y-1.5 hover:border-primary/40 hover:bg-muted/40 transition-colors"
                  >
                    <p className="text-sm font-medium">
                      I&apos;m new — set me up from scratch
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Start fresh. We&apos;ll walk you through connecting your
                      AI tools.
                    </p>
                  </button>
                  <button
                    onClick={() => handleSelectMode("migration")}
                    className="text-left rounded-lg border border-border p-4 space-y-1.5 hover:border-primary/40 hover:bg-muted/40 transition-colors"
                  >
                    <p className="text-sm font-medium">
                      I use context-vault/core locally
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Already running core locally? Sync your vault and switch
                      to hosted MCP.
                    </p>
                  </button>
                </div>
              </div>
            ) : (
              /* Step grid — shown after mode is selected */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {steps.map((step) => {
                  const Icon = STEP_ICONS[step.id] || FileText;

                  return (
                    <div
                      key={step.id}
                      className={`relative rounded-lg border p-4 space-y-3 transition-colors ${
                        step.completed
                          ? "border-primary/20 bg-primary/5"
                          : "border-border hover:border-primary/30"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div
                          className={`rounded-full p-2 ${
                            step.completed
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {step.completed ? (
                            <CircleCheck className="size-4" />
                          ) : (
                            <Icon className="size-4" />
                          )}
                        </div>
                      </div>
                      <div>
                        <p
                          className={`text-sm font-medium ${step.completed ? "text-muted-foreground line-through" : ""}`}
                        >
                          {step.label}
                        </p>
                        {step.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {step.description}
                          </p>
                        )}
                      </div>
                      {!step.completed && step.action && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full gap-1.5 text-xs"
                          onClick={() => handleStepAction(step)}
                        >
                          {step.action === "copy-connect-command" &&
                            (copiedCmd ? (
                              <Check className="size-3" />
                            ) : (
                              <Copy className="size-3" />
                            ))}
                          {step.actionLabel || "Go"}
                        </Button>
                      )}
                      {!step.completed && step.id === "install-extension" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-xs text-muted-foreground"
                          onClick={handleMarkExtensionInstalled}
                        >
                          Mark as installed
                        </Button>
                      )}
                      {!step.completed &&
                        (step.id === "connect-tools" ||
                          step.id === "switch-to-hosted-mcp") && (
                          <pre className="bg-muted p-2 rounded text-[10px] font-mono overflow-x-auto">
                            {connectCommand}
                          </pre>
                        )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Connect AI Tools — always visible */}
      <Card>
        <CardContent className="pt-4">
          {hasMcpActivity && !showConnectGuide ? (
            /* Connected — compact row */
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CircleCheck className="size-4 text-green-500" />
                <span className="text-sm font-medium text-green-600 dark:text-green-400">
                  AI tools connected
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1"
                onClick={() => setShowConnectGuide(true)}
              >
                View setup guide
                <ChevronDown className="size-3" />
              </Button>
            </div>
          ) : (
            /* Full setup instructions */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-primary" />
                  <h3 className="text-sm font-semibold">Connect AI Tools</h3>
                </div>
                {hasMcpActivity && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs gap-1"
                    onClick={() => setShowConnectGuide(false)}
                  >
                    Collapse
                    <ChevronUp className="size-3" />
                  </Button>
                )}
              </div>

              <div className="space-y-4">
                {/* Step 1 */}
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center font-medium mt-0.5">
                    1
                  </span>
                  <div className="space-y-1.5">
                    <p className="text-sm">Get your API key</p>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="text-xs h-7"
                    >
                      <Link to="/settings/api-keys">
                        Open API Keys
                        <ExternalLink className="size-3 ml-1.5" />
                      </Link>
                    </Button>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center font-medium mt-0.5">
                    2
                  </span>
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <p className="text-sm">
                      Run this command in your terminal:
                    </p>
                    <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                      <code className="text-xs font-mono flex-1 truncate">
                        {connectCommand}
                      </code>
                      <button
                        onClick={copyConnectCommand}
                        className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Copy command"
                      >
                        {copiedCmd ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Step 3 — manual config */}
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center font-medium mt-0.5">
                    3
                  </span>
                  <div className="flex-1 min-w-0">
                    <details className="group">
                      <summary className="text-sm cursor-pointer list-none flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                        Or configure manually — Hosted MCP (JSON)
                      </summary>
                      <pre className="mt-2 bg-muted p-3 rounded-md text-[11px] font-mono overflow-x-auto">
                        {MCP_JSON_SNIPPET}
                      </pre>
                    </details>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Works with: <span className="text-foreground">Claude Code</span>{" "}
                · <span className="text-foreground">Cursor</span> ·{" "}
                <span className="text-foreground">Windsurf</span> ·{" "}
                <span className="text-foreground">Zed</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Show getting started guide link — visible when onboarding card is hidden but not all done */}
      {!showOnboarding && !allComplete && (
        <div className="text-center">
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              resetOnboarding();
              setShowOnboarding(true);
            }}
          >
            Show getting started guide
          </button>
        </div>
      )}

      {/* Usage Overview */}
      {usageLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="h-4 w-16 bg-muted rounded animate-pulse" />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-8 w-20 bg-muted rounded animate-pulse" />
                <div className="h-1.5 bg-muted rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {usageCards.map((card) => {
            const Icon = card.icon;
            const unlimited = isUnlimited(card.limit);
            const pct =
              !unlimited && card.limit > 0 ? (card.used / card.limit) * 100 : 0;
            const isWarning = !unlimited && pct >= 80;
            const isCritical = !unlimited && pct >= 100;

            return (
              <Card key={card.label}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      {card.label}
                    </CardTitle>
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`text-2xl font-semibold ${isCritical ? "text-red-500" : isWarning ? "text-amber-500" : ""}`}
                    >
                      {card.display}
                    </span>
                    {card.sub && (
                      <span className="text-xs text-muted-foreground">
                        {card.sub}
                      </span>
                    )}
                  </div>
                  {!unlimited && (
                    <UsageMeter used={card.used} limit={card.limit} />
                  )}
                  {isCritical && (
                    <Link
                      to="/settings/billing"
                      className="text-xs text-red-500 hover:underline"
                    >
                      Upgrade to increase limit
                    </Link>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {entriesLoading ? (
            <div className="space-y-3 py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-48 bg-muted rounded animate-pulse" />
                    <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                  </div>
                  <div className="h-4 w-12 bg-muted rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No entries yet. Save your first entry to see activity here.
            </p>
          ) : (
            <div className="space-y-2">
              {entries
                .slice()
                .sort((a, b) => b.created.getTime() - a.created.getTime())
                .slice(0, 10)
                .map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between py-2 border-b border-border last:border-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm font-medium truncate">
                        {entry.title}
                      </span>
                      <Badge
                        variant={
                          entry.category === "knowledge"
                            ? "default"
                            : entry.category === "entity"
                              ? "outline"
                              : "secondary"
                        }
                        className="text-[10px] shrink-0"
                      >
                        {entry.category}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className="text-[10px] shrink-0"
                      >
                        {entry.kind}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                      {formatRelativeTime(entry.created)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" asChild>
          <Link to="/search">
            <Search className="size-4 mr-1.5" />
            Search vault
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/vault/knowledge">
            <Plus className="size-4 mr-1.5" />
            New Entry
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/settings/data">
            <Upload className="size-4 mr-1.5" />
            Import data
          </Link>
        </Button>
      </div>
    </div>
  );
}
