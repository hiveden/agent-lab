/**
 * AES-256-GCM 加密/解密 — 用于 API key 落库加密。
 *
 * 存储格式: hexIV:hexCiphertext (IV 12 bytes, 随机生成)
 * 密钥来源: SETTINGS_SECRET env var (64 char hex = 32 bytes)
 */

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function importKey(secretHex: string): Promise<CryptoKey> {
  const raw = hexToBytes(secretHex);
  return crypto.subtle.importKey('raw', raw as unknown as ArrayBuffer, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encrypt(
  plaintext: string,
  secretHex: string,
): Promise<string> {
  const key = await importKey(secretHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(cipherBuf))}`;
}

export async function decrypt(
  encrypted: string,
  secretHex: string,
): Promise<string> {
  const [ivHex, cipherHex] = encrypted.split(':');
  if (!ivHex || !cipherHex) throw new Error('invalid encrypted format');
  const key = await importKey(secretHex);
  const iv = hexToBytes(ivHex);
  const cipher = hexToBytes(cipherHex);
  const plainBuf = await crypto.subtle.decrypt(
    // @ts-expect-error Cloudflare Workers type mismatch
    { name: 'AES-GCM', iv },
    key,
    cipher,
  );
  return new TextDecoder().decode(plainBuf);
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return key.slice(0, 3) + '***' + key.slice(-4);
}
