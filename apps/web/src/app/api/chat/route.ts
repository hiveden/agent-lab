import { getEnv } from '@/lib/env';
import { ensureSession, insertMessage, getLatestSessionForItem } from '@/lib/chat';
import { getItem } from '@/lib/items';
import { getInternalSettings } from '@/lib/settings';
import { streamText, StreamData } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createChatTools } from '@/lib/tools';

export const runtime = 'edge';

export async function POST(req: Request) {
  const env = getEnv();
  let body: {
    item_id?: string | null;
    session_id?: string | null;
    messages?: Array<{ role: string; content: string }>;
    message?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const userMessages = body.messages ?? (body.message ? [{ role: 'user', content: body.message }] : []);
  if (!userMessages.length) {
    return new Response(JSON.stringify({ error: 'messages required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const latestUserMessage = userMessages[userMessages.length - 1];

  const sessionId = await ensureSession(env.DB, {
    sessionId: body.session_id ?? null,
    itemId: body.item_id ?? null,
    agentId: 'radar',
  });

  // ── Load LLM settings: env vars > D1 > defaults ──
  const llm = await getInternalSettings(env.DB, env.SETTINGS_SECRET, env);
  const provider = createOpenAI({
    baseURL: llm.base_url,
    apiKey: llm.api_key,
  });

  // ── Build system prompt with item context ──
  let systemPrompt = `你是 Radar,一个科技资讯策展 Agent,用中文回答用户。语气友好,回答简洁但有深度。

你有以下工具可用:
- web_search: 搜索互联网获取最新信息、对比分析
- github_stats: 获取 GitHub 仓库统计(stars, issues, 活跃度)
- search_items: 搜索数据库中已有的推荐条目

根据用户问题判断是否需要调用工具。如果凭已有知识可以回答,就直接回答,不要强行调用工具。`;

  if (body.item_id) {
    try {
      const item = await getItem(env.DB, body.item_id);
      if (item) {
        systemPrompt += `\n\n当前用户正在查看这条推荐:\n标题: ${item.title}\n摘要: ${item.summary ?? ''}\n评级: ${item.grade ?? ''}\n原因: ${item.why ?? '无'}`;
        if (item.url) systemPrompt += `\n链接: ${item.url}`;
      }
    } catch {
      /* ignore */
    }
  }

  // ── Load chat history from DB ──
  let historyMessages: Array<{ role: string; content: string }> = [];
  if (body.item_id) {
    try {
      const hist = await getLatestSessionForItem(env.DB, body.item_id);
      if (hist?.messages?.length) {
        historyMessages = hist.messages.map(m => ({ role: m.role, content: m.content }));
      }
    } catch {
      /* ignore */
    }
  }

  // Persist user message
  await insertMessage(env.DB, sessionId, 'user', latestUserMessage.content);

  // ── Compile messages ──
  type CoreRole = 'system' | 'user' | 'assistant';
  const messagesToSend: Array<{ role: CoreRole; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...historyMessages.map(m => ({ role: m.role as CoreRole, content: m.content })),
    { role: latestUserMessage.role as CoreRole, content: latestUserMessage.content },
  ];

  try {
    const tools = createChatTools({
      db: env.DB,
      tavilyApiKey: env.TAVILY_API_KEY,
    });
    const streamData = new StreamData();
    let stepIndex = 0;
    const stepStartTimes: Record<number, number> = {};

    const result = await streamText({
      model: provider(llm.model_chat),
      tools,
      maxSteps: 5,
      messages: messagesToSend,
      onStepFinish: async ({ text, toolCalls, toolResults, finishReason, usage }) => {
        const elapsed = stepStartTimes[stepIndex]
          ? Date.now() - stepStartTimes[stepIndex]
          : 0;

        streamData.appendMessageAnnotation(JSON.parse(JSON.stringify({
          type: 'step',
          stepIndex,
          finishReason,
          text: text?.slice(0, 200) || null,
          toolCalls: (toolCalls ?? []).map((tc: { toolCallId: string; toolName: string; args: unknown }) => ({
            id: tc.toolCallId,
            name: tc.toolName,
            args: tc.args,
          })),
          usage: usage ?? null,
          durationMs: elapsed,
        })));
        stepIndex++;
        stepStartTimes[stepIndex] = Date.now();
      },
      onFinish: async ({ text, steps }) => {
        // Build tool call + result pairs
        const toolResultMap = new Map<string, unknown>();
        for (const s of steps) {
          for (const tr of (s.toolResults ?? []) as Array<{ toolCallId: string; result: unknown }>) {
            toolResultMap.set(tr.toolCallId, tr.result);
          }
        }
        const allToolCalls = steps.flatMap(s =>
          (s.toolCalls ?? []).map((tc: { toolCallId: string; toolName: string; args: unknown }) => ({
            id: tc.toolCallId,
            name: tc.toolName,
            args: tc.args,
            result: toolResultMap.get(tc.toolCallId) ?? null,
          }))
        );
        // Collect step annotations for persistence
        const annotations = steps.map((s, i) => ({
          type: 'step' as const,
          stepIndex: i,
          finishReason: s.finishReason,
          text: s.text?.slice(0, 200) || null,
          toolCalls: (s.toolCalls ?? []).map((tc: { toolCallId: string; toolName: string; args: unknown }) => ({
            id: tc.toolCallId, name: tc.toolName, args: tc.args,
            result: toolResultMap.get(tc.toolCallId) ?? null,
          })),
          usage: s.usage ?? null,
        }));
        const metadata = { toolCalls: allToolCalls, annotations };
        await insertMessage(env.DB, sessionId, 'assistant', text, [metadata]);
        await streamData.close();
      },
    });

    stepStartTimes[0] = Date.now();

    const response = result.toDataStreamResponse({ data: streamData });
    response.headers.set('x-session-id', sessionId);
    return response;
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
