/**
 * Shared types between Next.js (apps/web) and Python agents.
 * 这是平台内部前后端契约的唯一来源 (TS 侧),Python 侧用 agents/shared/schema.py 镜像。
 */

export type Grade = 'fire' | 'bolt' | 'bulb';
export type ItemStatus = 'unread' | 'watching' | 'discussed' | 'dismissed' | 'applied' | 'rejected';
export type AgentId = 'radar' | 'pulse' | 'scout' | 'tts-quality';
export type ItemType = 'recommendation' | 'quality-issue';

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
