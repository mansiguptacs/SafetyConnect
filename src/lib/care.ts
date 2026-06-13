import { getClickHouse } from "./clickhouse";

const DB = process.env.CLICKHOUSE_DATABASE ?? "safetyconnect";

// Major U.S. payers we coordinate with (case management / fast-track auth).
export const INSURERS = [
  "Blue Cross Blue Shield",
  "UnitedHealthcare",
  "Aetna",
  "Cigna",
  "Kaiser Permanente",
  "Humana",
];

// In-network primary-care clinics modeled per state.
const CLINICS_PER_STATE = 4;

/** Small, stable string hash for per-person (display-only) assignment. */
function hash(seed: string): number {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    x ^= seed.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

/** The insurer a given patient is in-network with (deterministic). */
export function insurerFor(seed: string): string {
  return INSURERS[hash(seed) % INSURERS.length];
}

/** The in-network primary-care provider for a patient in a given state. */
export function providerFor(state: string, seed: string): string {
  const n = (hash(seed) % CLINICS_PER_STATE) + 1;
  return `${state} Primary Care Group #${n}`;
}

export interface CareNetwork {
  providers: number;
  payers: number;
  payerNames: string[];
}

/**
 * How many in-network care providers and insurers we coordinated with for a
 * recall's cohort. Providers are modeled as clinics per state; payers as the
 * distinct insurers across affected patients. Computed at the data layer (no
 * PII leaves it) using the same deterministic assignment as the per-patient view.
 */
export async function careNetworkSummary(
  recallNumber: string,
): Promise<CareNetwork> {
  const rs = await getClickHouse().query({
    query: `
      SELECT
        uniqExact((state, cityHash64(customer_id) % {k:UInt8})) AS providers,
        uniqExact(cityHash64(customer_id) % {n:UInt8})          AS payers
      FROM ${DB}.patient_alerts
      WHERE recall_number = {recall:String}
    `,
    query_params: {
      recall: recallNumber,
      k: CLINICS_PER_STATE,
      n: INSURERS.length,
    },
    format: "JSONEachRow",
  });
  const [r] = (await rs.json()) as { providers: string; payers: string }[];
  const payers = Number(r?.payers ?? 0);
  return {
    providers: Number(r?.providers ?? 0),
    payers,
    payerNames: INSURERS.slice(0, payers),
  };
}
