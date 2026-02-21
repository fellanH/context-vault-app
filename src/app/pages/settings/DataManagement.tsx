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
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Upload, Download, Trash2, Lock, Loader2 } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useExportVault, useDeleteAccount, useRawUsage } from "../../lib/hooks";
import { toast } from "sonner";

export function DataManagement() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { data: rawUsage } = useRawUsage();
  const { refetch: fetchExport } = useExportVault();
  const deleteMutation = useDeleteAccount();

  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

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
        a.download = `context-vault-export-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Export downloaded");
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

  const exportEnabled = rawUsage?.limits.exportEnabled ?? false;

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
        <CardContent>
          {!exportEnabled ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="size-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Export is available on Pro and Team plans.
                </span>
              </div>
              <Badge variant="secondary">Upgrade to Pro</Badge>
            </div>
          ) : (
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
