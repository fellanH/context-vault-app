import { useState } from "react";
import { Link } from "react-router";
import type { Entry, FreshnessLabel } from "../lib/types";
import { useEntries } from "../lib/hooks";
import { formatRelativeTime } from "../lib/format";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { FreshnessBadge } from "../components/FreshnessBadge";
import {
  Filter,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { EntryInspector } from "../components/EntryInspector";

const PAGE_SIZE = 20;

const FRESHNESS_FILTERS: { label: string; value: FreshnessLabel | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Dormant", value: "dormant" },
  { label: "Stale", value: "stale" },
  { label: "Aging", value: "aging" },
];

const KIND_FILTERS = [
  "all",
  "insight",
  "decision",
  "pattern",
  "reference",
  "project",
  "contact",
  "tool",
  "session",
  "log",
] as const;

export function Curation() {
  const [freshnessFilter, setFreshnessFilter] = useState<FreshnessLabel | "all">("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);

  const { data, isLoading } = useEntries({
    kind: kindFilter !== "all" ? kindFilter : undefined,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;

  // Client-side freshness filter (server already computes the score)
  const filteredEntries =
    freshnessFilter === "all"
      ? entries
      : entries.filter((e) => e.freshnessLabel === freshnessFilter);

  // Sort by freshness ascending (worst first)
  const sortedEntries = [...filteredEntries].sort(
    (a, b) => (a.freshnessScore ?? 0) - (b.freshnessScore ?? 0),
  );

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold">Vault Curation</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Review entries that need attention. Sorted by freshness (worst first).
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="size-4 text-muted-foreground" />
        <div className="flex items-center gap-1.5">
          {FRESHNESS_FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={freshnessFilter === f.value ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => {
                setFreshnessFilter(f.value);
                setPage(0);
              }}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="w-px h-4 bg-border" />
        <select
          className="text-xs border rounded-md px-2 py-1.5 bg-background"
          value={kindFilter}
          onChange={(e) => {
            setKindFilter(e.target.value);
            setPage(0);
          }}
        >
          {KIND_FILTERS.map((k) => (
            <option key={k} value={k}>
              {k === "all" ? "All kinds" : k}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : sortedEntries.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <Sparkles className="size-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">Everything looks healthy</p>
          <p className="text-xs mt-1">
            No entries match the current filters.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                    Title
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                    Kind
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                    Freshness
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">
                    Score
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">
                    Recalls
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">
                    Last Accessed
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground" />
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium truncate block max-w-[300px]">
                        {entry.title || "(untitled)"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs">
                        {entry.kind}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <FreshnessBadge
                        label={entry.freshnessLabel}
                        score={entry.freshnessScore}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-mono text-muted-foreground tabular-nums">
                        {entry.freshnessScore ?? "--"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {entry.recallCount ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-muted-foreground">
                        {entry.lastAccessedAt
                          ? formatRelativeTime(entry.lastAccessedAt)
                          : "never"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/vault/${entry.category}/${entry.id}`}
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="size-3" />
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages} ({total} entries)
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Entry inspector sheet */}
      <EntryInspector
        entry={selectedEntry}
        open={selectedEntry !== null}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
      />
    </div>
  );
}
