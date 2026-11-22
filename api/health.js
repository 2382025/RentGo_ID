import { getDb, json, methodNotAllowed, handleError } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const sql = getDb();
    await sql`SELECT 1`;
    return json(res, 200, { status: 'ok', database: 'connected' });
  } catch (error) {
    return handleError(res, error);
  }
}
