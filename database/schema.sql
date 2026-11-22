-- Run this once against the Neon database connected to your Vercel project.
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('buyer', 'seller')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS motors (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand text NOT NULL,
  name text NOT NULL,
  year integer NOT NULL CHECK (year >= 1990),
  price_per_hour integer NOT NULL CHECK (price_per_hour > 0),
  price_per_day integer NOT NULL CHECK (price_per_day > 0),
  location text NOT NULL DEFAULT '',
  location_detail text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  photo text,
  is_open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS motors_available_idx ON motors (is_open, created_at DESC);

-- Booking, chat, review, payment, and admin tables are not part of this initial API yet.
