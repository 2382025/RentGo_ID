-- Run this once against the Neon database connected to your Vercel project.
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('buyer', 'seller')),
  phone text NOT NULL DEFAULT '',
  bank_name text,
  account_number text,
  account_holder text,
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
  helm_included boolean NOT NULL DEFAULT false,
  helm_count integer NOT NULL DEFAULT 0 CHECK (helm_count >= 0),
  is_open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS motors_available_idx ON motors (is_open, created_at DESC);

-- Safe to rerun when updating a database created from an earlier version of this schema.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_holder text;
ALTER TABLE motors ADD COLUMN IF NOT EXISTS helm_included boolean NOT NULL DEFAULT false;
ALTER TABLE motors ADD COLUMN IF NOT EXISTS helm_count integer NOT NULL DEFAULT 0;

-- Booking, chat, review, payment, and admin tables are not part of this initial API yet.
