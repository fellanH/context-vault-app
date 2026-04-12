import type { FreshnessLabel } from "../lib/types";

const FRESHNESS_STYLES: Record<FreshnessLabel, string> = {
  fresh: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  aging: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  stale: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  dormant: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

export function FreshnessBadge({
  label,
  score,
  showScore = false,
}: {
  label?: FreshnessLabel;
  score?: number;
  showScore?: boolean;
}) {
  if (!label) return null;
  const style = FRESHNESS_STYLES[label] ?? FRESHNESS_STYLES.dormant;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none ${style}`}
    >
      {label}
      {showScore && score != null && (
        <span className="opacity-70">{score}</span>
      )}
    </span>
  );
}
