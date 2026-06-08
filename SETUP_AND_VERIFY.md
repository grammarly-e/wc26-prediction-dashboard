# Setup runbook

Six steps, in order. Each one tells you what to run and what "it worked" looks like.

## 1. Install and add your keys

```bash
npm install
cp .env.local.example .env.local
```

Open `.env.local` and fill in four values:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — copy these from your Supabase project: Settings > API.
- `FOOTBALL_DATA_API_KEY` — free account at https://www.football-data.org/client/register (takes two minutes).
- `SYNC_SECRET` — make up any long random password yourself.

## 2. Set up the database

In the Supabase SQL Editor, run these three files in order (open each, paste the contents, click Run):

1. `supabase/migrations/0001_init_schema.sql`
2. `supabase/migrations/0002_row_level_security.sql`
3. `supabase/seed/prediction_categories.sql`

Then load the match schedule:

```bash
npm run seed
```

## 3. Start the app

```bash
npm run dev
```

Open http://localhost:3000. You should see all 104 World Cup matches listed with no scores yet (showing "vs"). That means the database and the website are talking to each other correctly.

## 4. Pull in live data

```bash
npm run sync
```

This fetches real match data and writes it to your database. Watch the console — a few lines of text will scroll by confirming matches, standings, and top scorers were fetched. As long as it finishes without an error, it worked. (Before the tournament starts, most matches will just update their status, not scores — that's expected.)

To double check it pulled the right data: open https://www.football-data.org/v4/competitions/WC/matches in your browser, pick any match, and confirm the same teams and kickoff time appear on your `/matches` page.

## 5. Confirm the page updates itself

With `npm run dev` still running and the dashboard open in your browser, open a second terminal and run `npm run sync` again. Within 30 seconds, your open browser tab should refresh on its own and show any new data — no manual reload needed. Nothing to configure here; it just works.

## 6. Automate it (only needed once you deploy)

`vercel.json` is already set up to run the sync automatically every 10 minutes once you deploy to Vercel. To test it manually after deploying:

```bash
curl -X POST https://your-deployment.vercel.app/api/sync \
  -H "x-sync-secret: YOUR_SYNC_SECRET"
```

A response like `{"ok":true,...}` means everything is wired up correctly.

---

## Known gaps (not bugs — just not built yet)

- **Player stats**: the free data plan doesn't reliably provide World Cup player rosters, which may affect categories like Golden Boot. Revisit once the tournament starts; a second data source can be added later if needed.
- **Prediction submission and leaderboard pages**: intentionally not built yet — these are the next phase.
