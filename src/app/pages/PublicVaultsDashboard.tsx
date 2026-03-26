import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Globe,
  BookOpen,
  Users,
  TrendingUp,
  Loader2,
  Trash2,
  Plus,
  ArrowLeft,
  BarChart3,
  Copy,
  Check,
  Leaf,
  Archive,
  Sparkles,
  Terminal,
} from "lucide-react";
import {
  usePublicVault,
  usePublicVaultEntries,
  usePublicVaultStats,
  useCreatePublicVaultEntry,
  useUpdatePublicVaultEntry,
  useDeletePublicVaultEntry,
  useSeedPublicVault,
  useDeletePublicVault,
} from "../lib/hooks";
import type { PublicVaultEntry } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";

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

function EntryRow({
  entry,
  slug,
  isCurator,
}: {
  entry: PublicVaultEntry;
  slug: string;
  isCurator: boolean;
}) {
  const updateEntry = useUpdatePublicVaultEntry();
  const deleteEntry = useDeletePublicVaultEntry();

  const handleToggleEvergreen = () => {
    updateEntry.mutate(
      { slug, id: entry.id, is_evergreen: !entry.is_evergreen },
      {
        onSuccess: () =>
          toast.success(
            entry.is_evergreen ? "Removed evergreen flag" : "Marked as evergreen",
          ),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleDeprecate = () => {
    const newStatus = entry.status === "deprecated" ? "active" : "deprecated";
    updateEntry.mutate(
      { slug, id: entry.id, status: newStatus },
      {
        onSuccess: () =>
          toast.success(
            newStatus === "deprecated" ? "Entry deprecated" : "Entry restored",
          ),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleDelete = () => {
    if (!confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    deleteEntry.mutate(
      { slug, id: entry.id },
      {
        onSuccess: () => toast.success("Entry deleted"),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="flex items-start justify-between gap-3 py-3 border-b border-border last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{entry.title}</p>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {entry.kind}
          </Badge>
          {entry.status === "deprecated" && (
            <Badge variant="destructive" className="text-[10px] shrink-0">
              deprecated
            </Badge>
          )}
          {entry.is_evergreen && (
            <Leaf className="size-3 text-emerald-500 shrink-0" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
          {entry.body}
        </p>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
          <span>{entry.recall_count} recalls</span>
          <span>{entry.distinct_consumers} consumers</span>
          {entry.tags.length > 0 && (
            <span>{entry.tags.slice(0, 3).join(", ")}</span>
          )}
        </div>
      </div>
      {isCurator && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleToggleEvergreen}
            title={entry.is_evergreen ? "Remove evergreen" : "Mark evergreen"}
          >
            <Leaf
              className={`size-3.5 ${entry.is_evergreen ? "text-emerald-500" : "text-muted-foreground"}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleDeprecate}
            title={
              entry.status === "deprecated" ? "Restore entry" : "Deprecate entry"
            }
          >
            <Archive
              className={`size-3.5 ${entry.status === "deprecated" ? "text-amber-500" : "text-muted-foreground"}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function AddEntryForm({
  slug,
  onDone,
}: {
  slug: string;
  onDone: () => void;
}) {
  const createEntry = useCreatePublicVaultEntry();
  const [kind, setKind] = useState("insight");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    createEntry.mutate(
      {
        slug,
        kind,
        title: title.trim(),
        body: body.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      },
      {
        onSuccess: () => {
          toast.success("Entry added");
          setTitle("");
          setBody("");
          setTags("");
          onDone();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="entry-kind">Kind</Label>
          <Input
            id="entry-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder="insight, pattern, reference..."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entry-tags">Tags (comma-separated)</Label>
          <Input
            id="entry-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="react, hooks, performance"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="entry-title">Title</Label>
        <Input
          id="entry-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Entry title"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="entry-body">Body</Label>
        <Textarea
          id="entry-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Entry content (markdown supported)"
          rows={4}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!title.trim() || !body.trim() || createEntry.isPending}
        >
          {createEntry.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Add Entry"
          )}
        </Button>
      </div>
    </form>
  );
}

function SeedForm({ slug, onDone }: { slug: string; onDone: () => void }) {
  const seedVault = useSeedPublicVault();
  const [tags, setTags] = useState("");

  const handleSeed = (e: React.FormEvent) => {
    e.preventDefault();
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    seedVault.mutate(
      { slug, tags: tagList.length > 0 ? tagList : undefined },
      {
        onSuccess: (data) => {
          toast.success(
            `Seeded ${data.seeded} entries${data.skipped > 0 ? `, ${data.skipped} skipped` : ""}`,
          );
          onDone();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <form onSubmit={handleSeed} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Copy matching entries from your personal vault into this public vault.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="seed-tags">Filter by tags (optional, comma-separated)</Label>
        <Input
          id="seed-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="react, typescript, patterns"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={seedVault.isPending}>
          {seedVault.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Seed Entries"
          )}
        </Button>
      </div>
    </form>
  );
}

export function PublicVaultsDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: vault, isLoading } = usePublicVault(slug || null);
  const { data: entriesData, isLoading: entriesLoading } =
    usePublicVaultEntries({ slug: slug || null });
  const { data: stats } = usePublicVaultStats(slug || null);
  const deleteVault = useDeletePublicVault();

  const [showAddEntry, setShowAddEntry] = useState(false);
  const [showSeed, setShowSeed] = useState(false);

  const isCurator = !!user && vault?.curator_id === user.id;

  const handleDeleteVault = () => {
    if (!slug) return;
    if (
      !confirm(
        "Delete this public vault? All entries will be permanently removed.",
      )
    )
      return;
    deleteVault.mutate(slug, {
      onSuccess: () => {
        toast.success("Vault deleted");
        navigate("/public-vaults");
      },
      onError: (err) => toast.error(err.message),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!vault) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Vault not found</p>
        <Link
          to="/public-vaults"
          className="text-sm text-primary hover:underline mt-2 inline-block"
        >
          Back to directory
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <Link
          to="/public-vaults"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3"
        >
          <ArrowLeft className="size-3" />
          Back to directory
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Globe className="size-6" />
              {vault.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5 font-mono">
              {vault.slug}
            </p>
            {vault.description && (
              <p className="text-sm text-muted-foreground mt-2">
                {vault.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge
              variant={vault.visibility === "free" ? "secondary" : "default"}
            >
              {vault.visibility}
            </Badge>
            {isCurator && (
              <Badge variant="outline" className="text-primary">
                Curator
              </Badge>
            )}
          </div>
        </div>
        {vault.domain_tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {vault.domain_tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Entries
              </CardTitle>
              <BookOpen className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">
              {vault.entry_count}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Consumers
              </CardTitle>
              <Users className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">
              {vault.consumer_count}
            </span>
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
            <span className="text-2xl font-semibold">
              {vault.total_recalls}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Top Recall
              </CardTitle>
              <BarChart3 className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">
              {stats?.top_entries?.[0]?.recall_count ?? 0}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Consumer integration */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">Add to your agent</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">CLI</p>
            <CopyBlock value={`context-vault public add ${vault.slug}`} />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">API</p>
            <CopyBlock
              value={`curl https://api.context-vault.com/api/public/${vault.slug}/search?q=your+query`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Top entries by recall (analytics) */}
      {stats && stats.top_entries.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <CardTitle className="text-base">Top Recalled Entries</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.top_entries.slice(0, 5).map((e, i) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground w-4 shrink-0">
                      {i + 1}.
                    </span>
                    <span className="text-sm truncate">{e.title}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                    <span>{e.recall_count} recalls</span>
                    <span>{e.distinct_consumers} consumers</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Curator: entry management */}
      {isCurator && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Manage Entries</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setShowSeed(!showSeed);
                    setShowAddEntry(false);
                  }}
                >
                  <Sparkles className="size-3 mr-1.5" />
                  Seed
                </Button>
                <Button
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setShowAddEntry(!showAddEntry);
                    setShowSeed(false);
                  }}
                >
                  <Plus className="size-3 mr-1.5" />
                  Add Entry
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {showAddEntry && (
              <div className="mb-4 pb-4 border-b border-border">
                <AddEntryForm
                  slug={vault.slug}
                  onDone={() => setShowAddEntry(false)}
                />
              </div>
            )}
            {showSeed && (
              <div className="mb-4 pb-4 border-b border-border">
                <SeedForm
                  slug={vault.slug}
                  onDone={() => setShowSeed(false)}
                />
              </div>
            )}
            {entriesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : !entriesData?.entries.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No entries yet. Add entries manually or seed from your personal
                vault.
              </p>
            ) : (
              <div>
                {entriesData.entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    slug={vault.slug}
                    isCurator={isCurator}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Non-curator: read-only entry list */}
      {!isCurator && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Entries ({entriesData?.total ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {entriesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : !entriesData?.entries.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                This vault has no entries yet.
              </p>
            ) : (
              <div>
                {entriesData.entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    slug={vault.slug}
                    isCurator={false}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Curator: danger zone */}
      {isCurator && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-destructive">
              Danger Zone
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Delete this vault</p>
                <p className="text-xs text-muted-foreground">
                  Permanently removes the vault and all its entries.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteVault}
                disabled={deleteVault.isPending}
              >
                {deleteVault.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <Trash2 className="size-3.5 mr-1.5" />
                    Delete
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
