import { getEnv } from '@/lib/env';
import { ensureSession, insertMessage, getLatestSessionForItem } from '@/lib/chat';
import { getItem } from '@/lib/items';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export const runtime = 'edge';

export async function POST(req: Request) {
  const env = getEnv();
  let body: {
    item_id?: string | null;
    session_id?: string | null;
    messages?: Array<{ role: string; content: string }>;
    // Fallback for older interface, but useChat uses `messages`
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

  // Fetch the item context to inject as system message
  let itemPayload: string = '';
  if (body.item_id) {
    try {
      const it = await getItem(env.DB, body.item_id);
      if (it) {
        itemPayload = JSON.stringify({
          title: it.title,
          summary: it.summary,
          why: it.why,
          grade: it.grade,
        });
      }
    } catch {
      /* ignore */
    }
  }

  // Prepend system message for item context
  const fullMessages: any[] = [];
  if (itemPayload) {
    fullMessages.push({ role: 'system', content: itemPayload });
  }

  // We should fetch full history from DB instead of relying purely on frontend
  let historyMessages: any[] = [];
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

  // Add the newly arrived message to DB
  await insertMessage(env.DB, sessionId, 'user', latestUserMessage.content);

  // Compile final array to send to model
  const messagesToSend = [...fullMessages, ...historyMessages, latestUserMessage];

  const base = env.RADAR_AGENT_BASE?.replace(/\/+$/, '') ?? 'http://127.0.0.1:8001';

  // Create OpenAI client pointing to our python backend
  const pythonAgent = createOpenAI({
    baseURL: base + '/v1',
    apiKey: 'mock', // Ignored by our backend
  });

  try {
    const result = await streamText({
      model: pythonAgent('radar'),
      messages: messagesToSend,
      onFinish: async ({ text }) => {
        // Automatically save the assistant's reply to DB!
        await insertMessage(env.DB, sessionId, 'assistant', text);
      },
    });

    // Send the Vercel AI SDK Data Stream protocol stream back to frontend
    // We add session_id to the headers so the client can optionally read it
    const response = result.toDataStreamResponse();
    response.headers.set('x-session-id', sessionId);
    return response;
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
