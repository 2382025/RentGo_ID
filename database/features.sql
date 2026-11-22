-- Run after database/schema.sql in the Neon SQL Editor.
-- This adds tables/columns for the current RentGo frontend data model.
-- The current frontend compresses uploaded images and stores small data URIs in these text columns.

-- User profile fields used by the frontend.
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance bigint NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS qris_photo_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspend_reason text;

-- Seller moderation fields.
ALTER TABLE motors ADD COLUMN IF NOT EXISTS admin_blocked boolean NOT NULL DEFAULT false;
ALTER TABLE motors ADD COLUMN IF NOT EXISTS block_reason text;
ALTER TABLE motors ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

-- Seller commission proof/review records.
CREATE TABLE IF NOT EXISTS commission_payments (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period text NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),
  proof_photo_url text,
  status text NOT NULL CHECK (status IN ('pending', 'verified', 'rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  admin_note text NOT NULL DEFAULT '',
  manual boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS commission_payments_seller_submitted_idx
  ON commission_payments (seller_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS commission_payments_status_idx
  ON commission_payments (status, submitted_at DESC);

-- Rentals/orders and buyer payment proof.
CREATE TABLE IF NOT EXISTS rentals (
  id text PRIMARY KEY,
  motor_id text NOT NULL REFERENCES motors(id) ON DELETE RESTRICT,
  buyer_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_time timestamptz,
  duration_hours integer NOT NULL CHECK (duration_hours > 0),
  payment_method text NOT NULL DEFAULT 'QRIS',
  total_price bigint NOT NULL CHECK (total_price >= 0),
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'pending_verification', 'booked', 'active', 'completed', 'cancelled')),
  payment_status text NOT NULL DEFAULT 'unpaid',
  payment_proof_url text,
  payment_submitted_at timestamptz,
  payment_verified_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  commission bigint NOT NULL DEFAULT 0 CHECK (commission >= 0),
  commission_paid boolean NOT NULL DEFAULT false,
  commission_pending boolean NOT NULL DEFAULT false,
  commission_paid_at timestamptz,
  commission_payment_id text REFERENCES commission_payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rentals_buyer_created_idx ON rentals (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rentals_seller_created_idx ON rentals (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rentals_motor_status_idx ON rentals (motor_id, status);

-- Normalized list of rentals included in each seller commission payment.
CREATE TABLE IF NOT EXISTS commission_payment_rentals (
  commission_payment_id text NOT NULL REFERENCES commission_payments(id) ON DELETE CASCADE,
  rental_id text NOT NULL REFERENCES rentals(id) ON DELETE RESTRICT,
  PRIMARY KEY (commission_payment_id, rental_id)
);
CREATE INDEX IF NOT EXISTS commission_payment_rentals_rental_idx
  ON commission_payment_rentals (rental_id);

-- One buyer review per rental.
CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY,
  rental_id text NOT NULL UNIQUE REFERENCES rentals(id) ON DELETE RESTRICT,
  motor_id text NOT NULL REFERENCES motors(id) ON DELETE RESTRICT,
  buyer_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_motor_created_idx ON reviews (motor_id, created_at DESC);

-- Chat messages scoped to a rental conversation.
CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  rental_id text NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  receiver_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message_text text NOT NULL DEFAULT '',
  photo_url text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (message_text <> '' OR photo_url IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS chat_messages_rental_created_idx
  ON chat_messages (rental_id, created_at);
CREATE INDEX IF NOT EXISTS chat_messages_receiver_read_idx
  ON chat_messages (receiver_id, is_read);

-- In-app notifications.
CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  rental_id text REFERENCES rentals(id) ON DELETE SET NULL,
  link text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);

-- Administrator audit trail.
CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  admin_id text REFERENCES users(id) ON DELETE SET NULL,
  admin_name text NOT NULL DEFAULT '',
  action text NOT NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);

-- Single-row platform commission and payout settings.
CREATE TABLE IF NOT EXISTS platform_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  commission_rate numeric(5,4) NOT NULL DEFAULT 0.10 CHECK (commission_rate > 0 AND commission_rate <= 0.50),
  due_day smallint NOT NULL DEFAULT 5 CHECK (due_day BETWEEN 1 AND 28),
  bank_name text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  account_holder text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Seller withdrawal request, with a payout destination snapshot for auditability.
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount bigint NOT NULL CHECK (amount > 0),
  bank_name text NOT NULL,
  account_number text NOT NULL,
  account_holder text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  admin_note text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS withdrawal_requests_seller_requested_idx
  ON withdrawal_requests (seller_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS withdrawal_requests_status_idx
  ON withdrawal_requests (status, requested_at DESC);

-- Idempotency record for one-time imports from the legacy browser app.
CREATE TABLE IF NOT EXISTS legacy_imports (
  source_hash text PRIMARY KEY,
  imported_by text REFERENCES users(id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
