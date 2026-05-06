# Deploy the full game (one HTTPS URL)

Sky Hop is **one Node process**: static files, **`/api/*` accounts** (same host), and **WebSocket** racing. The address bar is always just `https://yoursite.com/` — you never type `/api`; the browser calls it in the background on the **same domain**.

**Netlify’s default “static site” deploy cannot run this server.** There is no Node + WebSocket race room on plain Netlify static hosting, so `https://….netlify.app/api/register` returns **404**. You either:

- Host the **whole app** on a **Node/Docker** platform (below), or  
- Split into a static site + separate API host (more work, two URLs to configure).

Recommended: deploy the **Dockerfile** at the repo root to **Render**, **Fly.io**, or **Railway**.

---

## Render (simple)

1. Push this repo to GitHub/GitLab.
2. [Render](https://render.com) → **New +** → **Web Service** → connect repo.
3. **Runtime:** Docker (Render detects the root `Dockerfile`).
4. **Instance type:** free or paid.
5. **Environment** (for Supabase accounts):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - **`SKYHOP_OWNER_USERNAME`** — your game login name (owner inbox / bans). Not in git; set here like other secrets.
6. Deploy. Render gives you `https://something.onrender.com`.
7. Open that URL → play → Account works (same origin).

Health check (optional): path **`/health`**, expect `200` and JSON `{"ok":true}`.

**Custom domain:** Render dashboard → your service → **Custom Domains** → add `ve-platformer.com` (you’ll move DNS away from Netlify or use a subdomain like `game.ve-platformer.com`).

---

## Fly.io

1. Install [flyctl](https://fly.io/docs/hands-on/install-flyctl/).
2. From the **repo root** (where `Dockerfile` is):

   ```bash
   fly launch
   ```

   Use the included `fly.toml`, pick a region, **don’t** deploy a tiny Postgres unless you want it for something else.

3. Set secrets (include owner username — **Docker builds do not ship `.env.local`**):

   ```bash
   fly secrets set SUPABASE_URL="https://xxxx.supabase.co" SUPABASE_SERVICE_ROLE_KEY="eyJ..." SKYHOP_OWNER_USERNAME="yourLoginName"
   ```

4. Deploy:

   ```bash
   fly deploy
   ```

5. Open `https://your-app.fly.dev` — leave Racing server blank; Account uses the same host.

**Custom domain:** `fly certs add ve-platformer.com` and follow DNS instructions.

---

## Railway

1. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub** → select repo.
2. Set **Root** / Dockerfile build to use root `Dockerfile` (Railway auto-detects often).
3. Add variables `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
4. Railway assigns `*.railway.app` HTTPS URL; attach custom domain in project settings if you want.

---

## About `/api` and “working on the website itself”

- Visitors only open **`https://your-domain/`** — same as Netlify today.
- Login/register use **`fetch('https://your-domain/api/register', …)`** (same origin). That path is **not** a second website; it’s how the server separates JSON routes from files like `/js/...`.
- You **cannot** remove `/api` from the server without colliding with static paths unless we renamed every route (no real benefit for players).

---

## Leaving Netlify

To keep the name **ve-platformer**:

- Point DNS (or a subdomain) at **Render / Fly / Railway**, or  
- Keep Netlify for a **marketing page** and link “Play” to `https://game.yourdomain.com` hosted on Node.

You cannot make `https://ve-platformer.netlify.app` run this Node+WebSocket stack **without** Netlify Functions + a separate WebSocket host — a large rewrite. Hosting the Docker image on Fly/Render is the straightforward fix.
