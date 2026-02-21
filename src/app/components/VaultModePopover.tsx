interface VaultModePopoverProps {
  connectionState: string;
  connectionBadgeClass: string;
}

export function VaultModePopover({
  connectionState,
  connectionBadgeClass,
}: VaultModePopoverProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${connectionBadgeClass}`}
    >
      Hosted • {connectionState}
    </span>
  );
}
