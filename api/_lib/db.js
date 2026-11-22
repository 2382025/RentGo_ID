import { neon } from '@neondatabase/serverless';

export function getDb() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured');
    error.statusCode = 503;
    throw error;
  }
  return neon(process.env.DATABASE_URL);
}

export function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(body));
}

export function methodNotAllowed(res, methods) {
  res.setHeader('Allow', methods.join(', '));
  return json(res, 405, { error: 'Method not allowed' });
}

export function getCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const item = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

export function sessionCookie(token, maxAge) {
  return `rentgo_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return 'rentgo_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

export async function currentUser(req, sql) {
  const token = getCookie(req, 'rentgo_session');
  if (!token) return null;
  const [session] = await sql`
    SELECT users.id, users.name, users.email, users.role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${token} AND sessions.expires_at > now()
  `;
  return session || null;
}

export function handleError(res, error) {
  console.error(error);
  const status = error.statusCode || 500;
  return json(res, status, { error: status === 500 ? 'Internal server error' : error.message });
}
