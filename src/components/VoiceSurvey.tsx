"use client";

import { useEffect, useRef, useState } from "react";
import { getVoiceToken, submitFeedback } from "@/app/actions";
import type { ProcessFeedbackResult } from "@/lib/feedback";
import FeedbackResult from "./FeedbackResult";

interface Props {
  recallNumber: string;
  recallReason: string;
  recallingFirm: string;
  severity: string;
  sourceUrl: string;
  pharmacyId: string;
  state: string;
}

type Status =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "submitting"
  | "done"
  | "error";

const SAMPLE_RATE = 24000;

// --- PCM16 <-> base64 helpers (per xAI Realtime docs) ---
function float32ToBase64PCM16(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64PCM16ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm16 = new Int16Array(bytes.buffer);
  const f32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768.0;
  return f32;
}

interface Line {
  role: "you" | "grok";
  text: string;
}

export default function VoiceSurvey(props: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [result, setResult] = useState<ProcessFeedbackResult | null>(null);

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextPlayRef = useRef(0);
  const submittedRef = useRef(false);
  const closingRef = useRef(false);
  const asstRef = useRef("");

  useEffect(() => {
    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the transcript pinned to the newest message.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  /** Stop capturing the microphone (stop listening) but keep the audio context
   *  alive so the agent's buffered goodbye can still play. */
  function stopMic() {
    try {
      if (procRef.current) procRef.current.onaudioprocess = null;
      procRef.current?.disconnect();
      sourceRef.current?.disconnect();
    } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    procRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
  }

  function teardown() {
    stopMic();
    try {
      wsRef.current?.close();
    } catch {}
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      ctxRef.current.close().catch(() => {});
    }
    wsRef.current = null;
    ctxRef.current = null;
    nextPlayRef.current = 0;
  }

  function pushUser(text: string) {
    setLines((prev) => {
      const next = [...prev];
      if (next.length && next[next.length - 1].role === "you") {
        next[next.length - 1] = { role: "you", text };
      } else {
        next.push({ role: "you", text });
      }
      return next;
    });
  }

  function pushGrok(text: string) {
    setLines((prev) => {
      const next = [...prev];
      if (next.length && next[next.length - 1].role === "grok") {
        next[next.length - 1] = { role: "grok", text };
      } else {
        next.push({ role: "grok", text });
      }
      return next;
    });
  }

  function playDelta(b64: string) {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const f32 = base64PCM16ToFloat32(b64);
    const buf = ctx.createBuffer(1, f32.length, SAMPLE_RATE);
    buf.getChannelData(0).set(f32);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const start = Math.max(ctx.currentTime, nextPlayRef.current);
    src.start(start);
    nextPlayRef.current = start + buf.duration;
    setStatus((s) => (s === "submitting" || s === "done" ? s : "speaking"));
  }

  async function handleFunctionCall(name: string, argsJson: string, callId: string) {
    if (name !== "submit_feedback" || submittedRef.current) return;
    submittedRef.current = true;
    setStatus("submitting");
    // Stop listening the moment we have the answers — the check-in is complete.
    stopMic();
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(argsJson);
    } catch {}
    try {
      const res = await submitFeedback({
        recallNumber: props.recallNumber,
        pharmacyId: props.pharmacyId,
        state: props.state,
        stillTaking: Boolean(args.still_taking),
        lastConsumed: String(args.last_consumed ?? ""),
        doseAmount: String(args.dose_amount ?? ""),
        symptomsText: String(args.symptoms_text ?? ""),
        recallReason: props.recallReason,
        recallingFirm: props.recallingFirm,
        channel: "voice",
      });
      setResult(res);
      setStatus("done");
      // Let the agent verbally close the loop with the triage outcome.
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({
                severity: res.triage.symptomSeverity,
                action: res.triage.action,
                priority: res.triage.priority,
              }),
            },
          }),
        );
        ws.send(JSON.stringify({ type: "response.create" }));
        // After this closing response finishes, fully tear down the connection.
        closingRef.current = true;
      } else {
        // No open socket to speak a goodbye — close out immediately.
        teardown();
      }
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  function onMessage(raw: string) {
    let ev: { type?: string; [k: string]: unknown };
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    const type = ev.type ?? "";

    if (type === "session.created") {
      configureSession();
      return;
    }
    if (type === "response.output_audio.delta") {
      playDelta(ev.delta as string);
      return;
    }
    if (
      type === "response.output_audio.done" ||
      type === "response.done"
    ) {
      asstRef.current = "";
      // Closing goodbye finished generating — let the buffered audio play out,
      // then fully close the connection so it stops listening for good.
      if (type === "response.done" && closingRef.current) {
        closingRef.current = false;
        const ctx = ctxRef.current;
        const remainMs = ctx
          ? Math.max(0, nextPlayRef.current - ctx.currentTime) * 1000
          : 0;
        window.setTimeout(() => teardown(), remainMs + 500);
        return;
      }
      setStatus((s) =>
        s === "submitting" || s === "done" || s === "error" ? s : "listening",
      );
      return;
    }
    if (type === "conversation.item.input_audio_transcription.updated") {
      pushUser(String(ev.transcript ?? ""));
      return;
    }
    if (
      type === "response.output_audio_transcript.delta" ||
      type === "response.audio_transcript.delta"
    ) {
      asstRef.current += String(ev.delta ?? "");
      pushGrok(asstRef.current);
      return;
    }
    if (
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      if (ev.transcript) pushGrok(String(ev.transcript));
      asstRef.current = "";
      return;
    }
    if (type === "response.function_call_arguments.done") {
      void handleFunctionCall(
        String(ev.name ?? ""),
        String(ev.arguments ?? "{}"),
        String(ev.call_id ?? ""),
      );
      return;
    }
    if (type === "error") {
      setError(JSON.stringify(ev.error ?? ev));
      setStatus("error");
    }
  }

  function configureSession() {
    const ws = wsRef.current;
    if (!ws) return;
    const instructions =
      `You are SafetyConnect's warm, calm patient check-in assistant on a phone call. ` +
      `A medication the patient received was just recalled by the FDA. ` +
      `Recall reason: "${props.recallReason}". Manufacturer: ${props.recallingFirm}. ` +
      `Your goal is a 30-second check-in. Ask ONE short question at a time, and gather: ` +
      `(1) are they still taking it, (2) when they last took it, (3) how much they've been taking, ` +
      `(4) how they're feeling / any symptoms. Be brief and reassuring. Do NOT diagnose or give ` +
      `medical advice — SafetyConnect triages that. As soon as you have all four answers, call the ` +
      `submit_feedback function. After it returns, briefly thank them, mention their care team has ` +
      `been notified, and if the outcome is urgent gently tell them to seek care now. Then say goodbye.`;

    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          voice: "eve",
          instructions,
          turn_detection: { type: "server_vad" },
          audio: {
            input: {
              format: { type: "audio/pcm", rate: SAMPLE_RATE },
              transcription: { model: "grok-transcribe" },
            },
            output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
          },
          tools: [
            {
              type: "function",
              name: "submit_feedback",
              description:
                "Submit the patient's recall check-in. Call this only once you have all four answers.",
              parameters: {
                type: "object",
                properties: {
                  still_taking: {
                    type: "boolean",
                    description: "Whether the patient is still taking the recalled medication",
                  },
                  last_consumed: {
                    type: "string",
                    description:
                      "When they last took it, in their words (e.g. 'this morning', '2 days ago')",
                  },
                  dose_amount: {
                    type: "string",
                    description:
                      "How much they have been taking (e.g. 'as prescribed', '2 tablets')",
                  },
                  symptoms_text: {
                    type: "string",
                    description:
                      "Symptoms the patient describes, verbatim. Use 'none' if they feel fine.",
                  },
                },
                required: [
                  "still_taking",
                  "last_consumed",
                  "dose_amount",
                  "symptoms_text",
                ],
              },
            },
          ],
        },
      }),
    );

    // Kick off the conversation — agent greets and asks the first question.
    ws.send(JSON.stringify({ type: "response.create" }));
    startMic();
    setStatus("listening");
  }

  function startMic() {
    const ctx = ctxRef.current;
    const stream = streamRef.current;
    if (!ctx || !stream) return;
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      ws.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: float32ToBase64PCM16(new Float32Array(input)),
        }),
      );
    };
    source.connect(proc);
    proc.connect(ctx.destination);
    sourceRef.current = source;
    procRef.current = proc;
  }

  async function start() {
    setError(null);
    setLines([]);
    setResult(null);
    submittedRef.current = false;
    closingRef.current = false;
    setStatus("connecting");
    try {
      const token = await getVoiceToken();
      const ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      await ctx.resume();
      ctxRef.current = ctx;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const ws = new WebSocket(
        `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(token.model)}`,
        [`xai-client-secret.${token.value}`],
      );
      wsRef.current = ws;
      ws.onmessage = (e) => onMessage(e.data as string);
      ws.onerror = () => {
        setError("Voice connection error");
        setStatus("error");
      };
      ws.onclose = () => {
        setStatus((s) => (s === "done" || s === "error" ? s : "idle"));
      };
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
      teardown();
    }
  }

  function end() {
    teardown();
    setStatus(result ? "done" : "idle");
  }

  const statusLabel: Record<Status, string> = {
    idle: "",
    connecting: "Connecting…",
    listening: "Listening — speak naturally",
    speaking: "Grok is speaking…",
    submitting: "Submitting your check-in…",
    done: "All done — thank you",
    error: "Something went wrong",
  };

  return (
    <div className="space-y-4">
      {status === "idle" ? (
        <div className="text-center">
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-violet-700"
          >
            🎙️ Start voice check-in
          </button>
          <p className="mt-2 text-xs text-slate-500">
            Talk to a Grok voice agent — it&apos;ll ask a few quick questions.
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                status === "listening"
                  ? "animate-pulse bg-emerald-500"
                  : status === "speaking"
                    ? "animate-pulse bg-violet-500"
                    : status === "error"
                      ? "bg-red-500"
                      : "bg-slate-400"
              }`}
            />
            <span className="text-sm font-medium text-slate-700">
              {statusLabel[status]}
            </span>
          </div>
          {status !== "done" && (
            <button
              type="button"
              onClick={end}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              End
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {lines.length > 0 && !result && (
        <div
          ref={transcriptRef}
          className="max-h-56 space-y-2 overflow-y-auto scroll-smooth rounded-xl border border-slate-200 bg-slate-50 p-3"
        >
          {lines.map((l, i) => (
            <div key={i} className="text-sm">
              <span
                className={`mr-2 text-[10px] font-bold uppercase ${
                  l.role === "you" ? "text-emerald-600" : "text-violet-600"
                }`}
              >
                {l.role}
              </span>
              <span className="text-slate-700">{l.text}</span>
            </div>
          ))}
        </div>
      )}

      {result && <FeedbackResult result={result} />}
    </div>
  );
}
