# RentGo

RentGo is an Indonesian motorcycle rental marketplace. The interface is in `index.html`. The sign-in/sign-up and listing browse/create flows use the Vercel Functions API and Neon Postgres. Other marketplace flows such as bookings, chats, payments, reviews, and admin tools still use browser `localStorage`.

## Run locally

1. Install Node.js 20 or newer.
2. Install the project dependencies with `npm install`.
3. Install Vercel CLI if needed (`npm install --global vercel`).
4. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your Neon pooled connection string.
5. Run `vercel dev` (or `npm run dev`).

Open the site through `vercel dev` so the frontend can reach the API. Opening the HTML as a `file://` URL will not connect to the API. API accounts and listings live in Neon; demo accounts and non-integrated flows remain in browser storage.

## Vercel and database setup

1. Push this repository to GitHub and import it into Vercel.
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
- `POST /api/motors` — creates a listing for the signed-in seller. JSON fields include `brand`, `name`, `year`, `pricePerHour`, and `pricePerDay`; location, description, helmet details, and a small photo are optional.

Passwords are bcrypt-hashed, session tokens are stored as SHA-256 hashes, and the session cookie is HTTP-only, secure, and same-site. The frontend now calls the API for sign-in/sign-up and listing browse/create. Database setup is required before those API calls can succeed. The sample accounts inside the HTML are demo-only and are not database accounts.

## GitHub

Commit `index.html`, `api/`, `database/`, `package.json`, `package-lock.json` (after `npm install`), `vercel.json`, `.gitignore`, `.env.example`, and this README. Never commit database credentials.
