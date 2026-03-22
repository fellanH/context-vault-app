import { useState } from "react";
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
      </div>

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
