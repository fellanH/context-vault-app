import { Loader2, RefreshCw } from "lucide-react";

interface VaultModePopoverProps {
  connectionState: string;
  connectionBadgeClass: string;
  onReconnect?: () => void;
}

export function VaultModePopover({
  connectionState,
  connectionBadgeClass,
  onReconnect,
}: VaultModePopoverProps) {
  if (connectionState === "Reconnecting") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${connectionBadgeClass}`}
      >
        <Loader2 className="size-2.5 animate-spin" />
        Hosted • Reconnecting…
      </span>
    );
  }

  if (connectionState === "Disconnected" && onReconnect) {
    return (
      <button
        type="button"
        onClick={onReconnect}
        title="Click to reconnect"
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${connectionBadgeClass} hover:opacity-75 transition-opacity cursor-pointer`}
      >
        <RefreshCw className="size-2.5" />
        Hosted • Disconnected
      </button>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${connectionBadgeClass}`}
    >
      Hosted • {connectionState}
    </span>
  );
}
