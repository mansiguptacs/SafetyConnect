# SafetyConnect

An autonomous consumer-defense shield: it ingests live **FDA drug recalls**,
triages their severity with **xAI Grok**, matches them against a national
patient cohort in **ClickHouse**, and dispatches instant alerts — all
orchestrated by **Inngest** durable functions and streamed to a **Vercel**
dashboard via **Inngest Realtime**.

## Stack

| Concern | Tech |
| --- | --- |
| Hosting + API + UI | Vercel + Next.js (App Router, TS, Tailwind) |
| Ingestion / orchestration / live updates | Inngest (cron, durable functions, Realtime) |
| Intelligence | xAI Grok (`grok-4.3`, OpenAI-compatible) |
| Data store | ClickHouse (recalls, patients, pharmacies, cohort matches) |

## Local development

Requires Node 18.18+ (Node 20+ recommended; Vercel builds on Node 20).

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # Next.js on http://localhost:3000
```

In a second terminal, start the Inngest dev server and point it at the app:

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

The Inngest dev dashboard runs at http://localhost:8288 and should show the
app synced with the `hello-world` function.

## Project layout

```
src/
  app/
    page.tsx              landing / dashboard (dashboard lands in Phase 5)
    api/inngest/route.ts  Inngest serve endpoint
  inngest/
    client.ts             Inngest client
    functions.ts          registered functions
  lib/
    xai.ts                xAI Grok client (OpenAI SDK -> api.x.ai)
    clickhouse.ts         shared ClickHouse client
```

## Build phases

- **Phase 0** — scaffold (this commit)
- **Phase 1** — ClickHouse schema + MVs + synthetic data seed + query module
- **Phase 2** — Inngest cron ingestion from openFDA
- **Phase 3** — xAI Grok severity classification + patient card
- **Phase 4** — Inngest durable orchestration + Realtime events
- **Phase 5** — live dashboard (US map, stage cards) via Inngest Realtime
- **Phase 6** — deploy to Vercel + Inngest Cloud + reachable ClickHouse
