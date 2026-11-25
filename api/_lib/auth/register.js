import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb, json, methodNotAllowed, handleError, sessionCookie } from '../db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { name, email, password, role, phone, bank, storeName } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100 ||
        typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) ||
        typeof password !== 'string' || password.length < 8 || password.length > 72 ||
        !['buyer', 'seller'].includes(role)) {
      return json(res, 400, { error: 'Provide a name, valid email, password (8–72 characters), and buyer or seller role.' });
    }
    const sql = getDb();
    const passwordHash = await bcrypt.hash(password, 12);
    const id = randomBytes(16).toString('hex');
    if (phone !== undefined && (typeof phone !== 'string' || phone.length > 40)) return json(res, 400, { error: 'Phone number is invalid.' });
    if (role === 'seller' && (typeof storeName !== 'string' || storeName.trim().length < 2 || storeName.trim().length > 100)) return json(res, 400, { error: 'Seller store name must be between 2 and 100 characters.' });
    if (role === 'seller' && (!bank || typeof bank.bankName !== 'string' || !bank.bankName.trim() || typeof bank.accountNumber !== 'string' || !bank.accountNumber.trim() || typeof bank.accountHolder !== 'string' || !bank.accountHolder.trim())) {
      return json(res, 400, { error: 'Seller bank details are required.' });
    }
    const [user] = await sql`
      INSERT INTO users (id, name, email, password_hash, role, phone, store_name, bank_name, account_number, account_holder)
      VALUES (${id}, ${name.trim()}, ${email.trim().toLowerCase()}, ${passwordHash}, ${role}, ${phone || ''}, ${role==='seller'?storeName.trim():''}, ${bank?.bankName || null}, ${bank?.accountNumber || null}, ${bank?.accountHolder || null})
      ON CONFLICT (email) DO NOTHING
      RETURNING id, name, email, role, phone, store_name AS "storeName", bank_name AS "bankName", account_number AS "accountNumber", account_holder AS "accountHolder"
    `;
    if (!user) return json(res, 409, { error: 'An account with this email already exists.' });
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${tokenHash}, ${id}, now() + interval '30 days')`;
    res.setHeader('Set-Cookie', sessionCookie(token, 60 * 60 * 24 * 30));
    return json(res, 201, { user });
  } catch (error) {
    return handleError(res, error);
  }
}
