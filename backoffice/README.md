# Oria Backoffice

Internal console for the Oria team, separate from the clinic platform (`../platform`). It reads and writes the
same MongoDB database (`ai_secretary`) directly.

- **Visão geral:** every clinic's numbers and the largest collections.
- **Clínicas:** create a clinic and its admin; edit profile, status and access (`isolationReady`); users and
  permissions; WhatsApp numbers; AI models per clinic, with "apply to other clinics".
- **Dados:** every collection, with filters by clinic, `_id`, Extended JSON filter, sort and columns. View, edit,
  create and delete documents, and run bulk updates or deletes on the current filter.
- **Auditoria:** every change and secret reveal, with before/after (secrets masked), in `backoffice_audit`.

## Safety

- **Access:** Sign in with Google; only the emails in `BACKOFFICE_ALLOWED_EMAILS`. The proxy checks every request,
  and each page and server action checks again.
- **Secrets are masked before leaving the server:** encrypted values, password hashes, and fields ending in
  token, secret, apiKey or password. Saving a document puts the originals back. Revealing one (encrypted values are
  decrypted with the platform keys) is audited. Password hashes can't be revealed; set a new password in the user's form.
- **Typed confirmation:**
  - deletes: `EXCLUIR`
  - bulk writes: the exact number of documents affected
  - anything belonging to the live clinic or to Oria-wide settings: `PRODUCAO`
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

Until the Google client exists, `BACKOFFICE_DEV_EMAIL` skips sign-in in `next dev` only. It is ignored by
production builds. The back-office uses its own cookie names, so it can run next to the platform on `localhost:3000`.

## Deploying (Vercel)

1. **Google Cloud Console** → APIs & Services → Credentials → *Create OAuth client ID* (Web application).
   - Authorized redirect URIs: `https://<backoffice-domain>/api/auth/callback/google` and
     `http://localhost:3200/api/auth/callback/google`.
2. **Vercel** → *New Project* from this repository.
   - Root Directory: `backoffice`. Production branch: `release-official`.
   - Set the variables from `.env.example`. `NEXTAUTH_URL` is the production URL; don't set `BACKOFFICE_DEV_EMAIL`.
3. **Preferably, a dedicated Atlas database user** for the back-office (`readWrite` on `ai_secretary`).

`package-lock.json` must point to `registry.npmjs.org`. On a corporate npm mirror, rewrite the `resolved` hosts
before committing.
