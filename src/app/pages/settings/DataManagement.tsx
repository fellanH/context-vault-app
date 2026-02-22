import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Upload, Download, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "../../lib/auth";
import {
  useExportVault,
  useDeleteAccount,
  useRawUsage,
  type ExportFilters,
} from "../../lib/hooks";
import { UpgradePrompt } from "../../components/UpgradePrompt";
import { toast } from "sonner";

const CATEGORY_KINDS: Record<string, { label: string; value: string }[]> = {
  knowledge: [
    { label: "Insight", value: "insight" },
    { label: "Decision", value: "decision" },
    { label: "Pattern", value: "pattern" },
    { label: "Reference", value: "reference" },
  ],
  entity: [
    { label: "Project", value: "project" },
    { label: "Contact", value: "contact" },
    { label: "Tool", value: "tool" },
  ],
  event: [
    { label: "Session", value: "session" },
    { label: "Log", value: "log" },
  ],
};

export function DataManagement() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { data: rawUsage } = useRawUsage();
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [exporting, setExporting] = useState(false);

  const [category, setCategory] = useState<string>("all");
  const [kind, setKind] = useState<string>("all");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  const filters: ExportFilters = {
    ...(category !== "all" ? { category } : {}),
    ...(kind !== "all" ? { kind } : {}),
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
  };

  const { refetch: fetchExport } = useExportVault(filters);
  const deleteMutation = useDeleteAccount();

  const exportEnabled = rawUsage?.limits?.exportEnabled ?? true;

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await fetchExport();
      if (result.data) {
        const blob = new Blob([JSON.stringify(result.data.entries, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const datePart = new Date().toISOString().slice(0, 10);
        const scopeParts = [
          category !== "all" ? category : null,
          kind !== "all" ? kind : null,
        ]
          .filter(Boolean)
          .join("-");
        a.download = `context-vault-export-${scopeParts ? `${scopeParts}-` : ""}${datePart}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(
          `Export downloaded (${result.data.entries.length} entries)`,
        );
      }
    } catch {
      toast.error("Failed to export vault data");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        logout();
        navigate("/login");
      },
      onError: () => {
        toast.error("Failed to delete account");
      },
    });
  };

  // When category changes, reset kind selection
  const handleCategoryChange = (val: string) => {
    setCategory(val);
    setKind("all");
  };

  const availableKinds = category !== "all" ? CATEGORY_KINDS[category] : [];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import, export, and manage your vault data.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Upload className="size-4" />
            <CardTitle className="text-base">Import</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Import entries from your local markdown vault or a JSON export.
          </p>
          <Link to="/import">
            <Button size="sm" variant="outline">
              <Upload className="size-3.5 mr-1.5" />
              Go to Import
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Download className="size-4" />
            <CardTitle className="text-base">Export</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!exportEnabled ? (
            <UpgradePrompt message="Export is a Pro feature. Upgrade to download your vault data." />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Download a subset of your vault as JSON. Leave filters empty to
                export everything.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Select value={category} onValueChange={handleCategoryChange}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      <SelectItem value="knowledge">Knowledge</SelectItem>
                      <SelectItem value="entity">Entities</SelectItem>
                      <SelectItem value="event">Events</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Kind</Label>
                  <Select
                    value={kind}
                    onValueChange={setKind}
                    disabled={category === "all"}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="All kinds" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All kinds</SelectItem>
                      {availableKinds.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">From date</Label>
                  <Input
                    type="date"
                    value={since}
                    onChange={(e) => setSince(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">To date</Label>
                  <Input
                    type="date"
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                ) : (
                  <Download className="size-3.5 mr-1.5" />
                )}
                Download vault data
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Trash2 className="size-4 text-destructive" />
            <CardTitle className="text-base text-destructive">
              Danger Zone
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Permanently delete your account and all vault data. This action
            cannot be undone.
          </p>
          <div className="space-y-2">
            <Label htmlFor="deleteConfirm" className="text-xs">
              Type{" "}
              <span className="font-mono font-bold">delete my account</span> to
              confirm
            </Label>
            <Input
              id="deleteConfirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="delete my account"
              className="max-w-xs"
            />
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={
              deleteConfirm !== "delete my account" || deleteMutation.isPending
            }
            onClick={handleDeleteAccount}
          >
            {deleteMutation.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                Deleting...
              </>
            ) : (
              "Delete Account"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
