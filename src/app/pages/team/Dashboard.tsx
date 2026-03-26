import { useState, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Users,
  UserPlus,
  Trash2,
  Loader2,
  Database,
  ArrowRight,
  BookOpen,
  Contact,
  Terminal,
  Copy,
  Check,
  CheckCircle2,
  Circle,
  Lightbulb,
  X,
  Sparkles,
  TrendingUp,
  Flame,
} from "lucide-react";
import {
  useTeam,
  useInviteMember,
  useRemoveMember,
  useTeamVaultStatus,
} from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { toast } from "sonner";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2 font-mono text-xs">
      <code className="flex-1 break-all select-all">{value}</code>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        onClick={handleCopy}
        aria-label="Copy to clipboard"
      >
        {copied ? (
          <Check className="size-3 text-emerald-500" />
        ) : (
          <Copy className="size-3" />
        )}
      </Button>
    </div>
  );
}

interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  command: string | ((teamId: string) => string);
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "install",
    label: "Install context-vault",
    description: "Install the CLI globally via npm",
    command: "npm install -g context-vault",
  },
  {
    id: "connect",
    label: "Connect to hosted API",
    description: "Link your CLI to the hosted vault service",
    command: "context-vault remote setup",
  },
  {
    id: "join",
    label: "Join this team",
    description: "Connect your local vault to this team",
    command: (teamId: string) => `context-vault team join ${teamId}`,
  },
  {
    id: "verify",
    label: "Verify connection",
    description: "Check that everything is working",
    command: "context-vault team status",
  },
];

function getOnboardingState(teamId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(`cv-team-onboard-${teamId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setOnboardingStepDone(teamId: string, stepId: string) {
  const state = getOnboardingState(teamId);
  state[stepId] = true;
  localStorage.setItem(`cv-team-onboard-${teamId}`, JSON.stringify(state));
}

function OnboardingWizard({ teamId }: { teamId: string }) {
  const [state, setState] = useState(() => getOnboardingState(teamId));

  const completedCount = ONBOARDING_STEPS.filter((s) => state[s.id]).length;
  const allDone = completedCount === ONBOARDING_STEPS.length;

  const handleMarkDone = useCallback(
    (stepId: string) => {
      setOnboardingStepDone(teamId, stepId);
      setState(getOnboardingState(teamId));
    },
    [teamId],
  );

  if (allDone) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-primary/20 bg-primary/5">
        <CheckCircle2 className="size-4 text-primary shrink-0" />
        <span className="text-sm font-medium text-primary">Setup complete</span>
        <span className="text-xs text-muted-foreground ml-1">
          All {ONBOARDING_STEPS.length} steps done
        </span>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <CardTitle className="text-base">Welcome! Set up your CLI</CardTitle>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${(completedCount / ONBOARDING_STEPS.length) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {completedCount} of {ONBOARDING_STEPS.length}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {ONBOARDING_STEPS.map((step, idx) => {
            const done = !!state[step.id];
            const cmd =
              typeof step.command === "function"
                ? step.command(teamId)
                : step.command;
            return (
              <div key={step.id} className="space-y-2">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => !done && handleMarkDone(step.id)}
                    className="mt-0.5 shrink-0"
                    aria-label={done ? `Step ${idx + 1} complete` : `Mark step ${idx + 1} as done`}
                  >
                    {done ? (
                      <CheckCircle2 className="size-5 text-primary" />
                    ) : (
                      <Circle className="size-5 text-muted-foreground hover:text-primary transition-colors" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${done ? "line-through text-muted-foreground" : ""}`}>
                      {idx + 1}. {step.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {step.description}
                    </p>
                    {!done && (
                      <div className="mt-2">
                        <CopyBlock value={cmd} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function isTipsDismissed(teamId: string): boolean {
  return localStorage.getItem(`cv-team-tips-${teamId}-dismissed`) === "true";
}

function dismissTips(teamId: string) {
  localStorage.setItem(`cv-team-tips-${teamId}-dismissed`, "true");
}

function GettingStartedTips({ teamId }: { teamId: string }) {
  const [dismissed, setDismissed] = useState(() => isTipsDismissed(teamId));

  if (dismissed) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="size-4 text-amber-500" />
            <CardTitle className="text-base">Getting Started</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => {
              dismissTips(teamId);
              setDismissed(true);
            }}
            aria-label="Dismiss tips"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Your team vault is empty. Here are some ways to get started:
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Seed from your personal vault</p>
            <p className="text-xs text-muted-foreground">
              Publish entries from your local vault to the team
            </p>
            <CopyBlock value={`context-vault publish --team ${teamId}`} />
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Invite your first teammate</p>
              <p className="text-xs text-muted-foreground">
                Share knowledge with your colleagues
              </p>
            </div>
            <Button variant="outline" size="sm" asChild className="text-xs shrink-0">
              <a href="#invite-section">
                <UserPlus className="size-3 mr-1.5" />
                Invite
              </a>
            </Button>
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Browse team vault</p>
              <p className="text-xs text-muted-foreground">
                See what your team has shared
              </p>
            </div>
            <Button variant="outline" size="sm" asChild className="text-xs shrink-0">
              <Link to={`/team/${teamId}/vault`}>
                <Database className="size-3 mr-1.5" />
                Browse
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TeamDashboard() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: team, isLoading } = useTeam(id || null);
  const inviteMember = useInviteMember();
  const removeMember = useRemoveMember();
  const { data: vaultStatus } = useTeamVaultStatus(id || null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [showInvite, setShowInvite] = useState(false);

  const isOwnerOrAdmin = team?.role === "owner" || team?.role === "admin";

  const byCategory = vaultStatus?.entries.by_category ?? {};
  const knowledgeCount = byCategory["knowledge"] ?? 0;
  const entityCount = byCategory["entity"] ?? 0;
  const totalRecalls = vaultStatus?.recall_stats?.total_recalls ?? 0;
  const recallMembers = vaultStatus?.recall_stats?.distinct_members ?? 0;
  const hotSpots = vaultStatus?.hot_spots ?? [];

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !inviteEmail.trim() || !EMAIL_REGEX.test(inviteEmail)) return;

    inviteMember.mutate(
      { teamId: id, email: inviteEmail.trim() },
      {
        onSuccess: (data) => {
          toast.success(`Invite sent to ${data.email}`);
          setInviteEmail("");
        },
        onError: (err) => {
          toast.error(err.message || "Failed to send invite");
        },
      },
    );
  };

  const handleRemove = (memberId: string, email: string) => {
    if (!id) return;
    if (!confirm(`Remove ${email} from the team?`)) return;

    removeMember.mutate(
      { teamId: id, memberId },
      {
        onSuccess: () => toast.success(`${email} removed from team`),
        onError: (err) => toast.error(err.message || "Failed to remove member"),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Team not found</p>
        <Link
          to="/"
          className="text-sm text-primary hover:underline mt-2 inline-block"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{team.name}</h1>
          <p className="text-sm text-muted-foreground">
            Your role:{" "}
            <Badge variant="outline" className="ml-1">
              {team.role}
            </Badge>
          </p>
        </div>
        {isOwnerOrAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInvite(!showInvite)}
          >
            <UserPlus className="size-4 mr-1.5" />
            Invite
          </Button>
        )}
      </div>

      {/* Invite Form */}
      {showInvite && isOwnerOrAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Invite Member</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                disabled={
                  !inviteEmail.trim() ||
                  !EMAIL_REGEX.test(inviteEmail) ||
                  inviteMember.isPending
                }
              >
                {inviteMember.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Send Invite"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Members
              </CardTitle>
              <Users className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">{team.members.length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Vault Entries
              </CardTitle>
              <Database className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">
              {vaultStatus?.entries.total ?? 0}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Knowledge
              </CardTitle>
              <BookOpen className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">{knowledgeCount}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Entities
              </CardTitle>
              <Contact className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">{entityCount}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Total Recalls
              </CardTitle>
              <TrendingUp className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">{totalRecalls}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Recalling
              </CardTitle>
              <Users className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">{recallMembers}</span>
            <span className="text-xs text-muted-foreground ml-1">members</span>
          </CardContent>
        </Card>
      </div>

      {/* Hot Spots */}
      {hotSpots.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Flame className="size-4 text-orange-500" />
              <CardTitle className="text-base">Hot Spots</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Most recalled entries across the team
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {hotSpots.slice(0, 5).map((spot) => (
                <div
                  key={spot.id}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{spot.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px]">
                        {spot.kind}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {spot.distinct_members} member{spot.distinct_members !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-sm font-medium text-orange-500 tabular-nums shrink-0">
                    <Flame className="size-3.5" />
                    {spot.recall_count}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Browse vault link */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="flex flex-col justify-center">
          <CardContent className="pt-6">
            <Link to={`/team/${id}/vault`}>
              <Button variant="outline" className="w-full">
                <Database className="size-4 mr-2" />
                Browse Team Vault
                <ArrowRight className="size-4 ml-auto" />
              </Button>
            </Link>
          </CardContent>
        </Card>
        <Card className="flex flex-col justify-center">
          <CardContent className="pt-6">
            <Link to={`/team/${id}/browse`}>
              <Button variant="outline" className="w-full">
                <TrendingUp className="size-4 mr-2" />
                Search &amp; Hot Spots
                <ArrowRight className="size-4 ml-auto" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* CLI Setup / Onboarding Wizard */}
      {isOwnerOrAdmin ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">Setup CLI</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Run these commands to connect your local vault to this team.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">1. Install or update context-vault</p>
                <CopyBlock value="npx context-vault setup" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">2. Connect to the hosted API</p>
                <CopyBlock value="context-vault remote setup" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">3. Join this team</p>
                <CopyBlock value={`context-vault team join ${id}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <OnboardingWizard teamId={id!} />
      )}

      {/* Getting Started Tips — owners only, vault < 5 entries */}
      {isOwnerOrAdmin && (vaultStatus?.entries.total ?? 0) < 5 && id && (
        <GettingStartedTips teamId={id} />
      )}

      {/* Members List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Members ({team.members.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {team.members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium shrink-0">
                    {(member.name || member.email)[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {member.name || member.email}
                      {member.userId === user?.id && (
                        <span className="text-xs text-muted-foreground ml-1">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {member.email}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {member.role}
                  </Badge>
                </div>
                {isOwnerOrAdmin &&
                  member.role !== "owner" &&
                  member.userId !== user?.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(member.id, member.email)}
                      disabled={removeMember.isPending}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Pending Invites */}
      {isOwnerOrAdmin && team.invites.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pending Invites</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {team.invites
                .filter((inv) => inv.status === "pending")
                .map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between py-2 border-b border-border last:border-0"
                  >
                    <div>
                      <p className="text-sm">{invite.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Expires{" "}
                        {invite.expiresAt.toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      {invite.status}
                    </Badge>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
