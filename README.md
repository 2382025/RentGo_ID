# RentGo

RentGo is an Indonesian motorcycle rental marketplace. The original interface is in `RentGo_V4.html`; `index.html` is the Vercel-served frontend entry point. A Vercel Functions API and Neon Postgres schema are included for account sessions and motorcycle listings.

## Run locally

1. Install Node.js 20 or newer.
2. Install the project dependencies with `npm install`.
3. Install Vercel CLI if needed (`npm install --global vercel`).
4. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your Neon pooled connection string.
5. Run `vercel dev` (or `npm run dev`).

The static demo interface can also be opened directly as `index.html`. Its current sign-in, booking, chat, admin, and seller flows still use browser `localStorage`; the new API is a database-backed foundation and is not yet connected to those existing demo interactions. API accounts and listings live in Neon.

## Vercel and database setup

1. Push this repository to GitHub.
2. Import the repository in Vercel.
3. In the Vercel project, add a Neon Postgres database from the Storage/Marketplace integrations. Vercel's database integrations are provisioned by providers such as Neon.
4. Add the provider's pooled connection string as `DATABASE_URL` for Development, Preview, and Production. Redeploy after adding it.
5. Run `database/schema.sql` once in the Neon SQL Editor.
6. Check `/api/health`; a successful response is `{"status":"ok","database":"connected"}`.

Do not commit `.env` or `.env.local`. `.env.example` contains only a placeholder. Vercel provides the production environment variables at runtime.

## API

- `GET /api/health` — checks the database connection.
- `POST /api/auth/register` — creates a buyer or seller account. JSON: `{ "name", "email", "password", "role" }`.
- `POST /api/auth/login` — signs in. JSON: `{ "email", "password" }`.
- `GET /api/auth/me` — returns the current session user or `null`.
- `POST /api/auth/logout` — revokes the current session.
- `GET /api/motors` — lists available database-backed listings.
- `POST /api/motors` — creates a listing for the signed-in seller. JSON fields include `brand`, `name`, `year`, `pricePerHour`, and `pricePerDay`; location, description, and photo are optional.

Passwords are bcrypt-hashed, session tokens are stored as SHA-256 hashes, and the session cookie is HTTP-only, secure, and same-site. Database setup is required before API calls can succeed. The sample accounts inside the original HTML are demo-only and are not database accounts.

## GitHub

Commit `index.html`, `RentGo_V4.html`, `api/`, `database/`, `package.json`, `package-lock.json` (after `npm install`), `vercel.json`, `.gitignore`, `.env.example`, and this README. Never commit database credentials.
