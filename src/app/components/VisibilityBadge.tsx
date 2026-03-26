import type { EntryVisibility } from "../lib/types";
import { Badge } from "./ui/badge";
import { Lock, Users, Globe } from "lucide-react";

const config: Record<
  EntryVisibility,
  { icon: typeof Lock; label: string; className: string }
> = {
  private: {
    icon: Lock,
    label: "Private",
    className: "text-muted-foreground",
  },
  team: {
    icon: Users,
    label: "Team",
    className: "text-blue-600 dark:text-blue-400",
  },
  public: {
    icon: Globe,
    label: "Public",
    className: "text-green-600 dark:text-green-400",
  },
};

interface VisibilityBadgeProps {
  visibility: EntryVisibility;
  teamName?: string;
  size?: "sm" | "default";
}

export function VisibilityBadge({
  visibility,
  teamName,
  size = "default",
}: VisibilityBadgeProps) {
  const entry = config[visibility] || config.private;
  const { icon: Icon, label, className } = entry;
  const displayLabel = visibility === "team" && teamName ? teamName : label;

  return (
    <Badge
      variant="outline"
      className={`gap-1 ${className} ${size === "sm" ? "text-xs px-1.5 py-0" : ""}`}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} />
      {displayLabel}
    </Badge>
  );
}
