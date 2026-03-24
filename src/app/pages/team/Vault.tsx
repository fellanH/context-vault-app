import { useState } from "react";
import { useParams, Link } from "react-router";
import type { Entry, SearchResult } from "../../lib/types";
import {
  useTeamEntries,
  useTeamSearch,
  useTeamVaultStatus,
  useUnpublishEntry,
  useTeam,
} from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { formatRelativeTime } from "../../lib/format";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
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
  Search,
  FileText,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ArrowLeft,
  Database,
  Layers,
  Trash2,
  Flame,
  Upload,
} from "lucide-react";
import { EntryInspector } from "../../components/EntryInspector";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { toast } from "sonner";

const PAGE_SIZE = 10;

function RecallHeat({ count }: { count?: number }) {
  if (!count) return null;
  const intensity =
    count >= 10 ? "text-orange-500" : count >= 3 ? "text-amber-500" : "text-muted-foreground";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-0.5 text-xs tabular-nums ${intensity}`}>
            <Flame className="size-3" />
            {count}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>Recalled {count} time{count !== 1 ? "s" : ""}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function AuthorBadge({ entry }: { entry: Entry }) {
  const isSeeded = entry.source?.startsWith("published:");
  const name = entry.userName || "Unknown";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {isSeeded && <Upload className="size-3" />}
            <span className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-medium shrink-0">
              {name[0].toUpperCase()}
            </span>
            <span className="truncate max-w-[80px]">{name}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isSeeded ? `Published by ${name}` : `Created by ${name}`}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function TeamVault() {
  const { id: teamId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: team } = useTeam(teamId || null);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [unpublishTarget, setUnpublishTarget] = useState<Entry | null>(null);

  const isOwnerOrAdmin = team?.role === "owner" || team?.role === "admin";

  const {
    data: statusData,
    isLoading: statusLoading,
  } = useTeamVaultStatus(teamId || null);

  const {
    data: entriesData,
    isLoading: entriesLoading,
    isError: entriesError,
    refetch: refetchEntries,
  } = useTeamEntries({
    teamId: teamId || null,
    kind: kindFilter === "all" ? undefined : kindFilter,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
  });

  const searchMutation = useTeamSearch();
  const unpublishEntry = useUnpublishEntry();

  const entries = entriesData?.entries ?? [];
  const total = entriesData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) {
      setIsSearchMode(false);
      setSearchQuery("");
      return;
    }
    setSearchQuery(q);
    setIsSearchMode(true);
    searchMutation.mutate({
      teamId: teamId!,
      query: q,
      kind: kindFilter === "all" ? undefined : kindFilter,
      limit: 20,
    });
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
    setIsSearchMode(false);
  };

  const handleKindChange = (value: string) => {
    setKindFilter(value);
    setPage(0);
    if (isSearchMode && searchQuery) {
      searchMutation.mutate({
        teamId: teamId!,
        query: searchQuery,
        kind: value === "all" ? undefined : value,
        limit: 20,
      });
    }
  };

  const handleUnpublish = () => {
    if (!unpublishTarget || !teamId) return;
    const entryTitle = unpublishTarget.title;
    unpublishEntry.mutate(
      { teamId, entryId: unpublishTarget.id },
      {
        onSuccess: () => {
          toast.success(`Unpublished "${entryTitle}"`);
          setUnpublishTarget(null);
        },
        onError: (err) => {
          toast.error("Failed to unpublish", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
          setUnpublishTarget(null);
        },
      },
    );
  };

  const canUnpublish = (entry: Entry) =>
    isOwnerOrAdmin || (user?.id && entry.userId === user.id);

  const searchResults = searchMutation.data?.results ?? [];
  const displayEntries: (Entry | SearchResult)[] = isSearchMode
    ? searchResults
    : entries;

  const totalEntries = statusData?.entries.total ?? 0;
  const byKind = statusData?.entries.by_kind ?? {};

  return (
    <>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Link to={`/team/${teamId}`}>
                <Button variant="ghost" size="icon" className="size-8">
                  <ArrowLeft className="size-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-semibold">Team Vault</h1>
                <p className="text-sm text-muted-foreground">
                  Shared knowledge entries
                </p>
              </div>
            </div>
          </div>

          {/* Stats cards */}
          {!statusLoading && statusData && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Card className="py-0">
                <CardHeader className="py-3 pb-1">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      Total Entries
                    </CardTitle>
                    <Database className="size-3.5 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="py-3 pt-0">
                  <span className="text-xl font-semibold">{totalEntries}</span>
                </CardContent>
              </Card>
              {Object.entries(byKind)
                .slice(0, 3)
                .map(([kind, count]) => (
                  <Card key={kind} className="py-0">
                    <CardHeader className="py-3 pb-1">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-xs font-medium text-muted-foreground capitalize">
                          {kind}
                        </CardTitle>
                        <Layers className="size-3.5 text-muted-foreground" />
                      </div>
                    </CardHeader>
                    <CardContent className="py-3 pt-0">
                      <span className="text-xl font-semibold">{count}</span>
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}

          {/* Search + Filters */}
          <form onSubmit={handleSearch} className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search team vault..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>

            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>

            {isSearchMode && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearSearch}
              >
                Clear
              </Button>
            )}

            <Select value={kindFilter} onValueChange={handleKindChange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Kinds</SelectItem>
                <SelectItem value="insight">Insight</SelectItem>
                <SelectItem value="decision">Decision</SelectItem>
                <SelectItem value="pattern">Pattern</SelectItem>
                <SelectItem value="reference">Reference</SelectItem>
              </SelectContent>
            </Select>
          </form>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {(entriesLoading || searchMutation.isPending) ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-16 ml-auto" />
                </div>
              ))}
            </div>
          ) : entriesError ? (
            <ErrorState
              title="Failed to load entries"
              description="Could not load team vault entries. Check your connection and try again."
              onRetry={() => refetchEntries()}
            />
          ) : displayEntries.length === 0 && !isSearchMode && kindFilter === "all" ? (
            <EmptyState
              icon={FileText}
              title="No entries in team vault"
              description="Publish entries from your personal vault to share knowledge with your team."
            />
          ) : (
            <div className="p-6">
              {isSearchMode && (
                <p className="text-sm text-muted-foreground mb-3">
                  {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{searchQuery}"
                </p>
              )}

              <div className="border border-border rounded-lg overflow-x-auto bg-card">
                <table className="w-full min-w-[800px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                        Title
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                        Author
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                        Kind
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                        Tags
                      </th>
                      {isSearchMode && (
                        <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">
                          Score
                        </th>
                      )}
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">
                        Recall
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">
                        Created
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground w-10">
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setSelectedEntry(entry)}
                        tabIndex={0}
                        role="button"
                        aria-label={`View entry: ${entry.title}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedEntry(entry);
                          }
                        }}
                      >
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium">
                            {entry.title}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <AuthorBadge entry={entry} />
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="default" className="text-xs">
                            {entry.kind}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {entry.tags.slice(0, 3).map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-xs"
                              >
                                {tag}
                              </Badge>
                            ))}
                            {entry.tags.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{entry.tags.length - 3}
                              </Badge>
                            )}
                          </div>
                        </td>
                        {isSearchMode && (
                          <td className="px-4 py-3 text-right">
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {("score" in entry)
                                ? (entry as SearchResult).score.toFixed(3)
                                : "--"}
                            </span>
                          </td>
                        )}
                        <td className="px-4 py-3 text-right">
                          <RecallHeat count={entry.recallCount} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(entry.created)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canUnpublish(entry) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setUnpublishTarget(entry);
                              }}
                              aria-label="Unpublish entry"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {displayEntries.length === 0 && (
                  <div className="py-12 text-center text-muted-foreground">
                    <p className="text-sm">No entries match your search</p>
                    <p className="text-xs mt-1">
                      Try adjusting your search or filters
                    </p>
                  </div>
                )}
              </div>

              {/* Pagination (browse mode only) */}
              {!isSearchMode && totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-muted-foreground">
                    Showing {page * PAGE_SIZE + 1}
                    {"\u2013"}
                    {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground px-2">
                      {page + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                      aria-label="Next page"
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <EntryInspector
        entry={selectedEntry}
        open={selectedEntry !== null}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
      />

      {/* Unpublish Confirmation Dialog */}
      <AlertDialog
        open={unpublishTarget !== null}
        onOpenChange={(open) => !open && setUnpublishTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove "{unpublishTarget?.title}" from the team vault.
              The original entry in the publisher's personal vault is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnpublish}
              disabled={unpublishEntry.isPending}
            >
              {unpublishEntry.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : null}
              Unpublish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
