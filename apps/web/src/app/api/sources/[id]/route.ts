import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { getSource, updateSource, deleteSource } from '@/lib/sources';
import { sourceUpdateSchema } from '@/lib/validations';

export const runtime = 'edge';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const env = getEnv();
  const source = await getSource(env.DB, id);
  if (!source) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ source });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const env = getEnv();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = sourceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
  }
  await updateSource(env.DB, id, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const env = getEnv();
  await deleteSource(env.DB, id);
  return NextResponse.json({ ok: true });
}
