/**
 * 注意力聚合与偏差计算。
 *
 * 计算逻辑独立解耦——修改权重公式只需改 SIGNAL_WEIGHTS 和 computeScore()。
 */

import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from './db';
import { items, userStates, chatSessions, chatMessages, sources } from './db/schema';
import { eq, and, sql, count, ne } from 'drizzle-orm';
import { DEFAULT_USER_ID } from './env';

// ── 信号权重（可调参数，集中在这里） ──

export const SIGNAL_WEIGHTS = {
  consumed: 1,    // status != 'unread' && status != 'dismissed'
  watching: 2,    // status == 'watching'
  chatRound: 3,   // 每轮用户消息
  dismissed: 0,   // 不计入正向注意力
} as const;

// ── 类型 ──

export interface SourceAttention {
  source_id: string;
  source_name: string;
  source_type: string;
  expected_weight: number;   // 用户配置的预期权重
  actual_weight: number;     // 实际注意力占比 (0-1)
  deviation: number;         // actual - expected（正=过度关注，负=被忽略）
  raw_score: number;         // 原始分数
  detail: {
    total_items: number;
    consumed: number;        // 看了的
    watching: number;        // 深度关注
    discussed: number;       // 有对话的
    dismissed: number;       // 丢弃的
    chat_rounds: number;     // 总对话轮次
  };
}

export interface AttentionSnapshot {
  agent_id: string;
  computed_at: string;
  total_score: number;
  sources: SourceAttention[];
  weights_config: typeof SIGNAL_WEIGHTS;
}

// ── 计算逻辑 ──

function computeScore(detail: SourceAttention['detail']): number {
  return (
    detail.consumed * SIGNAL_WEIGHTS.consumed +
    detail.watching * SIGNAL_WEIGHTS.watching +
    detail.chat_rounds * SIGNAL_WEIGHTS.chatRound
  );
}

export async function computeAttentionSnapshot(
  d1: D1Database,
  agentId: string = 'radar',
): Promise<AttentionSnapshot> {
  const db = getDb(d1);

  // 1. 拿所有 enabled sources
  const allSources = await db
    .select()
    .from(sources)
    .where(and(eq(sources.agent_id, agentId), eq(sources.enabled, true)));

  // 2. 按 source_type 聚合 item 状态
  //    items.source 存的是 source_type (如 "hacker-news")
  const statusRows = await db
    .select({
      source_type: items.source,
      status: sql<string>`COALESCE(${userStates.status}, 'unread')`.as('status'),
      cnt: count().as('cnt'),
    })
    .from(items)
    .leftJoin(
      userStates,
      and(
        eq(userStates.item_id, items.id),
        eq(userStates.user_id, DEFAULT_USER_ID),
      ),
    )
    .where(eq(items.agent_id, agentId))
    .groupBy(items.source, sql`COALESCE(${userStates.status}, 'unread')`);

  // 3. 按 source_type 聚合 chat 轮次（只算 user 消息）
  const chatRows = await db
    .select({
      source_type: items.source,
      rounds: count().as('rounds'),
    })
    .from(chatMessages)
    .innerJoin(chatSessions, eq(chatMessages.session_id, chatSessions.id))
    .innerJoin(items, eq(chatSessions.item_id, items.id))
    .where(
      and(
        eq(items.agent_id, agentId),
        eq(chatMessages.role, 'user'),
      ),
    )
    .groupBy(items.source);

  // 4. 组装每个 source 的 detail
  const chatMap = new Map(chatRows.map((r) => [r.source_type, r.rounds]));

  const sourceDetails = new Map<string, SourceAttention['detail']>();

  for (const row of statusRows) {
    const st = row.source_type ?? 'unknown';
    if (!sourceDetails.has(st)) {
      sourceDetails.set(st, {
        total_items: 0, consumed: 0, watching: 0,
        discussed: 0, dismissed: 0, chat_rounds: 0,
      });
    }
    const d = sourceDetails.get(st)!;
    d.total_items += row.cnt;

    switch (row.status) {
      case 'watching':
        d.consumed += row.cnt;
        d.watching += row.cnt;
        break;
      case 'discussed':
        d.consumed += row.cnt;
        d.discussed += row.cnt;
        break;
      case 'applied':
        d.consumed += row.cnt;
        break;
      case 'dismissed':
      case 'rejected':
        d.dismissed += row.cnt;
        break;
      case 'unread':
        // 不计入
        break;
      default:
        d.consumed += row.cnt;
    }
  }

  // 注入 chat rounds
  for (const [st, rounds] of chatMap) {
    const d = sourceDetails.get(st ?? 'unknown');
    if (d) d.chat_rounds = rounds;
  }

  // 5. 计算 scores 和 weights
  const sourceAttentions: SourceAttention[] = [];

  for (const src of allSources) {
    const detail = sourceDetails.get(src.source_type) ?? {
      total_items: 0, consumed: 0, watching: 0,
      discussed: 0, dismissed: 0, chat_rounds: 0,
    };
    const raw_score = computeScore(detail);
    sourceAttentions.push({
      source_id: src.id,
      source_name: src.name,
      source_type: src.source_type,
      expected_weight: src.attention_weight,
      actual_weight: 0, // 先占位，下面算
      deviation: 0,
      raw_score,
      detail,
    });
  }

  const totalScore = sourceAttentions.reduce((sum, s) => sum + s.raw_score, 0);

  for (const sa of sourceAttentions) {
    sa.actual_weight = totalScore > 0 ? sa.raw_score / totalScore : 0;
    sa.deviation = sa.actual_weight - sa.expected_weight;
  }

  return {
    agent_id: agentId,
    computed_at: new Date().toISOString(),
    total_score: totalScore,
    sources: sourceAttentions,
    weights_config: SIGNAL_WEIGHTS,
  };
}
