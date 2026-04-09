/**
 * Mock trace generator. Produces a structured span list from a user message
 * and an assistant reply. Replaces real span ingestion until the backend
 * starts emitting structured spans through SSE.
 *
 * When LLM_MOCK=0 in the future, the server will send {type:"meta", mock:false}
 * in the SSE stream and the UI can switch `mock: false` here — the caller just
 * passes a flag through to TraceSpan/InlineTraceRail for styling.
 */

export type SpanKind = 'ctx' | 'llm' | 'tool' | 'stream' | 'system';
export type SpanStatus = 'running' | 'done' | 'failed';

export interface SpanSection {
  label: string;
  body: string; // plain text or prerendered ``` fenced block
}

export interface MockSpan {
  id: string;
  kind: SpanKind;
  title: string;
  tool?: string;
  tokens?: number;
  ms: number;
  sections: SpanSection[];
  status?: SpanStatus; // default 'done' for chat trace; push trace uses 'running' → 'done'
}

export interface MockTrace {
  spans: MockSpan[];
  totalTokens: number;
  totalMs: number;
  mock: boolean;
  /**
   * Trace source — 'chat' (assistant reply trace) or 'push' (collection pipeline).
   * Used by TraceDrawer for header label. Defaults to 'chat'.
   */
  source?: 'chat' | 'push';
}

function pickTools(msg: string): string[] {
  const m = msg.toLowerCase();
  const tools: string[] = [];
  if (
    m.includes('commit') ||
    m.includes('活跃') ||
    m.includes('更新') ||
    m.includes('生产') ||
    m.includes('靠谱') ||
    m.includes('stars') ||
    m.includes('⭐')
  ) {
    tools.push('github');
  }
  if (
    m.includes('langchain') ||
    m.includes('对比') ||
    m.includes('比较') ||
    m.includes('和 lang') ||
    m.includes('vs')
  ) {
    tools.push('web_search');
  }
  return tools;
}

function rid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildMockTrace(args: {
  userMessage: string;
  reply: string;
  itemTitle: string;
  itemUrl: string | null;
  itemWhy: string | null;
  sessionId: string | null;
  mock: boolean;
}): MockTrace {
  const { userMessage, reply, itemTitle, itemUrl, itemWhy, sessionId } = args;
  const tools = pickTools(userMessage);
  const spans: MockSpan[] = [];

  spans.push({
    id: rid('sp'),
    kind: 'ctx',
    title: 'receive_message',
    ms: 180,
    sections: [
      { label: 'message', body: userMessage },
      {
        label: 'context',
        body: `session_id: ${sessionId ?? '(new)'}\nitem: ${itemTitle}`,
      },
    ],
  });

  spans.push({
    id: rid('sp'),
    kind: 'ctx',
    title: 'load_context · D1.items + USER.md',
    ms: 220,
    sections: [
      {
        label: 'item',
        body: `title: ${itemTitle}\nurl:   ${itemUrl ?? '—'}\nwhy:   ${
          itemWhy ?? '—'
        }`,
      },
    ],
  });

  spans.push({
    id: rid('sp'),
    kind: 'llm',
    title: 'compose_system_prompt',
    tokens: 312,
    ms: 160,
    sections: [
      {
        label: 'system prompt',
        body: `你是 Radar, Alex 的创意发现引擎。\n当前条目: ${itemTitle}`,
      },
    ],
  });

  spans.push({
    id: rid('sp'),
    kind: 'llm',
    title: tools.length ? 'reason · decide_tool_use' : 'reason · direct_answer',
    tokens: 64,
    ms: 620,
    sections: [
      {
        label: 'decision',
        body: tools.length
          ? `需要实时数据。计划调用: ${tools.join(' + ')}`
          : '凭已有知识可以回答。直接生成。',
      },
    ],
  });

  if (tools.includes('github')) {
    spans.push({
      id: rid('sp'),
      kind: 'tool',
      tool: 'github',
      title: 'fetch_github · anthropics/claude-agent-sdk',
      ms: 900,
      sections: [
        { label: 'input', body: `{ "repo": "anthropics/claude-agent-sdk" }` },
        {
          label: 'output',
          body: `{\n  "stars": 6067,\n  "issues_open": 23,\n  "commits_30d": 87,\n  "contributors_30d": 15\n}`,
        },
      ],
    });
  }

  if (tools.includes('web_search')) {
    spans.push({
      id: rid('sp'),
      kind: 'tool',
      tool: 'web_search',
      title: 'web_search · Claude Agent SDK vs LangChain',
      ms: 1100,
      sections: [
        {
          label: 'input',
          body: `{ "query": "Claude Agent SDK vs LangChain", "max_results": 5 }`,
        },
        {
          label: 'top results',
          body: `HN · Why I switched from LangChain to Claude Agent SDK (234↑)\nreddit · r/LocalLLaMA benchmark (94↑)\nblog · Anthropic 官方对比文`,
        },
      ],
    });
  }

  if (tools.length > 0) {
    spans.push({
      id: rid('sp'),
      kind: 'llm',
      title: 'synthesize · with_tool_results',
      tokens: 836,
      ms: 680,
      sections: [
        {
          label: 'token budget',
          body: `system: 312\nhistory: ~80\ntool_results: ~420\nuser_message: ~24\ntotal in: ≈ 836`,
        },
      ],
    });
  }

  spans.push({
    id: rid('sp'),
    kind: 'stream',
    title: 'stream_response',
    ms: Math.max(reply.length * 4, 300),
    sections: [
      { label: 'sink', body: '流式写入 chat_messages + 返回到前端' },
      { label: 'output', body: reply.slice(0, 600) },
    ],
  });

  const totalTokens = spans.reduce((a, s) => a + (s.tokens ?? 0), 0);
  const totalMs = spans.reduce((a, s) => a + s.ms, 0);
  return { spans, totalTokens, totalMs, mock: args.mock };
}
