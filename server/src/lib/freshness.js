/**
 * freshness.js -- Freshness scoring for vault entries.
 *
 * Mirrors the MCP core formula: 0-100 score with four components (25 pts each).
 * Labels: fresh (75-100), aging (50-74), stale (25-49), dormant (0-24).
 */

/**
 * Compute freshness score for a vault entry row.
 *
 * @param {object} entry - Raw DB row with timestamps and counters
 * @returns {{ score: number, label: string }}
 */
export function computeFreshnessScore(entry) {
  const now = Date.now();

  // ── Recency (0-25): most recent of updated_at / last_accessed_at / last_recalled_at
  const dates = [entry.updated_at, entry.last_accessed_at, entry.last_recalled_at, entry.created_at]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !isNaN(t));
  const mostRecent = dates.length > 0 ? Math.max(...dates) : now;
  const daysSinceRecent = (now - mostRecent) / (1000 * 60 * 60 * 24);
  const recency = daysSinceRecent < 7 ? 25 : daysSinceRecent >= 90 ? 0 : Math.round(25 * (1 - (daysSinceRecent - 7) / 83));

  // ── Recall frequency (0-25)
  const recalls = Number(entry.recall_count) || 0;
  const recallFreq = recalls === 0 ? 0 : recalls <= 3 ? 10 : recalls <= 10 ? 18 : 25;

  // ── Session spread (0-25)
  const sessions = Number(entry.recall_sessions) || 0;
  const sessionSpread = sessions === 0 ? 0 : sessions === 1 ? 5 : sessions <= 3 ? 12 : sessions <= 7 ? 18 : 25;

  // ── Update freshness (0-25)
  let updateFreshness = 0;
  if (entry.updated_at && entry.updated_at !== entry.created_at) {
    const updateAge = (now - new Date(entry.updated_at).getTime()) / (1000 * 60 * 60 * 24);
    updateFreshness = updateAge < 7 ? 25 : updateAge >= 90 ? 5 : Math.round(5 + 20 * (1 - (updateAge - 7) / 83));
  } else {
    const createAge = (now - new Date(entry.created_at).getTime()) / (1000 * 60 * 60 * 24);
    updateFreshness = createAge < 7 ? 15 : createAge >= 90 ? 0 : Math.round(15 * (1 - (createAge - 7) / 83));
  }

  const score = Math.max(0, Math.min(100, recency + recallFreq + sessionSpread + updateFreshness));
  const label = score >= 75 ? "fresh" : score >= 50 ? "aging" : score >= 25 ? "stale" : "dormant";

  return { score, label };
}
