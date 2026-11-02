# Oria Backoffice

Internal console for the Oria team, separate from the clinic platform (`../platform`). It reads and writes the
same MongoDB database (`ai_secretary`) directly.

- **Visão geral:** every clinic's numbers and the largest collections.
- **Clínicas:** create a clinic and its admin; edit profile, status and access (`isolationReady`); users and
  permissions; WhatsApp numbers; AI models per clinic, with "apply to other clinics"; delete a clinic and all its
  data (never the original clinic; a clinic in production must first change status; you type its exact name).
- **Dados:** every collection, with filters by clinic, `_id`, Extended JSON filter, sort and columns. View, edit,
  create and delete documents, and run bulk updates or deletes on the current filter.
- **Auditoria:** every change and secret reveal, with before/after (secrets masked), in `backoffice_audit`.

## Safety

- **Access:** a 6-digit Google Authenticator code (TOTP, RFC 6238). Each code works once. 5 wrong codes within an
  hour block every attempt until the oldest is an hour old; the count is global, not per IP. The session is a signed
  12-hour cookie, tied to the authenticator secret. The proxy checks every request, and each page and server action
  checks again. Every login attempt goes to the audit log.
- **Secrets are masked before leaving the server:** encrypted values, password hashes, and fields ending in
  token, secret, apiKey or password. Saving a document puts the originals back. Revealing one (encrypted values are
  decrypted with the platform keys) is audited. Password hashes can't be revealed; set a new password in the user's form.
- **Typed confirmation:**
  - deletes: `EXCLUIR`
  - bulk writes: the exact number of documents affected
  - anything belonging to a clinic in production (status **Ativa**) or to Oria-wide settings: `PRODUCAO`
- **Same shapes as the platform:** companies (`accessControlVersion: 1`, `adminUserId`), users (bcrypt, 12 rounds,
  `sessionVersion`), per-company settings ids (`<companyId>:<key>`), WhatsApp connections (AES-256-GCM token, one
  operational number per company). Keep `src/lib/platform-rules.ts` in sync with the platform.

A new clinic can sign in and receive WhatsApp traffic only when it is `isolationReady` with status `test` or
`active`, **and** the platform runs with `TENANT_STRICT=true`.

## Running locally

```powershell
Copy-Item .env.example .env.local   # then fill in the values
npm install
npm run dev                          # http://localhost:3200
npm test; npm run lint; npm run typecheck
```

First time: open `http://localhost:3200/setup` (only exists under `npm run dev`). Generate the secret, scan the QR
code with Google Authenticator, then sign in at `/login`. The back-office uses its own cookie name, so it can run
next to the platform on `localhost:3000`.

## Deploying (Vercel)

1. **Vercel** → *New Project* from this repository.
   - Root Directory: `backoffice`. Production branch: `release-official`.
   - Set the variables from `.env.example`, copying `BACKOFFICE_TOTP_SECRET` and `BACKOFFICE_SESSION_SECRET` from
     your `.env.local`.
2. **Preferably, a dedicated Atlas database user** for the back-office (`readWrite` on `ai_secretary`).

`package-lock.json` must point to `registry.npmjs.org`. On a corporate npm mirror, rewrite the `resolved` hosts
before committing.
