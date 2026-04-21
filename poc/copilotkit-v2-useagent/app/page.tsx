"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import { otelTraceEvents } from "./otel-init";

/**
 * CopilotKit v2 signature (confirmed from .d.mts in this project's node_modules):
 *
 *   function useAgent(props?: UseAgentProps): { agent: AbstractAgent }
 *   interface UseAgentProps { agentId?; threadId?; updates?; throttleMs? }
 *
 * `agent` is an AbstractAgent from @ag-ui/client, exposing:
 *   - messages: Message[]           // streamed from SSE
 *   - isRunning: boolean            // flips on RUN_STARTED / RUN_FINISHED
 *   - runAgent(params?, subscriber?): Promise<RunAgentResult>
 *   - addMessage(m) / addMessages(ms) / setMessages(ms)
 *   - subscribe(sub): { unsubscribe }
 *
 * To re-render the component on streaming updates we must pass `updates`
 * (OnMessagesChanged / OnRunStatusChanged) — otherwise the hook is silent.
 * This is the key knob Phase D uses to verify V1/V7.
 */

// Stable refs — issue #32 lesson. DO NOT inline into hook args.
const AGENT_UPDATES = Object.freeze([
  UseAgentUpdate.OnMessagesChanged,
  UseAgentUpdate.OnRunStatusChanged,
  UseAgentUpdate.OnStateChanged,
]) as unknown as UseAgentUpdate[];

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg_${Math.random().toString(36).slice(2)}${Date.now()}`;
}

export default function Page() {
  // useMemo with empty deps — identity must never change across renders.
  const agentProps = useMemo(
    () => ({ agentId: "radar", updates: AGENT_UPDATES }),
    [],
  );

  const { agent } = useAgent(agentProps);

  const messages = agent.messages;
  const isRunning = agent.isRunning;

  // Flatten toolCalls off assistant messages for quick at-a-glance inspection.
  const toolCalls = useMemo(() => {
    const all: unknown[] = [];
    for (const m of messages ?? []) {
      const tc = (m as { toolCalls?: unknown[] }).toolCalls;
      if (Array.isArray(tc)) all.push(...tc);
    }
    return all;
  }, [messages]);

  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastTraceId, setLastTraceId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // V3/V4 验证：订阅浏览器 OTel 发出的 chat-trace 事件，
  // 把 trace_id 显示在 UI 方便粘到 Langfuse :3010 / SigNoz :3301 搜索。
  useEffect(() => {
    const target = otelTraceEvents;
    if (!target) return;
    const handler = (e: Event) => {
      const { traceId } = (e as CustomEvent<{ traceId: string }>).detail;
      console.log("[poc] chat trace", traceId);
      setLastTraceId(traceId);
      setCopied(false);
    };
    target.addEventListener("chat-trace", handler);
    return () => target.removeEventListener("chat-trace", handler);
  }, []);

  async function copyTrace() {
    if (!lastTraceId) return;
    try {
      await navigator.clipboard.writeText(lastTraceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const content = input.trim();
    if (!content) return;
    setSendError(null);
    setInput("");
    try {
      // 1. Append user message to the agent's message list.
      agent.addMessage({ id: genId(), role: "user", content });
      // 2. Kick off a run — SSE stream fills assistant messages + tool calls.
      await agent.runAgent();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={{ margin: 0, fontSize: 18 }}>CopilotKit v2 · useAgent PoC</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {lastTraceId && (
            <button
              type="button"
              onClick={copyTrace}
              title="点击复制 trace_id → 粘到 Langfuse :3010 / SigNoz :3301 搜索"
              style={styles.traceChip}
            >
              <span style={styles.traceChipLabel}>trace</span>
              <code style={styles.traceChipValue}>{lastTraceId.slice(0, 16)}…</code>
              <span style={styles.traceChipCopy}>{copied ? "✓" : "⧉"}</span>
            </button>
          )}
          <span data-testid="status-badge" style={styles.badge(isRunning)}>
            {isRunning ? "running…" : "idle"}
          </span>
        </div>
      </header>

      <section style={styles.messages} aria-label="messages">
        {(!messages || messages.length === 0) && (
          <div style={styles.empty}>No messages yet. Send one below.</div>
        )}
        {messages?.map((m, i) => {
          const role = (m as { role?: string }).role ?? "?";
          const content = (m as { content?: unknown }).content;
          const text =
            typeof content === "string" ? content : JSON.stringify(content);
          return (
            <div key={(m as { id?: string }).id ?? i} style={styles.msg(role)}>
              <div style={styles.msgRole}>{role}</div>
              <div style={styles.msgBody}>{text}</div>
            </div>
          );
        })}
      </section>

      <form onSubmit={onSubmit} style={styles.form}>
        <input
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the radar agent…"
          autoComplete="off"
        />
        <button type="submit" style={styles.button} disabled={!input.trim() || isRunning}>
          {isRunning ? "Running…" : "Send"}
        </button>
      </form>
      {sendError && <div style={styles.error}>{sendError}</div>}

      <section style={styles.debug}>
        <div style={styles.debugTitle}>live state (isRunning / toolCalls / messages)</div>
        <pre style={styles.pre}>
          {JSON.stringify({ isRunning, toolCalls, messages }, null, 2)}
        </pre>
      </section>
    </main>
  );
}

const styles = {
  main: {
    maxWidth: 960,
    margin: "0 auto",
    padding: "24px 20px 80px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  badge: (running: boolean) => ({
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 999,
    background: running ? "#264d2b" : "#2a2f3d",
    color: running ? "#9be8a0" : "#a6adbb",
    border: `1px solid ${running ? "#3b6b42" : "#3a4152"}`,
  }),
  messages: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    minHeight: 220,
    padding: 12,
    border: "1px solid #242a3a",
    background: "#11172a",
    borderRadius: 8,
  },
  empty: { color: "#6b7489", fontSize: 13 },
  msg: (role: string) => ({
    padding: "8px 10px",
    borderRadius: 6,
    background: role === "user" ? "#1b2740" : "#1a2030",
    border: "1px solid #232a3d",
  }),
  msgRole: { fontSize: 11, opacity: 0.7, marginBottom: 4 },
  msgBody: { whiteSpace: "pre-wrap" as const, fontSize: 14, lineHeight: 1.5 },
  form: { display: "flex", gap: 8 },
  input: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid #2a3145",
    background: "#0f1427",
    color: "#e7ecf5",
    fontSize: 14,
  },
  button: {
    padding: "10px 16px",
    borderRadius: 6,
    border: "1px solid #3b4a7a",
    background: "#1f2d5c",
    color: "#e7ecf5",
    fontSize: 14,
    cursor: "pointer",
  },
  error: {
    padding: "8px 12px",
    background: "#3a1f22",
    border: "1px solid #6b2e32",
    color: "#f5b5b8",
    borderRadius: 6,
    fontSize: 13,
  },
  debug: {
    marginTop: 8,
    padding: 12,
    border: "1px solid #242a3a",
    background: "#0d1224",
    borderRadius: 8,
  },
  debugTitle: { fontSize: 12, opacity: 0.7, marginBottom: 6 },
  pre: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    color: "#bfd0ef",
  },
  traceChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid #3a4152",
    background: "#1a2030",
    color: "#9be8a0",
    fontSize: 11,
    cursor: "pointer",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  traceChipLabel: { opacity: 0.6 },
  traceChipValue: { color: "#bfd0ef" },
  traceChipCopy: { opacity: 0.7 },
} as const;
