import { scrypt, timingSafeEqual } from 'node:crypto';
const bytesToHex = (b: Uint8Array) => Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
const hexToBytes = (s: string) => Uint8Array.from(s.match(/.{2}/g) || [], h => parseInt(h, 16));
function derive(password: string, salt: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => scrypt(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result)));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  return `scrypt:${salt}:${bytesToHex(await derive(password, salt))}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [scheme, salt, expected] = hash.split(':');
  if (scheme !== 'scrypt' || !salt || expected?.length !== 128) return false;
  return timingSafeEqual(await derive(password, salt), hexToBytes(expected));
}
export async function digest(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export function validateAccount(username: unknown, password: unknown): { username: string; password: string } {
  if (typeof username !== 'string' || !/^[\p{Script=Han}a-zA-Z0-9_-]{2,24}$/u.test(username.trim())) throw new Error('用户名需为 2–24 位中文、字母、数字、下划线或短横线');
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw new Error('密码需为 10–128 位');
  return { username: username.trim(), password };
}
