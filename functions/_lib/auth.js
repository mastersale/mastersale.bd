// Admin authentication: one owner password, signed session token.
// Token is accepted from an HttpOnly cookie (website) or a Bearer header (mobile apps).

import { HttpError } from './util.js';

const enc = new TextEncoder();
const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signToken(env, ttlSeconds = 60 * 60 * 24 * 7) {
  if (!env.SESSION_SECRET) throw new HttpError(500, 'Server is missing SESSION_SECRET.');
  const payload = b64u.enc(enc.encode(JSON.stringify({ role: 'admin', exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(payload));
  return `${payload}.${b64u.enc(sig)}`;
}

export async function verifyToken(env, token) {
  try {
    if (!token || !env.SESSION_SECRET) return false;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), b64u.dec(sig), enc.encode(payload));
    if (!ok) return false;
    const data = JSON.parse(new TextDecoder().decode(b64u.dec(payload)));
    return data.role === 'admin' && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function readCookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  for (const part of c.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

export async function isAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return verifyToken(env, bearer || readCookie(request, 'admin_session'));
}

// Constant-time password check (compares SHA-256 digests)
export async function checkPassword(env, given) {
  if (!env.ADMIN_PASSWORD) throw new HttpError(500, 'Server is missing ADMIN_PASSWORD.');
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(given || ''))),
    crypto.subtle.digest('SHA-256', enc.encode(env.ADMIN_PASSWORD)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function sessionCookie(token, maxAge) {
  return `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

// Throttle brute force: 8 failed attempts per IP per 15 minutes
export async function tooManyAttempts(db, ip) {
  const since = Math.floor(Date.now() / 1000) - 900;
  await db.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(since).run();
  const r = await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts >= ?').bind(ip, since).first();
  return (r?.n || 0) >= 8;
}
export async function recordFailure(db, ip) {
  await db.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)').bind(ip, Math.floor(Date.now() / 1000)).run();
}
export async function clearFailures(db, ip) {
  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
}
