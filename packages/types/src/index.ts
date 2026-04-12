/**
 * Shared types between Next.js (apps/web) and Python agents.
 * 这是平台内部前后端契约的唯一来源 (TS 侧),Python 侧用 agents/shared/schema.py 镜像。
 */

export type Grade = 'fire' | 'bolt' | 'bulb';
export type ItemStatus = 'unread' | 'watching' | 'discussed' | 'dismissed' | 'applied' | 'rejected';
export type AgentId = 'radar' | 'pulse' | 'scout' | 'tts-quality';
export type ItemType = 'recommendation' | 'quality-issue';
export type SourceType = 'hacker-news' | 'http' | 'rss' | 'grok';
export type RawItemStatus = 'pending' | 'evaluated' | 'promoted' | 'rejected';
export type RunPhase = 'ingest' | 'evaluate';
export type RunStatus = 'running' | 'done' | 'failed';

export interface Item {
  id: string;
  external_id: string;
  agent_id: AgentId;
  item_type: ItemType;
  grade: Grade;
  title: string;
  summary: string;
  why: string | null;
  url: string | null;
  source: string | null;
  tags: string[];
  payload: Record<string, unknown>;
  round_at: string;
  created_at: string;
}

export interface ItemBatchInput {
  round_at: string;
  items: Array<Omit<Item, 'id' | 'created_at'>>;
}

export interface UserState {
  item_id: string;
  user_id: string;
  status: ItemStatus;
  updated_at: string;
}

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ChatMessage {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  tool_calls: unknown[] | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  item_id: string | null;
  agent_id: AgentId;
  created_at: string;
}

// ── Sources ──

export interface Source {
  id: string;
  agent_id: AgentId;
  source_type: SourceType;
  name: string;
  config: Record<string, unknown>;
  attention_weight: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ── Raw Items ──

export interface RawItem {
  id: string;
  source_id: string;
  agent_id: AgentId;
  external_id: string;
  title: string;
  url: string | null;
  raw_payload: Record<string, unknown>;
  status: RawItemStatus;
  run_id: string | null;
  fetched_at: string;
}

// ── Runs ──

export interface Run {
  id: string;
  agent_id: AgentId;
  phase: RunPhase;
  status: RunStatus;
  source_ids: string[];
  stats: Record<string, unknown>;
  trace: unknown[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}
