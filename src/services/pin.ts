/** هش PIN با PBKDF2-SHA256 (WebCrypto)؛ PIN هرگز به‌صورت خام ذخیره نمی‌شود */
export const PIN_ITERATIONS = 120_000
export const PIN_PATTERN = /^\d{4,8}$/

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)))

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const subtle = globalThis.crypto.subtle
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256)
  return hex(new Uint8Array(bits))
}

export async function hashPin(pin: string, iterations = PIN_ITERATIONS): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return { hash: await derive(pin, salt, iterations), salt: hex(salt), iterations }
}

export async function verifyPin(pin: string, stored: { hash: string; salt: string; iterations: number }): Promise<boolean> {
  const got = await derive(pin, unhex(stored.salt), stored.iterations)
  // مقایسه با زمان ثابت
  if (got.length !== stored.hash.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ stored.hash.charCodeAt(i)
  return diff === 0
}
