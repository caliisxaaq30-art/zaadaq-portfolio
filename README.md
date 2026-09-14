# ZAADAQ portfolio backend

This portfolio now includes a Node.js backend, SQLite database, and secure local email/password authentication.

## Run locally

From this folder, run:

```powershell
npm start
```

Then open `http://localhost:3000` — do not open `index.html` directly when using login.

## Authentication included

- Account registration with name, email, and password
- Password hashing with Node.js `scrypt` and a unique random salt
- Opaque, HTTP-only cookie sessions stored in SQLite
- Login status check and logout endpoint
- Login attempt rate limiting
- Security headers and request-size limits

## Deployment

This project is configured for **Render** via `render.yaml`. Connect the repository in Render and create a Blueprint; it creates a Node web service with an HTTPS URL and a persistent disk for SQLite.

The Render service requires the Starter plan because its persistent disk preserves accounts and sessions across deploys. Without persistent storage, a SQLite database would be erased on service restart.

For any other host:

1. Create a `.env` file from `.env.example`.
2. Set `NODE_ENV=production` when the host uses HTTPS. This enables secure cookies.
3. Set `DATA_DIR` to a persistent writable directory.
4. Run the site behind an HTTPS reverse proxy or platform hosting service.

`data/zaadaq.db` is created automatically on first startup and is deliberately excluded from version control.

For a public production service, add email verification, password reset emails, audit logging, and a managed backup strategy for the database.
