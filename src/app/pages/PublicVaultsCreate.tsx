import { useState } from "react";
import { useNavigate, Link } from "react-router";
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
  Loader2,
  ArrowLeft,
  Copy,
  Check,
  Terminal,
  Plus,
} from "lucide-react";
import { useCreatePublicVault } from "../lib/hooks";
import { toast } from "sonner";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

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

export function PublicVaultsCreate() {
  const navigate = useNavigate();
  const createVault = useCreatePublicVault();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"free" | "pro">("free");
  const [domainTags, setDomainTags] = useState("");

  const autoSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const effectiveSlug = slugTouched ? slug : autoSlug;
  const slugValid = SLUG_RE.test(effectiveSlug);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slugValid) return;

    createVault.mutate(
      {
        name: name.trim(),
        slug: effectiveSlug,
        description: description.trim() || undefined,
        visibility,
        domain_tags: domainTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      },
      {
        onSuccess: (vault) => {
          toast.success(`Created "${vault.name}"`);
          navigate(`/public-vaults/${vault.slug}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <Link
          to="/public-vaults"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3"
        >
          <ArrowLeft className="size-3" />
          Back to directory
        </Link>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Globe className="size-6" />
          Create Public Vault
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Share curated knowledge that any agent can query.
          Requires a Pro account.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Vault Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="vault-name">Name</Label>
              <Input
                id="vault-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="React Patterns"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vault-slug">Slug</Label>
              <Input
                id="vault-slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
                placeholder="react-patterns"
                className="font-mono"
              />
              {effectiveSlug && !slugValid && (
                <p className="text-xs text-destructive">
                  Slug must be 3-64 lowercase alphanumeric characters with hyphens
                </p>
              )}
              {effectiveSlug && slugValid && (
                <p className="text-xs text-muted-foreground">
                  Consumers will add: <code>{effectiveSlug}</code>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vault-desc">Description</Label>
              <Textarea
                id="vault-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What kind of knowledge does this vault contain?"
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vault-tags">Domain Tags (comma-separated)</Label>
              <Input
                id="vault-tags"
                value={domainTags}
                onChange={(e) => setDomainTags(e.target.value)}
                placeholder="react, typescript, hooks, performance"
              />
              {domainTags && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {domainTags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Visibility</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={visibility === "free" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setVisibility("free")}
                >
                  Free
                </Button>
                <Button
                  type="button"
                  variant={visibility === "pro" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setVisibility("pro")}
                >
                  Pro
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {visibility === "free"
                  ? "Anyone can query this vault without authentication."
                  : "Only users with an API key can query this vault."}
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={!name.trim() || !slugValid || createVault.isPending}
            >
              {createVault.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Plus className="size-4 mr-1.5" />
                  Create Public Vault
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Consumer add-vault shortcut */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">
              Want to add an existing vault?
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            If you know the vault slug, add it to your agent config:
          </p>
          <CopyBlock value="context-vault public add <slug>" />
          <p className="text-xs text-muted-foreground">
            Or browse the{" "}
            <Link
              to="/public-vaults"
              className="text-primary hover:underline"
            >
              directory
            </Link>{" "}
            to find vaults to add.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
