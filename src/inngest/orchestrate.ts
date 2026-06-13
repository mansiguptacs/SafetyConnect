import { inngest } from "./client";
import { runChannel, type StageName } from "./channels";
import { selectRecalls } from "@/lib/select";
import { classifySeverity } from "@/lib/severity";
import {
  cohortSummary,
  geoByState,
  affectedPharmacyPoints,
} from "@/lib/queries";
import { buildMessage, dispatchToCohort } from "@/lib/dispatch";
import { sendDemoAlert } from "@/lib/alert";
import { generatePatientCard } from "@/lib/card";
import { cite } from "@/lib/audit";

interface RunData {
  runId?: string;
  limit?: number;
  holdMs?: number;
}

/**
 * The live defense. Triggered by `safetyconnect/run.requested`, it picks the
 * highest-impact recalls and walks each through the canonical pipeline, durably
 * publishing each stage to the run's Realtime channel so the dashboard animates
 * the trace. Confidential by design: only de-identified aggregates are published.
 */
export const runDefense = inngest.createFunction(
  { id: "run-defense", triggers: [{ event: "safetyconnect/run.requested" }] },
  async ({ event, step }) => {
    const data = (event.data ?? {}) as RunData;
    const runId = data.runId ?? "default";
    const limit = data.limit ?? 4;
    const hold = `${data.holdMs ?? 1400}ms`;
    const ch = runChannel(runId);

    const recalls = await step.run("select-recalls", () => selectRecalls(limit));

    await step.realtime.publish("run-started", ch.lifecycle, {
      type: "run_started",
      recalls: recalls.length,
    });

    for (let i = 0; i < recalls.length; i++) {
      const r = recalls[i];
      const p = `r${i}`;

      const emit = async (
        id: string,
        stage: StageName,
        payload: Record<string, unknown>,
      ) => {
        await step.realtime.publish(`${p}-${id}`, ch.stage, {
          stage,
          recallNumber: r.recall_number,
          recallIndex: i,
          recallTotal: recalls.length,
          data: payload,
        });
        await step.sleep(`${p}-${id}-hold`, hold);
      };

      await emit("fda", "fda_alert", {
        recallingFirm: r.recalling_firm,
        productNdc: r.product_ndc,
        reason: r.reason_for_recall,
        classification: r.classification,
        sourceUrl: r.source_url,
        reportDate: r.report_date,
      });

      await emit("ing", "ingested", {
        source: "openFDA enforcement",
        ndc: r.product_ndc,
      });

      const sev = await step.run(`${p}-classify`, () =>
        classifySeverity(r.reason_for_recall, r.classification),
      );
      await emit("sev", "severity_classified", {
        severity: sev.severity,
        confidence: sev.confidence,
        proba: sev.proba,
        rationale: sev.rationale,
        model: sev.source,
        reason: r.reason_for_recall,
      });

      const cohort = await step.run(`${p}-cohort`, async () => {
        const [summary, byState, points] = await Promise.all([
          cohortSummary(r.recall_number),
          geoByState(r.recall_number),
          affectedPharmacyPoints(r.recall_number, 500),
        ]);
        return { summary, byState, points };
      });
      await emit("coh", "cohort_identified", {
        severity: sev.severity,
        customers: cohort.summary.customers,
        pharmacies: cohort.summary.pharmacies,
        states: cohort.summary.states,
        byState: cohort.byState,
        points: cohort.points,
      });

      const message = buildMessage(sev.severity, r.recalling_firm, r.product_ndc);
      await emit("msg", "message_drafted", { severity: sev.severity, message });

      const dispatch = await step.run(`${p}-dispatch`, () =>
        dispatchToCohort(r.recall_number),
      );
      // Fire ONE real alert only for the headline recall (keeps the demo clean).
      const demoAlert =
        i === 0
          ? await step.run(`${p}-demo-alert`, () =>
              sendDemoAlert(
                sev.severity,
                r.recalling_firm,
                r.product_ndc,
                r.recall_number,
              ),
            )
          : { sent: false, channel: "telegram", reason: "skipped_non_headline" };
      await emit("disp", "dispatched", {
        channel: dispatch.channel,
        dispatched: dispatch.dispatched,
        pharmacies: dispatch.pharmacies,
        states: dispatch.states,
        demoAlert,
      });

      const card = await step.run(`${p}-card`, () =>
        generatePatientCard({
          recall_number: r.recall_number,
          severity: sev.severity,
          product_ndc: r.product_ndc,
          recalling_firm: r.recalling_firm,
          reason_for_recall: r.reason_for_recall,
        }),
      );
      await emit("card", "card_rendered", { card });

      const summaryText = `Alerted ${cohort.summary.customers} customers across ${cohort.summary.states} states (${r.recalling_firm}).`;
      await step.run(`${p}-cite`, () =>
        cite(r.recall_number, sev.severity, r.source_url, summaryText),
      );
      await emit("cite", "cited", {
        severity: sev.severity,
        summary: summaryText,
      });
    }

    await step.realtime.publish("run-complete", ch.lifecycle, {
      type: "run_complete",
      recalls: recalls.length,
    });

    return { recalls: recalls.length };
  },
);
