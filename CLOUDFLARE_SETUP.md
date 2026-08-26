# Deploying ToggleList to Cloudflare

English | [日本語](CLOUDFLARE_SETUP.ja.md)

This guide covers the Cloudflare-specific setup for a self-hosted ToggleList instance. Commands are shown for PowerShell on Windows.

## 1. Install dependencies

```powershell
npm.cmd clean-install
```

## 2. Sign in to Cloudflare

```powershell
npx.cmd wrangler login
npx.cmd wrangler whoami
```

## 3. Create the D1 database

Create the database only when setting up a new instance:

```powershell
npx.cmd wrangler d1 create togglelist-db
```

Copy the resulting D1 UUID into `database_id` in `wrangler.jsonc`. A D1 UUID is not a credential, but it identifies a specific deployment environment when committed to a public repository.

## 4. Apply D1 migrations

List unapplied production migrations:

```powershell
npx.cmd wrangler d1 migrations list togglelist-db --remote
```

If migrations are pending, apply them before deploying a Worker that depends on the new schema:

```powershell
npx.cmd wrangler d1 migrations apply togglelist-db --remote
```

Wrangler applies the SQL files in `migrations` in numeric order. Redeploying the Worker does not normally delete data from the existing D1 database.

## 5. Deploy from GitHub

Connect Cloudflare Workers Builds to the `main` branch. Configure these commands in Cloudflare:

```text
Build command: npm run build
Deploy command: npx wrangler deploy
```

Pushing a commit to `main` then starts the connected Cloudflare build:

```powershell
git add .
git commit -m "Describe the change"
git push origin main
```

D1 migrations are not applied by this build configuration. Apply required production migrations manually before pushing a schema-dependent deployment.

## 6. Protect the app with Cloudflare Access

Protect both the production URL and all preview URLs. The current household setup uses:

- Identity provider: Google
- Allow policy: include only the exact Google accounts authorized to use the list
- One-time PIN: disabled
- Session duration: one month

The Worker reads the authenticated user from the `Cf-Access-Authenticated-User-Email` header and stores that value as the actor in change history. The Worker does not independently verify this header, so do not expose it without the intended Cloudflare Access protection.

Do not commit OAuth client secrets or Cloudflare API tokens. Review the Access policy and preview-domain coverage before sharing the deployment URL.

## Local verification

Apply migrations to the local D1 database and start the Worker locally:

```powershell
npm.cmd run db:migrate:local
npm.cmd run dev:cloudflare
```

For a multi-device equivalent check, open two browser sessions. The session where an action is performed updates optimistically and reconciles with D1 after the request completes. The other session receives the change within about 30 seconds, or when its page or window becomes active.

## API endpoints

- `GET /api/health`
- `GET /api/snapshot`
- `GET /api/history?limit=30`
- `POST /api/bootstrap`
- `POST /api/items`
- `POST /api/items/bulk`
- `PATCH /api/items/:id`
- `DELETE /api/items/:id`
- `PUT /api/items/reorder`
- `POST /api/shopping/complete`

## Current limitations

- Concurrent updates use last-write-wins behavior.
- There is no offline mutation queue.
- IndexedDB is a device-local display cache; D1 remains the shared source of truth.
- Change history records shopping-list state changes, but not item-catalog edits or reordering.
- This repository distributes source code only. It does not provide a prebuilt application through GitHub Releases or a package through GitHub Packages.
