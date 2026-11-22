import { randomBytes } from 'node:crypto';
import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

export default async function handler(req, res) {
  try {
    const sql = getDb();
    if (req.method === 'GET') {
      const rows = await sql`SELECT id, seller_id AS "sellerId", brand, name, year, price_per_hour AS "pricePerHour", price_per_day AS "pricePerDay", location, location_detail AS "locationDetail", description, photo, is_open AS "isOpen", created_at AS "createdAt" FROM motors WHERE is_open = true ORDER BY created_at DESC`;
      return json(res, 200, { motors: rows });
    }
    if (req.method === 'POST') {
      const user = await currentUser(req, sql);
      if (!user) return json(res, 401, { error: 'Sign in to add a listing.' });
      if (user.role !== 'seller') return json(res, 403, { error: 'Only seller accounts can add listings.' });
      const b = req.body || {};
      if (typeof b.brand !== 'string' || !b.brand.trim() || typeof b.name !== 'string' || !b.name.trim() ||
          !Number.isInteger(Number(b.year)) || Number(b.year) < 1990 || Number(b.year) > new Date().getFullYear() + 1 ||
          !Number.isFinite(Number(b.pricePerHour)) || Number(b.pricePerHour) <= 0 ||
          !Number.isFinite(Number(b.pricePerDay)) || Number(b.pricePerDay) <= 0) {
        return json(res, 400, { error: 'Brand, model, valid year, and positive hourly and daily prices are required.' });
      }
      const id = randomBytes(16).toString('hex');
      const [motor] = await sql`INSERT INTO motors (id, seller_id, brand, name, year, price_per_hour, price_per_day, location, location_detail, description, photo) VALUES (${id}, ${user.id}, ${b.brand.trim()}, ${b.name.trim()}, ${Number(b.year)}, ${Number(b.pricePerHour)}, ${Number(b.pricePerDay)}, ${typeof b.location === 'string' ? b.location.slice(0, 160) : ''}, ${typeof b.locationDetail === 'string' ? b.locationDetail.slice(0, 300) : ''}, ${typeof b.description === 'string' ? b.description.slice(0, 2000) : ''}, ${typeof b.photo === 'string' ? b.photo.slice(0, 2000) : null}) RETURNING id, seller_id AS "sellerId", brand, name, year, price_per_hour AS "pricePerHour", price_per_day AS "pricePerDay", location, location_detail AS "locationDetail", description, photo, is_open AS "isOpen", created_at AS "createdAt"`;
      return json(res, 201, { motor });
    }
    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (error) {
    return handleError(res, error);
  }
}
