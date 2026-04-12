import { Link } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { useVaultStatus } from "../../lib/hooks";
import {
  Cloud,
  CheckCircle2,
  Upload,
  Download,
  Loader2,
  Terminal,
} from "lucide-react";

export function Sync() {
  const { data: status, isLoading, isError } = useVaultStatus();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sync</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connection status and vault synchronization.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Cloud className="size-4" />
            <CardTitle className="text-base">Connection</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">API endpoint</p>
              <code className="text-xs text-muted-foreground font-mono">
                https://api.context-vault.com
              </code>
            </div>
            <div className="flex items-center gap-1.5">
              {isLoading ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : isError ? (
                <span className="text-xs text-destructive font-medium">
                  Disconnected
                </span>
              ) : (
                <>
                  <CheckCircle2 className="size-3.5 text-green-500" />
                  <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                    Connected
                  </span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="size-4" />
            <CardTitle className="text-base">Vault overview</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm">Hosted entries</p>
            <span className="text-sm font-mono">
              {isLoading ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : (
                status?.entries.total.toLocaleString() ?? "—"
              )}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Local entry count is available via the CLI:{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-[11px]">
              context-vault status
            </code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Link to="/import">
              <Button size="sm" variant="outline">
                <Upload className="size-3.5 mr-1.5" />
                Import local vault
              </Button>
            </Link>
            <Link to="/settings/data">
              <Button size="sm" variant="outline">
                <Download className="size-3.5 mr-1.5" />
                Export vault
              </Button>
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Initial load: use Import. Ongoing: automatic via MCP{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-[11px]">
              save_context
            </code>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
