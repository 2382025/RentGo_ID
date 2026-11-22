import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb, json, methodNotAllowed, handleError, sessionCookie } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') return json(res, 400, { error: 'Email and password are required.' });
    const sql = getDb();
    const [user] = await sql`SELECT id, name, email, role, password_hash FROM users WHERE email = ${email.trim().toLowerCase()}`;
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return json(res, 401, { error: 'Invalid email or password.' });
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${tokenHash}, ${user.id}, now() + interval '30 days')`;
    res.setHeader('Set-Cookie', sessionCookie(token, 60 * 60 * 24 * 30));
    delete user.password_hash;
    return json(res, 200, { user });
  } catch (error) {
    return handleError(res, error);
  }
}
