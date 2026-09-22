# Sky Hop race server

In-memory WebSocket rooms for parallel multiplayer racing, optional **static hosting** of the game from the same Node process, and HTTP APIs for **accounts**.

**Disclaimer — profanity in source:** Chat, bios, titles, and similar text are censored by **`js/skyhop-profanity-core.js`** (re-exported from **`server/profanity-filter.js`**). That file and related weights contain **explicit blocked words and phrases** (including strong language and slurs) so the filter can match them. They are lists for moderation, not player-facing copy. Do not treat those strings as game content.

## One public URL (recommended)

When the game is served from the **same host** as this server (e.g. Fly.io, Render, Railway), players open one **https://…** link from any device, leave the Racing **server** field **blank**, and the client picks **`wss://` + this page’s host** automatically—no reverse-proxy rules for `/api` or mixed-content workarounds.

1. Build and run the Docker image from the **repo root** (includes `index.html`, `js/`, and `server/`):

   ```bash
   docker build -t skyhop .
   docker run -p 3001:3001 skyhop
   ```

   Open `http://127.0.0.1:3001/` — you should see the game; `/health` and WebSocket work on that port.

2. Deploy that container on a host that provides **HTTPS** on the edge (typical for Fly, Render, etc.). Map **public HTTPS/WSS** → container **3001**. The edge terminates TLS; the container stays plain HTTP.

3. **Persist** `data/`: mount a volume on `server/data` (or the path where `accounts.json` lives) so profiles survive restarts.

`SKYHOP_STATIC_ROOT` defaults to the parent of `server/` in dev; the Dockerfile sets it to `/app` so static files resolve next to `server/`.

## Run (local / same network)

```bash
cd server
npm install
npm start
```

Open **`http://127.0.0.1:3001/`** to play from the running server (served static files), or keep opening `index.html` from disk and use **`127.0.0.1:3001`** in Racing as before.

- The process listens on **`0.0.0.0`** by default (override with `SKYHOP_RACE_HOST` if needed) so the LAN can connect. On **the same computer** as the server, use `ws://127.0.0.1:3001`. On a **phone or another PC** on the same Wi‑Fi, `127.0.0.1` is wrong — use `ws://<server-PC-LAN-IP>:3001` (e.g. `ws://192.168.1.5:3001`), with `npm start` on the host and the host firewall allowing **TCP 3001**. From another device, open `http://<LAN-IP>:3001/health` in a browser (**HTTP only** — hitting Node directly). If you use **`https://`** on the raw Node port, the browser will show **ERR_SSL_PROTOCOL_ERROR**. You should see `{"ok":true,...}`. The `/health` response includes CORS `*` for quick checks.
- HTTP health: `http://127.0.0.1:3001/health` (or your host / port).
- **Environment:** `SKYHOP_RACE_PORT` (default `3001`). `SKYHOP_RACE_HOST` is **optional**; set to `0.0.0.0` in Docker or when you need explicit IPv4-only listen.

The Racing **server** field: **leave blank** for same-site play, or enter a **hostname** (`myapp.fly.dev`) or full `wss://` URL so every player targets the same host.

Online races and collabs include **session chat** and **server anti-cheat** (impossible movement, instant stage clears, and scripted packets). Moderators, the Admin, and the owner can **watch live sessions** from the moderator dashboard.

## Accounts & statistics

**Default:** profiles live in **`server/data/accounts.json`** on the machine running Node. **Back up that file** if you need history; `data/` is git-ignored except for `.gitignore`.

### Supabase (hosted Postgres)

1. In Supabase, open **SQL Editor**, paste the script **`server/supabase/schema.sql`**, and run it.
2. Copy **`server/.env.local.example`** to **`server/.env.local`** (same folder as `package.json`).
3. From **Project Settings → API**, set:
   - `SUPABASE_URL` = Project URL  
   - `SUPABASE_SERVICE_ROLE_KEY` = **service_role** secret (server-side only; never put this in the browser)

Restart **`npm start`**. If both variables are set, the app uses Supabase; otherwise it keeps using `accounts.json`.

**Run recordings (account clips):** Run **`server/supabase/extend_v7_recordings.sql`** — `skyhop_recordings` table and private **`skyhop-recordings`** Storage bucket (max 256 MB per clip, enough for about 25 minutes). If the bucket already exists at a smaller limit, also run **`server/supabase/extend_v21_recording_size.sql`**.

**Input logs + submitted runs:** Run **`server/supabase/extend_v8_input_logs_submitted_runs.sql`** after v7 — `skyhop_input_logs`, `skyhop_submitted_runs`, and private **`skyhop-input-logs`** bucket (max 5 MB per log). For multiple recordings/logs on one submission, also run **`server/supabase/extend_v22_submitted_run_media_lists.sql`**. For automatic submit/accept/top-10 coins, run **`server/supabase/extend_v23_submitted_run_coins.sql`**.

**Owner shop catalog (in-game, no redeploy):** Run **`server/supabase/extend_v24_shop_items.sql`** after v23 — `skyhop_shop_items` and private **`skyhop-shop`** bucket (1.5 MB per image). Owner adds items from the ➕ FAB next to the shop, and can change the name, buy price, and sell coins or take an item off the shop (and put it back). Rarity is calculated from buy price: Common 50–999, Uncommon 1000–1999, Insane 2000–4499, Rare 4500–9999, Epic 10000–99999, Legendary 100000–499999, Mythic 500000–1000000. Listing edits are stored in site content (`shop_overrides`), so they do not need another SQL file.

**Submitted run locks + decline reasons:** Run **`server/supabase/extend_v9_submitted_run_lock_decline_reason.sql`** after v8 — `decline_reason`, `status_locked` on `skyhop_submitted_runs`.

**World 2 built-in stages + user mods:** Run **`server/supabase/extend_v10_world2_user_mods.sql`** after v9 — `skyhop_builtin_world2`, `skyhop_user_mods`, and private **`skyhop-user-mods`** bucket (5 MB per `.js` mod). An **empty** `skyhop_builtin_world2` table is normal (same idea as World 1’s empty `[]` row): the game loads **`stages-world2.js`**, and **`GET /api/builtin-stages-world2`** returns the bundled default from **`server/world2-default-stages.json`**. Optional: run **`server/supabase/seed_world2_default_stage.sql`** to store that default row in Supabase for editing in the dashboard.

**World 2 unlock on account:** Run **`server/supabase/extend_v11_world1_cleared.sql`** after v10 — `campaign_world1_cleared_at` on `skyhop_users` (also unlocks if **`first_clear`** achievement already set).

**Active mods on account:** Run **`server/supabase/extend_v12_user_mods_active.sql`** after v11 — `active_user_mod_ids` on `skyhop_users` (replaces browser `localStorage` for which mods are enabled).

**Owner-editable ToS, feature list, and branding:** Run **`server/supabase/extend_v13_site_content.sql`** after v12 — `skyhop_site_content` (`tos`, `feature_list`, `branding` keys; no extra SQL for branding). Owner edits in Account administration → Save; public `GET /api/site/tos`, `GET /api/site/feature-list`, and `GET /api/site/branding` (`title`, `version`, `updateName`).

**Ban appeals + votes:** Run **`server/supabase/extend_v14_ban_appeals.sql`** after v13 — `skyhop_ban_appeals`, `skyhop_ban_appeal_votes`. Banned users submit via login ban screen; mods/owner vote in the 📧 inbox (majority of cast votes resolves). Owner can **Accept / Decline** open appeals directly in **Account administration** (`GET /api/owner/appeals`, `POST /api/owner/appeals/:id/resolve` with `{ "decision": "accept" \| "decline" }`).

**Admin role (exactly one):** Run **`server/supabase/extend_v15_admin_role.sql`** after v14 — `skyhop_staff_requests`, `skyhop_admin_ban_log`. Owner assigns/removes the Admin in **Account administration** (nobody is Admin until you do). Admin has moderator powers plus promote-moderator and 1-day bans (max 2 per rolling 7 days). They cannot demote mods, open Owner Inbox / Owner Administration / Reviewed Runs, or apply long bans; those go to the owner as requests (`POST /api/admin/ban`, `POST /api/admin/requests`, `POST /api/owner/set-admin`).

**Report Advisor:** No extra SQL (uses `skyhop_users.role`). Owner assigns/removes in **Account administration**. They share the pending report queue with mods and the Admin (`GET /api/mod/reports`, dismiss, escalate) and cannot use the mod dashboard, owner tools, bans, appeal votes, or other staff APIs (`POST /api/owner/set-report-advisor`).

**Promotion notice:** Run **`server/supabase/extend_v16_promotion_notice.sql`** after v15 — `promotion_from` / `promotion_to` on `skyhop_users`. Promoted players see a one-time “Congratulations! You have been promoted from old_role to new_role” on next login (`POST /api/me/ack-promotion` dismisses it). Demotions are silent.

**Strikes:** Run **`server/supabase/extend_v17_strikes.sql`** after v16 — `strikes` on `skyhop_users`. Owner adds/removes from the ⚠️ FAB under 📋. Player 3 → automatic 1-week ban; moderator / Report Advisor 2 → demoted to player; Admin 1 → demoted to moderator. Strikes never decay. Admin can look up counts for players / advisors / mods (`GET /api/strikes`, `POST /api/owner/strikes`).

**Empty campaign / blank levels on Play:** Play uses a **valid** owner-uploaded campaign from the server (full World 1 list, every stage has platforms). Empty, short, or broken JSON is ignored and Play keeps bundled **`stages.js`** / **`stages-world2.js`**. Owner can also **Account administration → Reset server campaign override**. Optional SQL: **`server/supabase/reset_builtin_campaign_to_bundled.sql`**.

**“relation skyhop_users does not exist”:** The extend scripts only add tables on top of an existing Sky Hop database. In Supabase **SQL Editor**, run **`server/supabase/schema.sql`** first, then **`extend_v2_coins_builtin.sql`** through **`extend_v13_site_content.sql`** in order, then v14 through v17. Confirm with `select to_regclass('public.skyhop_users');` (should return `skyhop_users`, not null). Use the **same** Supabase project as `SUPABASE_URL` in `server/.env.local` / Render env.

**Custom profiles (avatars):** Run **`server/supabase/extend_v6_profiles_storage.sql`** — adds `profile_bio` / `profile_avatar_path`, creates the **`skyhop-profiles`** Storage bucket, and RLS so authenticated users may only write under **`{skyhop_user_id}/`** (see `user_metadata.skyhop_user_id` when using Supabase Auth). The game uploads via the Node server (service role) or signed upload URLs scoped to your folder.

**Moderation (reports / bans):** Run **`server/supabase/moderation.sql`** in the SQL Editor if you already created tables from an older `schema.sql`. New installs: `schema.sql` already includes `role`, `ban_until_ms`, `ban_reason` on `skyhop_users` and the `skyhop_reports` table. Set **`SKYHOP_OWNER_USERNAME`** in `server/.env.local` to your username (letters match login; case-insensitive). That account is always treated as **owner** (ban users, dismiss escalations, promote moderators). **Moderators** are normal accounts with `role = moderator` in the DB; the owner grants that from the reports inbox (“Make mod” / “Remove mod”).

If **Account** shows **non-JSON** errors, the browser is usually hitting a URL that returns HTML (wrong host, 404 page, or crash text)—fix the API base / same-origin setup first.

**Docker / cloud:** inject the same two variables as environment variables instead of a file.

If **Account & cloud stats** shows a network / **Failed to fetch** error: keep the server running; if you opened the game from **https**, use a **hosted** one-URL deploy (above) or fill the optional API base in Account. Opening `index.html` as a **local file** while pointing at `http://127.0.0.1` from a normal **https** tab will still be blocked by the browser.

HTTP REST on the **same port** as racing (use `http://HOST:PORT/...`; CORS allows browser requests):

| Method | Path | Notes |
|--------|------|--------|
| `POST` | `/api/register` | Body JSON `{ "username", "password" }` → `{ token, "username" }` |
| `POST` | `/api/login` | Same body → `{ token, "username" }` |
| `POST` | `/api/logout` | Header `Authorization: Bearer <token>` |
| `GET` | `/api/me` | Bearer → `{ username, stats, achievements }` |
| `POST` | `/api/runs` | Bearer, body `{ timeMs, deaths, source?: "campaign" \| "race" }` |
| `POST` | `/api/reports` | Bearer, body `{ reportedUsername, reason }` |
| `GET` | `/api/mod/reports` | Bearer; Report Advisors / mods / Admin get `pending`; owner gets `escalated`. Ban appeals are not sent to Report Advisors. |
| `POST` | `/api/mod/reports/:id/reject` | Report Advisor, moderator, or Admin |
| `POST` | `/api/mod/reports/:id/escalate` | Report Advisor, moderator, or Admin |
| `POST` | `/api/owner/ban` | Owner only; body `{ userId, duration: "1w"\|"2w"\|"1m"\|"perm", reportId?, reason? }` |
| `POST` | `/api/owner/dismiss-report` | Owner only; body `{ reportId, note? }` |
| `POST` | `/api/owner/set-moderator` | Owner or Admin; body `{ username, promote: boolean }` (Admin cannot demote) |
| `POST` | `/api/owner/set-report-advisor` | Owner only; body `{ username, promote: boolean }` |
| `GET` | `/api/strikes` | Owner or Admin; query `username`. Admin cannot look up owner/Admin. |
| `GET` | `/api/shop/items` | Public shop catalog (bundled + owner-added) with auto rarity |
| `GET` | `/api/shop/skins/:filename` | Owner-uploaded shop image |
| `POST` | `/api/shop/buy` | Bearer; body `{ itemId }` |
| `POST` | `/api/shop/sell` | Bearer; body `{ itemId }` |
| `POST` | `/api/owner/shop/items` | Owner only; raw image body; headers `X-Shop-Label`, `X-Shop-Price`, `X-Shop-Sell-Price` |
| `POST` | `/api/owner/strikes` | Owner only; body `{ username, action: "add" \| "remove" }` |

The game’s **Account & cloud stats** panel uses that API. A run is uploaded when you **clear all 50 stages** while logged in (campaign or race). The HTTP base URL is derived from the **Racing** WebSocket URL (`ws:` → `http:`, `wss:` → `https:`).

## Friends on a different Wi‑Fi (internet)

`localhost` only works on one machine. For people on other networks, the Node process must be **reachable on the public internet** (or through a **tunnel**). Every player then types that **one** address in the Racing menu (not `localhost`).

### Option A — Quick test: tunnel (no router config)

1. Start the server: `npm start` (port 3001).
2. Run a tunnel that forwards to that port, e.g. [ngrok](https://ngrok.com/): `ngrok http 3001`.
3. Use the **HTTPS** URL ngrok shows for **WebSocket**: `wss://<your-subdomain>.ngrok-free.app` (ngrok’s UI shows the wss form). Put that in **WebSocket server** in the game for **host and all joiners**.
4. If your game is opened as `https://...`, the browser only allows `wss://` (not plain `ws://`).

**Note:** The free tier may need one click in the browser for the ngrok interstitial; paid tiers or other tunnels (Cloudflare Tunnel, localtunnel) behave differently.

### Option B — Your own server (VPS, home PC + port forward)

1. Run this server on a machine with a **public** IP, or open **port 3001** (TCP) on your router to the PC running Node.
2. In the game, set WebSocket to `ws://YOUR_PUBLIC_IP:3001` (or `wss://` if you terminate TLS; see below).
3. If the static game is on **HTTPS**, put a TLS proxy (Caddy, nginx) in front and use **`wss://your-domain.com/race-path`** and proxy WebSocket upgrades to `localhost:3001`.

### HTTPS pages require `wss://`

If you host `index.html` on **https://**, the WebSocket must be **`wss://`**, not `ws://`—browsers block mixed content. The tunnel in Option A usually gives you HTTPS and thus `wss://`.

## Deploying a static game + this server
    
- Open the game from the same origin as the API, **or** use the full `ws://` / `wss://` URL in the Racing field for all players.
- CORS is not the issue for WebSockets; the important part is that the host/port is **reachable** and the scheme matches the page (http→ws, https→wss).

### HTTPS game page + accounts (reverse proxy)

If `index.html` is served over **https://**, the browser will not call **http://127.0.0.1:3001**. The game’s Account panel then uses **the same origin** as the page for `/api/*` and `/health` (or you can set a full **HTTPS API base** in Account). Put TLS on your static files and **proxy** these paths to Node on port 3001:

**Caddy** (auto HTTPS), add to your site block (paths are forwarded as-is, including `/api/...`):

```caddyfile
handle /api* {
    reverse_proxy 127.0.0.1:3001
}
handle /health {
    reverse_proxy 127.0.0.1:3001
}
```

If racing uses **`wss://` on the same host**, add a route that proxies `/` WebSocket upgrades to Node (this app’s WebSocket is on the **root** path `/`, not `/ws`):

```caddyfile
@ws {
    header Connection *Upgrade*
    header Upgrade websocket
}
reverse_proxy @ws 127.0.0.1:3001
```

Place WebSocket handling so it does not catch your static file server; e.g. serve static files from a subdomain or path, or put the game and API behind one host and proxy only unmatched requests to static files.

For **WebSocket racing** from an HTTPS page you still need **`wss://`** to a host that upgrades WebSocket to this Node process (same proxy with WebSocket support, or a tunnel like ngrok — see “Friends on a different Wi‑Fi”).

**nginx** (illustrative):

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location = /health {
    proxy_pass http://127.0.0.1:3001/health;
}
```
