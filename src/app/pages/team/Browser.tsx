import { useState } from "react";
import { useParams, Link } from "react-router";
import type { Entry, SearchResult } from "../../lib/types";
import {
  useTeamEntries,
  useTeamSearch,
  useTeamVaultStatus,
} from "../../lib/hooks";
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
  Search,
  FileText,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ArrowLeft,
  Flame,
  TrendingUp,
} from "lucide-react";
import { EntryInspector } from "../../components/EntryInspector";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";

const PAGE_SIZE = 10;

function RecallHeat({ count }: { count?: number }) {
  if (!count) return null;
  const intensity =
    count >= 10
      ? "text-orange-500"
      : count >= 3
        ? "text-amber-500"
        : "text-muted-foreground";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-0.5 text-xs tabular-nums ${intensity}`}
          >
            <Flame className="size-3" />
            {count}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            Recalled {count} time{count !== 1 ? "s" : ""}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function TeamBrowser() {
  const { id: teamId } = useParams<{ id: string }>();
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [isSearchMode, setIsSearchMode] = useState(false);

  const { data: statusData } = useTeamVaultStatus(teamId || null);

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

  const entries = entriesData?.entries ?? [];
  const total = entriesData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hotSpots = statusData?.hot_spots ?? [];

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

  const searchResults = searchMutation.data?.results ?? [];
  const displayEntries: (Entry | SearchResult)[] = isSearchMode
    ? searchResults
    : entries;

  if (!teamId) {
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
    <>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center gap-3 mb-4">
            <Link to={`/team/${teamId}`}>
              <Button variant="ghost" size="icon" className="size-8">
                <ArrowLeft className="size-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <TrendingUp className="size-5" />
                Search &amp; Hot Spots
              </h1>
              <p className="text-sm text-muted-foreground">
                Explore team knowledge by recall frequency
              </p>
            </div>
          </div>

          {/* Hot Spots */}
          {hotSpots.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <Flame className="size-3 text-orange-500" />
                Hot Spots
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {hotSpots.slice(0, 8).map((spot) => (
                  <button
                    key={spot.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:border-primary/40 transition-colors text-left shrink-0 max-w-[240px]"
                    onClick={() => {
                      setSearchInput(spot.title);
                      setSearchQuery(spot.title);
                      setIsSearchMode(true);
                      searchMutation.mutate({
                        teamId,
                        query: spot.title,
                        limit: 10,
                      });
                    }}
                  >
                    <span className="flex items-center gap-0.5 text-orange-500 shrink-0">
                      <Flame className="size-3" />
                      <span className="text-xs font-medium tabular-nums">
                        {spot.recall_count}
                      </span>
                    </span>
                    <span className="text-xs truncate">{spot.title}</span>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {spot.kind}
                    </Badge>
                  </button>
                ))}
              </div>
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
          {entriesLoading || searchMutation.isPending ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-5 w-16" />
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
          ) : displayEntries.length === 0 &&
            !isSearchMode &&
            kindFilter === "all" ? (
            <EmptyState
              icon={FileText}
              title="No entries in team vault"
              description="Publish entries from your personal vault to share knowledge with your team."
            />
          ) : (
            <div className="p-6">
              {isSearchMode && (
                <p className="text-sm text-muted-foreground mb-3">
                  {searchResults.length} result
                  {searchResults.length !== 1 ? "s" : ""} for "{searchQuery}"
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {displayEntries.map((entry) => (
                  <Card
                    key={entry.id}
                    className="hover:border-primary/40 transition-colors cursor-pointer"
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
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm truncate">
                          {entry.title}
                        </CardTitle>
                        <RecallHeat count={entry.recallCount} />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="default" className="text-[10px]">
                          {entry.kind}
                        </Badge>
                        {entry.tags.slice(0, 3).map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-[10px]"
                          >
                            {tag}
                          </Badge>
                        ))}
                        {entry.tags.length > 3 && (
                          <Badge variant="outline" className="text-[10px]">
                            +{entry.tags.length - 3}
                          </Badge>
                        )}
                        {"score" in entry && (
                          <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                            {(entry as SearchResult).score.toFixed(3)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {formatRelativeTime(entry.created)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {displayEntries.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  <p className="text-sm">No entries match your search</p>
                  <p className="text-xs mt-1">
                    Try adjusting your search or filters
                  </p>
                </div>
              )}

              {/* Pagination (browse mode only) */}
              {!isSearchMode && totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-muted-foreground">
                    Showing {page * PAGE_SIZE + 1}
                    {"-"}
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
    </>
  );
}
