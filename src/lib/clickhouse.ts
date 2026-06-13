import { createClient, type ClickHouseClient } from "@clickhouse/client";

let client: ClickHouseClient | null = null;

// Single shared ClickHouse client. Schema, MVs, and queries land in Phase 1.
export function getClickHouse(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DATABASE ?? "safetyconnect",
    });
  }
  return client;
}
