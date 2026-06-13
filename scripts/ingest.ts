/**
 * Runs the openFDA ingestion core directly (the same code the Inngest cron
 * function calls), so it can be verified without the Inngest dev server.
 *
 *   npm run ingest                 # default 365-day window, up to 2000 records
 *   npm run ingest -- --days 730 --max 500
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { ingestRecalls } from "../src/lib/ingest";

function argValue(flag: string): number | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1]);
  return undefined;
}

async function main() {
  const lookbackDays = argValue("--days") ?? 365;
  const maxRecords = argValue("--max") ?? 2000;
  console.log(`Ingesting openFDA recalls (lookback ${lookbackDays}d, max ${maxRecords})...`);
  const summary = await ingestRecalls({ lookbackDays, maxRecords });
  console.log("Ingest summary:", summary);
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});
