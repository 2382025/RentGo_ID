import { getDb, json, methodNotAllowed, handleError, currentUser } from '../db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const user = await currentUser(req, getDb());
    return user ? json(res, 200, { user }) : json(res, 200, { user: null });
  } catch (error) {
    return handleError(res, error);
  }
}
