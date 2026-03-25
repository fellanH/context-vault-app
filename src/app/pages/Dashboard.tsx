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
import { useEntries, useUsage, useApiKeys, useTeams, useTeamVaultStatus, type Team } from "../lib/hooks";
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
  ScrollText,
  RotateCcw,
  Users,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import changelogData from "../../data/changelog.json";

const WHATS_NEW_KEY = "cv-whats-new-dismissed";
const LATEST_VERSION = changelogData[0]?.version ?? "";

function isWhatsNewDismissed(): boolean {
  return localStorage.getItem(WHATS_NEW_KEY) === LATEST_VERSION;
}

function dismissWhatsNew(): void {
  localStorage.setItem(WHATS_NEW_KEY, LATEST_VERSION);
}

const STEP_ICONS: Record<string, React.ElementType> = {
  "create-api-key": Key,
  "install-cli": Zap,
  "run-setup": Link2,
  "connect-hosted": Link2,
  "install-extension": ExternalLink,
  "sync-vault": Upload,
};

const MCP_JSON_SNIPPET = `{
  "mcpServers": {
    "context-vault": {
      "command": "context-vault",
      "args": ["serve"],
      "env": {}
    }
  }
}`;

const CLI_COMMANDS = {
  install: "npm install -g context-vault",
  setup: "context-vault setup",
  remoteSetup: "context-vault remote setup",
  remoteSync: "context-vault remote sync",
} as const;

function TeamRow({ team }: { team: Team }) {
  const { data: vaultStatus } = useTeamVaultStatus(team.id);
  return (
    <Link
      to={`/team/${team.id}`}
      className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-medium shrink-0">
          {team.name[0]?.toUpperCase() ?? "T"}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{team.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline" className="text-[10px]">{team.role}</Badge>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0 ml-3">
        <div className="text-right">
          <p className="text-sm font-medium">{vaultStatus?.entries.total ?? "-"}</p>
          <p className="text-[10px] text-muted-foreground">entries</p>
        </div>
        <ArrowRight className="size-4 text-muted-foreground" />
      </div>
    </Link>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    data: entriesData,
    isLoading: entriesLoading,
    isError: entriesError,
  } = useEntries({
    limit: 10,
  });
  const { data: recallData, isLoading: recallLoading } = useEntries({
    limit: 100,
  });
  const { data: usage, isLoading: usageLoading, isError: usageError } = useUsage();
  const { data: apiKeys } = useApiKeys();

  const entriesUsed = usage?.entries.used ?? 0;
  const hasMcpActivity = (apiKeys ?? []).some((key) => Boolean(key.lastUsedAt));
  const mcpCallsToday = usage?.requestsToday.used ?? 0;
  const mcpCallsThisWeek = usage?.requestsThisWeek.used ?? 0;

  const [onboardingMode, setOnboardingModeState] =
    useState<OnboardingMode | null>(() => getOnboardingMode());

  const steps =
    onboardingMode === "migration"
      ? getMigrationSteps({ entriesUsed, hasMcpActivity })
      : getOnboardingSteps({ entriesUsed, hasMcpActivity });

  const [showOnboarding, setShowOnboarding] = useState(
    () => !isOnboardingDismissed(),
  );
  const [showWhatsNew, setShowWhatsNew] = useState(
    () => !isWhatsNewDismissed(),
  );
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [, setExtensionInstalled] = useState(false);

  const allComplete = steps.every((s) => s.completed);
  const completedCount = steps.filter((s) => s.completed).length;
  const totalRequired = steps.length;

  const isConnected = allComplete || hasMcpActivity;

  const handleDismiss = () => {
    dismissOnboarding();
    setShowOnboarding(false);
  };

  const copyCommand = async (cmd: string) => {
    await navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    toast.success("Command copied");
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const handleStepAction = (step: (typeof steps)[0]) => {
    if (step.action === "copy-install-command") {
      copyCommand(CLI_COMMANDS.install);
    } else if (step.action === "copy-setup-command") {
      copyCommand(CLI_COMMANDS.setup);
    } else if (step.action === "copy-remote-setup-command") {
      copyCommand(CLI_COMMANDS.remoteSetup);
    } else if (step.action === "copy-sync-command") {
      copyCommand(CLI_COMMANDS.remoteSync);
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

  // Recall Stats
  const allEntries = recallData?.entries ?? [];
  const recalledEntries = allEntries.filter((e) => (e.recallCount ?? 0) > 0);
  const totalRecalls = recalledEntries.reduce(
    (sum, e) => sum + (e.recallCount ?? 0),
    0,
  );
  const topRecalled = recalledEntries
    .slice()
    .sort((a, b) => (b.recallCount ?? 0) - (a.recallCount ?? 0))
    .slice(0, 5);
  const hasRecallData = recalledEntries.length > 0;

  const recallDistribution = (() => {
    const buckets = [
      { label: "0", min: 0, max: 0, count: 0 },
      { label: "1-5", min: 1, max: 5, count: 0 },
      { label: "6-20", min: 6, max: 20, count: 0 },
      { label: "21-50", min: 21, max: 50, count: 0 },
      { label: "51+", min: 51, max: Infinity, count: 0 },
    ];
    for (const e of allEntries) {
      const rc = e.recallCount ?? 0;
      const bucket = buckets.find((b) => rc >= b.min && rc <= b.max);
      if (bucket) bucket.count++;
    }
    return buckets;
  })();
  const maxBucketCount = Math.max(...recallDistribution.map((b) => b.count), 1);

  const { data: teams, isLoading: teamsLoading } = useTeams();

  const entries = entriesData?.entries ?? [];
  const firstName = user?.name ? user.name.split(" ")[0] : null;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">
            {firstName ? `Welcome, ${firstName}` : "Dashboard"}
          </h1>
          {hasMcpActivity && (
            <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
              <span className="size-1.5 rounded-full bg-green-500" />
              Connected
            </span>
          )}
        </div>
        {!isConnected && (
          <p className="text-sm text-muted-foreground mt-1">
            Get started by completing the steps below.
          </p>
        )}
      </div>

      {/* What's New banner */}
      {showWhatsNew && (
        <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <ScrollText className="size-4 text-primary flex-shrink-0" />
            <div>
              <span className="text-sm font-medium">
                What&apos;s new in v{LATEST_VERSION}
              </span>
              <span className="text-sm text-muted-foreground ml-2">
                : {changelogData[0]?.title}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4 flex-shrink-0">
            <Button variant="outline" size="sm" asChild className="text-xs h-7">
              <Link to="/changelog">See what changed</Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => {
                dismissWhatsNew();
                setShowWhatsNew(false);
              }}
              aria-label="Dismiss what's new"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {(usageError || entriesError) && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <span className="text-sm text-destructive">
            Failed to load some dashboard data. Check your connection and refresh.
          </span>
          <button
            onClick={() => window.location.reload()}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            Refresh
          </button>
        </div>
      )}

      {/* ── New user layout ── */}
      {!isConnected && (
        <>
          {/* Onboarding card (full width) */}
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
                    aria-label="Dismiss getting started"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {onboardingMode === null ? (
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
                          I&apos;m new, set me up from scratch
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
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
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
                                {step.action?.startsWith("copy-") &&
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
                            {!step.completed && step.action === "copy-install-command" && (
                              <pre className="bg-muted p-2 rounded text-[10px] font-mono overflow-x-auto">
                                {CLI_COMMANDS.install}
                              </pre>
                            )}
                            {!step.completed && step.action === "copy-setup-command" && (
                              <>
                                <pre className="bg-muted p-2 rounded text-[10px] font-mono overflow-x-auto">
                                  {CLI_COMMANDS.setup}
                                </pre>
                                <details className="group">
                                  <summary className="text-[10px] cursor-pointer list-none flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                                    <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                                    Manual MCP config (JSON)
                                  </summary>
                                  <pre className="mt-1.5 bg-muted p-2 rounded text-[10px] font-mono overflow-x-auto">
                                    {MCP_JSON_SNIPPET}
                                  </pre>
                                </details>
                              </>
                            )}
                            {!step.completed && step.action === "copy-remote-setup-command" && (
                              <pre className="bg-muted p-2 rounded text-[10px] font-mono overflow-x-auto">
                                {CLI_COMMANDS.remoteSetup}
                              </pre>
                            )}
                            {!step.completed && step.action === "copy-sync-command" && (
                              <pre className="bg-muted p-2 rounded text-[10px] font-mono overflow-x-auto">
                                {CLI_COMMANDS.remoteSync}
                              </pre>
                            )}
                          </div>
                        );
                      })}
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
          )}

          {/* Show getting started link when dismissed but not complete */}
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
        </>
      )}

      {/* Usage Overview (always visible) */}
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

      {/* ── Connected user layout ── */}
      {isConnected && (
        <>
          {/* Row 1: Recent Activity + MCP Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recent Activity */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Recent Activity</CardTitle>
                  {entries.length > 0 && (
                    <Button variant="ghost" size="sm" asChild className="text-xs h-7">
                      <Link to="/vault/knowledge">View all</Link>
                    </Button>
                  )}
                </div>
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

            {/* MCP Activity */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    MCP Activity
                  </CardTitle>
                  <Zap className="size-3.5 text-muted-foreground ml-auto" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-2xl font-semibold">
                      {usageLoading ? (
                        <span className="inline-block h-7 w-10 bg-muted rounded animate-pulse" />
                      ) : (
                        mcpCallsToday
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Today</p>
                  </div>
                  <div className="w-px h-8 bg-border" />
                  <div>
                    <p className="text-2xl font-semibold">
                      {usageLoading ? (
                        <span className="inline-block h-7 w-10 bg-muted rounded animate-pulse" />
                      ) : (
                        mcpCallsThisWeek
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      This week
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Teams + Recall Tracking */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Your Teams */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">Your Teams</CardTitle>
                    <Users className="size-4 text-muted-foreground" />
                  </div>
                  {(teams ?? []).length > 0 && (
                    <Button variant="ghost" size="sm" asChild className="text-xs h-7">
                      <Link to="/team/new">
                        <Plus className="size-3 mr-1" />
                        New team
                      </Link>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {teamsLoading ? (
                  <div className="space-y-3 py-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-12 bg-muted rounded animate-pulse" />
                    ))}
                  </div>
                ) : (teams ?? []).length === 0 ? (
                  <div className="text-center py-6 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Create a team to share knowledge with your colleagues
                    </p>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/team/new">
                        <Plus className="size-4 mr-1.5" />
                        Create a team
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {(teams ?? []).map((team) => (
                      <TeamRow key={team.id} team={team} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recall Tracking */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">Recall Tracking</CardTitle>
                    <RotateCcw className="size-4 text-muted-foreground" />
                  </div>
                  {!hasRecallData && !recallLoading && (
                    <Badge variant="outline" className="text-[10px]">
                      Awaiting data
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {recallLoading ? (
                  <div className="space-y-3 py-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-4 w-48 bg-muted rounded animate-pulse" />
                    ))}
                  </div>
                ) : !hasRecallData ? (
                  <p className="text-sm text-muted-foreground py-4">
                    Recall data appears after your first agent session.
                  </p>
                ) : (
                  <div className="space-y-5">
                    {/* Summary stats */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center p-3 rounded-lg bg-muted/50">
                        <p className="text-2xl font-semibold">{totalRecalls}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Total recalls
                        </p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-muted/50">
                        <p className="text-2xl font-semibold">
                          {recalledEntries.length}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Entries recalled
                        </p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-muted/50">
                        <p className="text-2xl font-semibold">
                          {allEntries.length > 0
                            ? `${Math.round((recalledEntries.length / allEntries.length) * 100)}%`
                            : "0%"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Recall rate
                        </p>
                      </div>
                    </div>

                    {/* Distribution bar chart */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        Recall distribution
                      </p>
                      <div className="flex items-end gap-2 h-20">
                        {recallDistribution.map((bucket) => (
                          <div
                            key={bucket.label}
                            className="flex-1 flex flex-col items-center gap-1"
                          >
                            <span className="text-[10px] text-muted-foreground">
                              {bucket.count}
                            </span>
                            <div
                              className="w-full bg-primary/20 rounded-t transition-all"
                              style={{
                                height: `${Math.max((bucket.count / maxBucketCount) * 56, 2)}px`,
                              }}
                            >
                              <div
                                className="w-full bg-primary rounded-t"
                                style={{
                                  height: `${Math.max((bucket.count / maxBucketCount) * 56, 2)}px`,
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {bucket.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Top recalled entries */}
                    {topRecalled.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">
                          Most recalled entries
                        </p>
                        <div className="space-y-1.5">
                          {topRecalled.map((entry) => (
                            <div
                              key={entry.id}
                              className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm truncate">{entry.title}</span>
                                <Badge variant="secondary" className="text-[10px] shrink-0">
                                  {entry.kind}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3 shrink-0 ml-3">
                                <span className="text-sm font-medium">
                                  {entry.recallCount}
                                </span>
                                {entry.lastRecalledAt && (
                                  <span className="text-xs text-muted-foreground">
                                    {formatRelativeTime(entry.lastRecalledAt)}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

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
        </>
      )}
    </div>
  );
}
