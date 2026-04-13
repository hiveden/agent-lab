/**
 * Legacy type re-exports for backward compatibility.
 * Real trace types and builder are now in @/lib/trace.ts.
 * buildMockTrace removed — traces are now derived from AI SDK toolInvocations.
 */

export type { Span as MockSpan, Trace as MockTrace, SpanKind, SpanStatus, SpanSection } from '@/lib/trace';
