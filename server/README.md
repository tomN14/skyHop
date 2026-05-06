# Sky Hop race server

In-memory WebSocket rooms for parallel multiplayer racing, optional **static hosting** of the game from the same Node process, and HTTP APIs for **accounts**.

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

## Accounts & statistics

**Default:** profiles live in **`server/data/accounts.json`** on the machine running Node. **Back up that file** if you need history; `data/` is git-ignored except for `.gitignore`.

### Supabase (hosted Postgres)

1. In Supabase, open **SQL Editor**, paste the script **`server/supabase/schema.sql`**, and run it.
2. Copy **`server/.env.local.example`** to **`server/.env.local`** (same folder as `package.json`).
3. From **Project Settings → API**, set:
   - `SUPABASE_URL` = Project URL  
   - `SUPABASE_SERVICE_ROLE_KEY` = **service_role** secret (server-side only; never put this in the browser)

Restart **`npm start`**. If both variables are set, the app uses Supabase; otherwise it keeps using `accounts.json`.

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
| `GET` | `/api/mod/reports` | Bearer; moderators get `pending`, owner gets `escalated` |
| `POST` | `/api/mod/reports/:id/reject` | Moderator only |
| `POST` | `/api/mod/reports/:id/escalate` | Moderator only |
| `POST` | `/api/owner/ban` | Owner only; body `{ userId, duration: "1w"\|"2w"\|"1m"\|"perm", reportId?, reason? }` |
| `POST` | `/api/owner/dismiss-report` | Owner only; body `{ reportId, note? }` |
| `POST` | `/api/owner/set-moderator` | Owner only; body `{ username, promote: boolean }` |

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
