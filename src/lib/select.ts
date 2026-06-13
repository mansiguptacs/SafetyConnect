import { listMatchRecalls, type MatchRecall } from "./queries";

const RANK: Record<string, number> = { Lethal: 3, Moderate: 2, Minor: 1 };

/**
 * Pick the recalls the demo leads with: ranked by stored (classification-mapped)
 * severity, then by how many customers they reach — so the headline recall is a
 * genuine Class I case with the widest national spread. xAI re-classifies each
 * during processing for the displayed severity + rationale.
 */
export async function selectRecalls(limit: number): Promise<MatchRecall[]> {
  const pool = await listMatchRecalls(Math.max(limit, 40));
  pool.sort(
    (a, b) =>
      (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0) ||
      b.customers - a.customers,
  );
  return pool.slice(0, limit);
}
