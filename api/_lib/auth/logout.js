import { createHash } from 'node:crypto';
import { getDb, getCookie, json, methodNotAllowed, handleError, clearSessionCookie } from '../db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const token = getCookie(req, 'rentgo_session');
    if (token) {
      const hash = createHash('sha256').update(token).digest('hex');
      await getDb()`DELETE FROM sessions WHERE token_hash = ${hash}`;
    }
    res.setHeader('Set-Cookie', clearSessionCookie());
    return json(res, 200, { ok: true });
  } catch (error) {
    return handleError(res, error);
  }
}
