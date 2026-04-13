/**
 * Build a Trace from AI SDK messages.
 * Data sources:
 * - message.toolInvocations → tool call spans
 * - message.annotations → step-level spans (from onStepFinish via StreamData)
 */

import type { Message } from 'ai';

export type SpanKind = 'ctx' | 'llm' | 'tool' | 'stream' | 'system';
export type SpanStatus = 'running' | 'done' | 'failed';

export interface SpanSection {
  label: string;
  body: string;
}

export interface Span {
  id: string;
  kind: SpanKind;
  title: string;
  tool?: string;
  tokens?: number;
  ms: number;
  sections: SpanSection[];
  status?: SpanStatus;
}

export interface Trace {
  spans: Span[];
  totalTokens: number;
  totalMs: number;
  mock: boolean;
  source?: 'chat' | 'push';
}

interface StepAnnotation {
  type: 'step';
  stepIndex: number;
  finishReason: string;
  text: string | null;
  toolCalls: Array<{ id: string; name: string; args: unknown }>;
  usage: { promptTokens?: number; completionTokens?: number } | null;
  durationMs: number;
}

function isStepAnnotation(v: unknown): v is StepAnnotation {
  return typeof v === 'object' && v !== null && (v as Record<string, unknown>).type === 'step';
}

export function buildTraceFromMessages(messages: Message[]): Trace {
  const spans: Span[] = [];
  let totalTokens = 0;
  let totalMs = 0;

  for (const m of messages) {
    if (m.role !== 'assistant') continue;

    // Step annotations keyed by tool call ID for enrichment
    const steps = ((m.annotations ?? []) as unknown[]).filter(isStepAnnotation);
    const stepByToolId = new Map<string, StepAnnotation>();
    for (const step of steps) {
      for (const tc of step.toolCalls) {
        stepByToolId.set(tc.id, step);
      }
    }

    // 1. Tool invocations — real-time source of truth (shows running state immediately)
    const seenToolIds = new Set<string>();
    if (m.toolInvocations?.length) {
      for (const inv of m.toolInvocations) {
        seenToolIds.add(inv.toolCallId);
        const step = stepByToolId.get(inv.toolCallId);
        const ms = step?.durationMs ?? 0;
        const tokens = step ? (step.usage?.promptTokens ?? 0) + (step.usage?.completionTokens ?? 0) : 0;
        totalTokens += tokens;
        totalMs += ms;

        const sections: SpanSection[] = [
          { label: 'input', body: JSON.stringify(inv.args, null, 2) },
        ];
        if (inv.state === 'result') {
          sections.push({ label: 'output', body: JSON.stringify(inv.result, null, 2) });
        }
        spans.push({
          id: `${m.id}-${inv.toolCallId}`,
          kind: 'tool',
          tool: inv.toolName,
          title: inv.toolName,
          tokens,
          ms,
          sections,
          status: inv.state === 'result' ? 'done' : 'running',
        });
      }
    }

    // 2. Step annotations — add LLM reasoning steps + any tool calls not in toolInvocations
    for (const step of steps) {
      const ms = step.durationMs || 0;
      const tokens = (step.usage?.promptTokens ?? 0) + (step.usage?.completionTokens ?? 0);

      // Tool calls already covered by toolInvocations above
      if (step.toolCalls.length > 0 && step.toolCalls.every(tc => seenToolIds.has(tc.id))) {
        continue;
      }

      // LLM text generation step
      if (step.text && step.toolCalls.length === 0) {
        totalTokens += tokens;
        totalMs += ms;
        spans.push({
          id: `${m.id}-step-${step.stepIndex}`,
          kind: 'llm',
          title: step.finishReason === 'stop' ? '生成回复' : `推理 (${step.finishReason})`,
          tokens,
          ms,
          sections: [
            { label: 'output', body: step.text.slice(0, 500) },
            ...(tokens > 0 ? [{ label: 'tokens', body: `prompt: ${step.usage?.promptTokens ?? '—'} · completion: ${step.usage?.completionTokens ?? '—'}` }] : []),
          ],
          status: 'done',
        });
      }
    }
  }

  return { spans, totalTokens, totalMs, mock: false };
}
