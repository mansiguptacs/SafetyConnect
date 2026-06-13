/**
 * Seeds the local ClickHouse instance for SafetyConnect:
 *   1. applies db/schema.sql (database + tables + materialized views)
 *   2. bulk-loads pharmacies.csv -> pharmacies (~5k rows)
 *   3. bulk-loads customers.csv  -> patient_ehr (~1M rows)
 *
 * Recalls are intentionally NOT seeded here — they arrive via the Phase 2
 * Inngest ingestion and fan out through the materialized view automatically.
 *
 * Usage:
 *   npm run db:seed            # apply schema + load CSVs
 *   npm run db:seed -- --reset # drop the database first, then reseed
 */
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@clickhouse/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const DB = process.env.CLICKHOUSE_DATABASE ?? "safetyconnect";
const DATA_DIR = process.env.DATA_DIR ?? "data";
const RESET = process.argv.includes("--reset");

// Connect without a default database so schema can create it.
const client = createClient({
  url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
  request_timeout: 300_000,
});

function splitStatements(sql: string): string[] {
  // Strip line comments first so a stray ';' inside a comment can't split a
  // statement (none of our schema uses '--' inside string literals).
  const stripped = sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
  return stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applySchema() {
  const sql = await readFile(path.join("db", "schema.sql"), "utf8");
  const statements = splitStatements(sql);
  console.log(`Applying schema (${statements.length} statements)...`);
  for (const stmt of statements) {
    await client.command({ query: stmt });
  }
  console.log("  schema applied.");
}

async function loadCsv(file: string, table: string) {
  const filePath = path.join(DATA_DIR, file);
  process.stdout.write(`Loading ${file} -> ${table} ... `);
  const started = Date.now();
  await client.insert({
    table: `${DB}.${table}`,
    values: createReadStream(filePath),
    format: "CSVWithNames",
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`done in ${secs}s`);
}

async function count(table: string): Promise<string> {
  const rs = await client.query({
    query: `SELECT count() AS c FROM ${DB}.${table}`,
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as { c: string }[];
  return rows[0]?.c ?? "0";
}

async function main() {
  if (RESET) {
    console.log(`Dropping database ${DB} ...`);
    await client.command({ query: `DROP DATABASE IF EXISTS ${DB}` });
  }

  await applySchema();
  await loadCsv("pharmacies.csv", "pharmacies");
  await loadCsv("customers.csv", "patient_ehr");

  console.log("\nRow counts:");
  console.log(`  pharmacies:     ${await count("pharmacies")}`);
  console.log(`  patient_ehr:    ${await count("patient_ehr")}`);
  console.log(`  fda_recalls:    ${await count("fda_recalls")}`);
  console.log(`  patient_alerts: ${await count("patient_alerts")}`);

  await client.close();
  console.log("\nSeed complete.");
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  await client.close();
  process.exit(1);
});
