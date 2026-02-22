import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Failed to load",
  description = "There was a problem fetching data. Check your connection and try again.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
      <AlertTriangle className="size-8 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5 mr-2" />
          Try again
        </Button>
      )}
    </div>
  );
}
