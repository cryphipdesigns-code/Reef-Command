# Reef Command

Mobile-first reef tank logbook and insight app.

## What is included

- Tank profile with static husbandry context
- Placement zones with light, flow, and future PAR fields
- Livestock records with active, moved, and deceased states
- Water test logs with timestamp and light-phase context
- Feeding, maintenance, and water-change events in one timeline
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

The hosted app reads `config.json` and uses the shared Reef Command Supabase project automatically.

## Data model note

The app syncs one structured shared JSON state row for profile, zones, livestock, water tests, events, and insight runs. Photos are uploaded to the `reef-photos` Supabase Storage bucket, and the JSON stores only lightweight photo paths and metadata.
