import process from 'node:process';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { neon } from '@neondatabase/serverless';

try {
  process.loadEnvFile('.env.local');
} catch {
  // Vercel or a shell may already provide DATABASE_URL.
}

const databaseUrl = process.env.DATABASE_URL;
const password = process.env.ADMIN_PASSWORD;
const email = (process.env.ADMIN_EMAIL || 'admin@rentgo.id').trim().toLowerCase();

if (!databaseUrl) throw new Error('DATABASE_URL is missing. Put it in .env.local or set it in the environment.');
if (!password || Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) {
  throw new Error('Set ADMIN_PASSWORD to a value between 8 and 72 UTF-8 bytes before running this script.');
}

const sql = neon(databaseUrl);
const passwordHash = await bcrypt.hash(password, 12);
const id = `admin_${randomBytes(16).toString('hex')}`;
const [admin] = await sql`
  INSERT INTO users (id, name, email, password_hash, role, phone)
  VALUES (${id}, 'Administrator RentGo', ${email}, ${passwordHash}, 'admin', '')
  ON CONFLICT (email) DO UPDATE
    SET name = 'Administrator RentGo', password_hash = EXCLUDED.password_hash, role = 'admin'
  RETURNING id, email, role
`;

console.log(`Admin account ready: ${admin.email} (${admin.role}).`);
