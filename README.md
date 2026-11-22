# RentGo

RentGo is an Indonesian motorcycle rental marketplace. The interface is in `index.html`. Account, listing, booking, payment, chat, review, notification, commission, and admin changes are synchronized through authenticated Vercel Functions to Neon. The browser keeps only an in-memory view while the app is open; it does not persist application data in `localStorage`.

## Run locally

1. Install Node.js 20 or newer.
2. Install the project dependencies with `npm install`.
3. Install Vercel CLI if needed (`npm install --global vercel`).
4. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your Neon pooled connection string.
5. Run `vercel dev` (or `npm run dev`).

Open the site through `vercel dev` so the frontend can reach the API. Opening the HTML as a `file://` URL will not connect to the API.

## Vercel and database setup

1. Push this repository to GitHub and import it into Vercel.
2. Import the repository in Vercel.
3. In the Vercel project, add a Neon Postgres database from the Storage/Marketplace integrations. Vercel's database integrations are provisioned by providers such as Neon.
4. Add the provider's pooled connection string as `DATABASE_URL` for Development, Preview, and Production. Redeploy after adding it.
5. Run `database/schema.sql` once in the Neon SQL Editor.
6. Run the current `database/features.sql` to create tables and columns for the other frontend features. It is safe to rerun when updating the schema.
7. Check `/api/health`; a successful response is `{"status":"ok","database":"connected"}`.

### Provision the administrator account

After applying the schema and installing dependencies, run the seed script from the project folder. In PowerShell, enter the password without displaying it:

```powershell
$secure = Read-Host "Admin password" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  npm run seed:admin
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
}
```

The email defaults to `admin@rentgo.id`; set `ADMIN_EMAIL` to override it. The script hashes the password and creates or updates the admin account. Admins cannot register from the public form and may sign in with either role selector. Use a strong, unique password for the admin account.

Do not commit `.env` or `.env.local`. `.env.example` contains only a placeholder. Vercel provides the production environment variables at runtime.

## API

- `GET /api/health` — checks the database connection.
- `POST /api/auth/register` — creates a buyer or seller account. JSON: `{ "name", "email", "password", "role" }`.
- `POST /api/auth/login` — signs in. JSON: `{ "email", "password" }`.
- `GET /api/auth/me` — returns the current session user or `null`.
- `POST /api/auth/logout` — revokes the current session.
- `GET /api/motors` — lists available database-backed listings.
- `POST /api/motors` — creates a listing for the signed-in seller. JSON fields include `brand`, `name`, `year`, `pricePerHour`, and `pricePerDay`; location, description, helmet details, and a small photo are optional.
- `POST /api/admin/import-legacy` — admin-only import for an exported `rentgo_v7` backup. It maps old account IDs to Neon accounts by email.

Passwords are bcrypt-hashed, session tokens are stored as SHA-256 hashes, and the session cookie is HTTP-only, secure, and same-site. Every user action requires the corresponding schema in Neon. The running application does not read or write business data or theme preferences in browser storage.

### Import data from the old browser version

The old `rentgo_v7` data can be exported once from the browser and imported by an administrator. First, run both SQL files above and make sure each old buyer or seller has registered an account in the new app with the same email address and role. They will use their new account password; old passwords are never sent to or imported by the migration API. Then, in the browser on the RentGo site, open Developer Tools → Console and run:

```js
const raw = localStorage.getItem('rentgo_v7');
if (!raw) throw new Error('No legacy RentGo data found in this browser');
const link = document.createElement('a');
link.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
link.download = 'RentGo-Legacy.json';
link.click();
setTimeout(() => URL.revokeObjectURL(link.href), 1000);
```

Sign in to the new app as admin, open **Lainnya → Pengaturan → Data → Impor Data Lama**, and select `RentGo-Legacy.json`. The importer maps old account IDs to database accounts by email and imports motors, rentals, payment proofs, profiles/QRIS, chats, reviews, notifications, commissions, withdrawals, audit logs, balances, and settings. It never imports legacy passwords. Accounts without a matching database email are skipped; register those accounts first and retry the same file. The same file is safe to import again. Files can be up to 25 MB; embedded photos are compressed in the browser and the API payload is limited to 3.8 MB. Any photo that still exceeds 1 MB is omitted and reported so it can be uploaded again after migration.

## GitHub

The frontend loads data from `GET /api/data` and sends changed records through authenticated `PUT /api/state`. Focused endpoints also exist for rentals, chats, reviews, and withdrawals. Authentication actions share `/api/auth/:action`, and admin actions share `/api/admin/:action` to stay within Vercel Hobby's function-count limit. Other account, notification, commission, profile, and settings changes use `/api/state`. These routes enforce account ownership and role checks before writing to Neon.

Commit `index.html`, `api/`, `database/`, `scripts/`, `package.json`, `package-lock.json` (after `npm install`), `vercel.json`, `.gitignore`, `.env.example`, and this README. Never commit database credentials.
