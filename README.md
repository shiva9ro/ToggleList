# ToggleList

English | [日本語](README.ja.md)

ToggleList is a self-hosted, reusable shopping-list PWA for a household. Family members select items from a shared catalog, move them through three shopping states, and synchronize changes across devices.

The user interface and sample data are in Japanese. The app was built for a small Japanese-speaking household and has primarily been tested as an installed PWA on Android.

![ToggleList main screen](docs/images/togglelist-main.png)

## Features

- Three explicit states: inactive, planned, and purchased
- Categorized item catalog with per-category and global collapse controls
- Add, edit, delete, bulk-add, and deliberately reorder items
- Category-ordered shopping rows that stay in place when checked
- Complete checked items, or confirm and complete the entire shopping list
- Durable offline shopping operations with automatic retry
- Show each item's most recent purchase as today or a number of days ago
- Recent history with timestamps, authenticated users, shopping actions, and completed items
- Japanese search normalization across hiragana/katakana and half-width/full-width forms
- Optional readings and aliases for each item
- JSON data export
- Installable PWA with update notifications
- A reauthentication path for expired Cloudflare Access sessions

## Scope and architecture

ToggleList is intended for a small, trusted household, not as a multi-tenant shopping service. Cloudflare D1 is the source of truth. IndexedDB stores the last successful snapshot and pending shopping operations on each device. Initial setup and catalog creation, editing, deletion, and reordering still require a connection.

```text
Installed PWA / browser
  ├─ IndexedDB (display cache + pending operations)
  └─ Cloudflare Worker API
       └─ D1 (shared source of truth)
```

Shopping actions are saved on the device before appearing in the UI. Network failures keep changes queued, including across app restarts. The app retries in order on launch, reconnection, focus, and about every 30 seconds while visible. It does not synchronize in the background while closed.

Completion captures item IDs at the time of the action so it cannot complete other items added by another device later. Conflicting status changes use server last-write-wins behavior; unrelated fields are preserved. Operation IDs in existing history rows prevent duplicate application after a lost response. Only HTTP 401 prompts reauthentication; network failures alone do not.

No D1 migration is required for this update. Device IndexedDB upgrades automatically. Deploy the frontend and Worker together because the API has also changed.

## Technology

- React 19, TypeScript, and Vite
- vite-plugin-pwa
- Dexie and IndexedDB
- Cloudflare Workers, Hono, and D1
- Cloudflare Access with Google as the identity provider
- Cloudflare Workers Builds connected to GitHub

## Requirements

- Node.js 24
- npm
- A Cloudflare account
- A D1 database created with Wrangler

The deployed app requires a modern browser with PWA and IndexedDB support. The current household installation has been tested on Android. Other modern browsers may work, but are not part of the project's verified environment.

## Local setup

Install the locked dependencies, apply the migrations to a local D1 database, and start the Worker with its static assets:

```powershell
npm.cmd clean-install
npm.cmd run db:migrate:local
npm.cmd run dev:cloudflare
```

Open the URL printed by Wrangler. On first access to an empty database, the app inserts the sample catalog from `src/data/initialData.ts`. Edit that file before first use if you want different initial items. Do not commit a private household catalog to a public fork.

For frontend-only development, `npm.cmd run dev` starts Vite, but API-backed operations require the Worker/D1 development command above.

## Build and checks

```powershell
npm.cmd clean-install
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
```

Unit tests exercise completion, retry deduplication, and rollback against SQLite using the existing migrations. Browser tests use a temporary Chrome/Edge profile to check IndexedDB persistence, network failures, reconnection, and UI behavior; set BROWSER_PATH if the executable is not detected. CI runs static checks, unit tests, and the production build. For manual multi-device testing, open two browser sessions and verify that changes reach the other session within about 30 seconds or after focus is restored.

## Deployment

See [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md) for D1 creation and migrations, Cloudflare Access protection, and GitHub-connected Workers Builds.

Apply pending production D1 migrations before deploying a Worker that depends on a schema change. Protect both production and preview URLs with Cloudflare Access.

## Data and security

- D1 stores the shared item data and the authenticated user's email address in change history.
- IndexedDB includes pending operations. Clearing browser site data deletes unsynchronized work. It is not an independent backup.
- JSON exports can contain item names, notes, and user identifiers; store and share them carefully.
- Do not commit real household data, logs, OAuth client secrets, Cloudflare API tokens, or local environment files.
- Restrict the Cloudflare Access policy to the intended users. The Worker trusts the `Cf-Access-Authenticated-User-Email` header supplied by Access; deploying it without Access removes that intended protection.
- Concurrent updates are not conflict-merged and the most recent write wins.

Review Cloudflare and Google terms, pricing, quotas, and security settings for your own deployment. This independent project is not affiliated with or endorsed by Cloudflare or Google.

## Distribution policy

This repository provides source code only. It does not publish prebuilt archives or application binaries through GitHub Releases, and it does not publish a library or container through GitHub Packages. Operators build and deploy their own instance so that authentication, database, and access-control settings remain under their control.

## Related article

- [家族用の買い物リストPWAをReact・Cloudflare Workers・D1で作った (Qiita, Japanese)](https://qiita.com/shiva9ro/items/0796d25b2b6a701ed225)

## License

[MIT License](LICENSE)
