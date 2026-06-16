# Reef Command

Mobile-first reef tank logbook and insight app.

## What is included

- Tank setup with static husbandry context
- Equipment setup items with inline history
- Livestock setup items with Alive, Deceased, and Removed lifecycle states
- Universal Journal entries that can link to equipment and livestock
- Water test entries with timestamp and light-phase context
- Feeding, dosing, maintenance, and water-change entries in one timeline
- Stock photos stored in Supabase Storage so the synced app state stays small
- Local insight drafts when GPT is not connected
- Supabase sync scaffold with email magic-link auth
- Supabase Edge Function for GPT-backed insights

## Run locally

From this folder:

```bash
python3 -m http.server 5174 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5174
```

The app works in local mode immediately. Data is stored in browser local storage.

## One-Click Local Launcher

Install the Ubuntu launcher:

```bash
scripts/install-reef-command-launcher.sh
```

After that, launch **Reef Command** from the Ubuntu app menu or desktop icon. The launcher starts a local static server, opens `http://127.0.0.1:5174`, and reuses an already-running server when possible.

Logs are written to:

```text
~/.cache/reef-command/logs
```

You can also start or stop Reef Command from a terminal:

```bash
~/.local/bin/reef-command-start
~/.local/bin/reef-command-stop
```

## Phone Install

Reef Command is PWA-ready. Once it is hosted over HTTPS, open the site on your phone and add it to the home screen.

On iPhone:

```text
Safari -> Share -> Add to Home Screen
```

On Android:

```text
Chrome -> menu -> Add to Home screen / Install app
```

## GitHub Pages Deploy

Create a GitHub repo for Reef Command, push this folder, and enable GitHub Pages with the included workflow.

The workflow expects:

```text
Repository variable: SUPABASE_URL
Repository secret:   SUPABASE_ANON_KEY
```

Use the values from `.env.supabase`. After GitHub Pages gives you the hosted URL, add that exact URL to Supabase Auth redirect URLs for the Reef Command project.

## Supabase setup

The project includes a deployment helper for hosted Supabase:

```bash
SUPABASE_ACCESS_TOKEN=... \
SUPABASE_PROJECT_REF=... \
SUPABASE_DB_PASSWORD=... \
OPENAI_API_KEY=... \
scripts/deploy-supabase.sh
```

The script links the project, pushes migrations, deploys the GPT Edge Function, sets function secrets, and writes local app settings to `.env.supabase`.

The hosted app reads `config.json` and uses the private Reef Command Supabase project automatically.

## Data model note

The app syncs one structured private JSON state row per authenticated user. Current state is schema-versioned and centered on equipment/livestock items plus linked Journal entries. The migration keeps the pre-v2 blob recoverable under `legacyRaw` and keeps older compatibility arrays for Map and rollback safety.

Photos are uploaded to the private `reef-photos` Supabase Storage bucket under the signed-in user id, and the JSON stores only lightweight photo paths and metadata.

Before trusting a migration on real data, run:

```bash
node scripts/verify-record-journal-migration.mjs
```

To create fresh Supabase snapshots before a schema change:

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
REEF_OWNER_USER_ID=your-auth-user-id \
node scripts/snapshot-supabase-state.mjs
```

## Privacy setup

Reef Command now shows one private sign-in gate before the app. After sign-in,
the same session unlocks tank data, photos, sync, and GPT insights.

To preserve existing shared data:

1. Sign in once through Reef Command so your Supabase Auth user exists.
2. Find your user id in Supabase Auth.
3. Apply the original private user table migration if it is not already applied.
4. Adopt the old shared state and photos:

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
REEF_OWNER_USER_ID=your-auth-user-id \
node scripts/adopt-private-data.mjs
```

5. Apply `supabase/migrations/20260616000000_private_sync_and_storage.sql` to
   revoke shared state/photo policies and use private Storage policies.

The adoption script writes local backups under `.tmp-backups/`, copies
`shared/...` Storage photos into your user folder, rewrites photo paths, and
upserts the result into `reef_app_state`.

GPT insights now require a valid Supabase Auth session before the Edge Function
calls OpenAI. For production, set `REEF_ALLOWED_EMAILS` as a comma-separated
Supabase secret to restrict GPT usage to your own email address(es).
