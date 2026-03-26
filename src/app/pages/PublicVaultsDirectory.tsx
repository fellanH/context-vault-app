import { useState } from "react";
import { Link } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Globe,
  Search,
  Users,
  TrendingUp,
  BookOpen,
  Loader2,
  Plus,
  ArrowUpDown,
} from "lucide-react";
import { usePublicVaults, usePublicVaultSearch } from "../lib/hooks";
import type { PublicVault } from "../lib/hooks";
import { useAuth } from "../lib/auth";

type SortMode = "consumers" | "recalls" | "recent";

function VaultCard({ vault }: { vault: PublicVault }) {
  return (
    <Link to={`/public-vaults/${vault.slug}`}>
      <Card className="hover:border-primary/40 transition-colors cursor-pointer">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{vault.name}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                {vault.slug}
              </p>
            </div>
            <Badge
              variant={vault.visibility === "free" ? "secondary" : "default"}
              className="shrink-0 text-[10px]"
            >
              {vault.visibility}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {vault.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {vault.description}
            </p>
          )}
          {vault.domain_tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {vault.domain_tags.slice(0, 5).map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
              {vault.domain_tags.length > 5 && (
                <Badge variant="outline" className="text-[10px]">
                  +{vault.domain_tags.length - 5}
                </Badge>
              )}
            </div>
          )}
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border">
            <span className="flex items-center gap-1">
              <BookOpen className="size-3" />
              {vault.entry_count} entries
            </span>
            <span className="flex items-center gap-1">
              <Users className="size-3" />
              {vault.consumer_count} consumers
            </span>
            <span className="flex items-center gap-1">
              <TrendingUp className="size-3" />
              {vault.total_recalls} recalls
            </span>
          </div>
          {vault.curator_name && (
            <p className="text-[11px] text-muted-foreground">
              by {vault.curator_name}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

export function PublicVaultsDirectory() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("consumers");
  const [page, setPage] = useState(0);
  const limit = 12;

  const isSearching = searchQuery.length >= 2;

  const listQuery = usePublicVaults({
    sort,
    limit,
    offset: page * limit,
  });
  const searchResult = usePublicVaultSearch(searchQuery);

  const vaults = isSearching
    ? searchResult.data?.vaults ?? []
    : listQuery.data?.vaults ?? [];
  const total = isSearching
    ? searchResult.data?.total ?? 0
    : listQuery.data?.total ?? 0;
  const isLoading = isSearching ? searchResult.isLoading : listQuery.isLoading;

  const sortOptions: { value: SortMode; label: string }[] = [
    { value: "consumers", label: "Most consumers" },
    { value: "recalls", label: "Most recalls" },
    { value: "recent", label: "Recently updated" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Globe className="size-6" />
            Public Vaults
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse curated knowledge bases anyone can query
          </p>
        </div>
        {user && (
          <Button asChild size="sm">
            <Link to="/public-vaults/new">
              <Plus className="size-4 mr-1.5" />
              Create Vault
            </Link>
          </Button>
        )}
      </div>

      {/* Search + Sort */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search public vaults..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
        {!isSearching && (
          <div className="flex items-center gap-1">
            <ArrowUpDown className="size-3.5 text-muted-foreground" />
            {sortOptions.map((opt) => (
              <Button
                key={opt.value}
                variant={sort === opt.value ? "secondary" : "ghost"}
                size="sm"
                className="text-xs"
                onClick={() => {
                  setSort(opt.value);
                  setPage(0);
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : vaults.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Globe className="size-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {isSearching
                ? "No vaults match your search"
                : "No public vaults yet. Be the first to create one!"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vaults.map((vault) => (
              <VaultCard key={vault.id} vault={vault} />
            ))}
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page + 1} of {Math.ceil(total / limit)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * limit >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
