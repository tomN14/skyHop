/**
 * Cloud account: register, login, stats, achievements. Uses REST on the same host as Racing (SKYHOP_RACE_SERVER_URL → http).
 */
(function () {
  const LS_TOKEN = 'SKYHOP_AUTH_TOKEN';
  const LS_USER = 'SKYHOP_USERNAME';
  const LS_RACE_URL = 'SKYHOP_RACE_SERVER_URL';
  const DEF_WS = 'ws://127.0.0.1:3001';

  const LS_API_ORIGIN = 'SKYHOP_API_ORIGIN';

  function wsUrlIsLoopbackOnly(u) {
    if (!u) return true;
    try {
      const x = new URL(u);
      const h = (x.hostname || '').toLowerCase();
      if (h === '127.0.0.1' || h === 'localhost' || h === '::1') return true;
    } catch {
      /* */
    }
    if (/^wss?:\/\/127\.0\.0\.1\b/i.test(u) || /:\/\/localhost[:/ ]/i.test(u)) return true;
    return false;
  }

  function sameSiteDefaultWs() {
    try {
      if (typeof window === 'undefined' || !window.location) return null;
      const { protocol, host, hostname } = window.location;
      if (!host) return null;
      if (protocol === 'https:') return 'wss://' + host;
      if (protocol === 'http:') {
        if (/^(127\.0\.0\.1|localhost|\[::1\]|\:\:1)$/i.test(hostname)) return null;
        return 'ws://' + host;
      }
    } catch {
      /* */
    }
    return null;
  }

  function effectiveRaceWsUrl() {
    var v = null;
    try {
      v = localStorage.getItem(LS_RACE_URL);
    } catch {
      v = null;
    }
    if (v === 'ws://localhost:3001') v = 'ws://127.0.0.1:3001';
    var httpsPage = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
    var ss = sameSiteDefaultWs();
    if (httpsPage && ss) {
      if (!v || v === DEF_WS || wsUrlIsLoopbackOnly(v)) return ss;
    }
    if (v) return v;
    return ss || DEF_WS;
  }

  /**
   * Base URL for REST (/api, /health). On HTTPS, empty Racing field = this page’s host (wss → https).
   */
  function apiOrigin() {
    try {
      const ovr = localStorage.getItem(LS_API_ORIGIN);
      if (ovr && ovr.trim()) return new URL(ovr.trim().replace(/\/$/, '')).origin;
    } catch {
      /* invalid override */
    }
    let origin;
    try {
      const w = effectiveRaceWsUrl();
      const o = new URL(w);
      o.protocol = o.protocol === 'wss:' ? 'https:' : 'http:';
      origin = o.origin;
    } catch {
      origin = 'http://127.0.0.1:3001';
    }
    try {
      if (
        typeof window !== 'undefined' &&
        window.location &&
        window.location.protocol === 'https:' &&
        origin.startsWith('http://')
      ) {
        return window.location.origin;
      }
    } catch {
      /* */
    }
    return origin;
  }

  /** User-facing hint when /api/* returns 404 (wrong host, static-only site, or Supabase URL mistaken for API). */
  function explainApi404(requestUrl) {
    const origin = apiOrigin();
    var parts = [
      'No Sky Hop API at ' +
        requestUrl +
        ' (HTTP 404). The game must call your Node server (/api/register, etc.), not a static page host and not Supabase from the browser.',
    ];
    try {
      if (/supabase\.co$/i.test(new URL(origin).hostname)) {
        parts.push('Remove the Supabase project URL from Account → Advanced — put your Node URL there (e.g. http://127.0.0.1:3001) or leave it empty when you open the game from that Node URL.');
      }
    } catch {
      /* */
    }
    try {
      if (typeof window !== 'undefined' && window.location && window.location.origin === origin) {
        parts.push(
          'This page’s host does not serve /api. Run npm run play, open http://127.0.0.1:3001/, leave API base empty — or deploy the Node app so /api exists on the same domain.'
        );
      } else {
        parts.push('Check ' + origin + '/health shows {"ok":true}. If not, fix Racing/API base to match where npm run play listens (usually port 3001).');
      }
    } catch {
      parts.push('Check ' + origin + '/health for {"ok":true}.');
    }
    return parts.join(' ');
  }

  function fmtClock(ms) {
    if (ms == null || !Number.isFinite(ms)) return '—';
    const tSec = Math.floor(ms / 1000);
    const h = Math.floor(tSec / 3600);
    const m = Math.floor((tSec % 3600) / 60);
    const s = tSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function fmtAvgDeaths(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  async function api(path, opts) {
    const url = apiOrigin() + path;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    let r;
    try {
      r = await fetch(url, Object.assign({}, opts, { headers }));
    } catch (e) {
      const origin = apiOrigin();
      const isHttpsPage =
        typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
      throw new Error(
        'Cannot reach ' +
          origin +
          '. Keep Node running: cd server && npm start. ' +
          'If this tab is HTTPS, accounts use this site (' +
          origin +
          ') — configure your host to reverse-proxy /api and /health to Node (port 3001). ' +
          'Or set a full HTTPS API base in Account. ' +
          'Racing still needs wss:// in the Racing menu. ' +
          (isHttpsPage
            ? 'Open DevTools → Network if requests 404: proxy rules may be missing.'
            : '')
      );
    }
    const text = await r.text();
    let data = null;
    try {
      if (text) data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!r.ok) {
      if (data && typeof data.error === 'string' && data.error) {
        throw new Error(data.error);
      }
      if (r.status === 404) {
        throw new Error(explainApi404(url));
      }
      if (data === null) {
        const snippet = (text || '').trim().slice(0, 120).replace(/\s+/g, ' ');
        throw new Error(
          'Server returned non-JSON (HTTP ' +
            r.status +
            '). ' +
            (snippet ? 'Body: ' + snippet : 'Empty body.') +
            ' — see ' +
            apiOrigin() +
            '/health'
        );
      }
      throw new Error(String(r.status));
    }

    if (data === null) {
      throw new Error('Server returned OK but not JSON from ' + url);
    }
    return data;
  }

  window.SkyHopApiRequest = api;

  function getToken() {
    try {
      return localStorage.getItem(LS_TOKEN);
    } catch {
      return null;
    }
  }

  function setAuth(token, username) {
    try {
      if (token) localStorage.setItem(LS_TOKEN, token);
      else localStorage.removeItem(LS_TOKEN);
      if (username) localStorage.setItem(LS_USER, username);
      else localStorage.removeItem(LS_USER);
    } catch {
      /* */
    }
    try {
      window.dispatchEvent(new CustomEvent('skyhop-auth-changed'));
    } catch {
      /* */
    }
  }

  window.SkyHopSubmitRun = function (timeMs, deaths, source) {
    const tok = getToken();
    if (!tok) return Promise.resolve();
    return api('/api/runs', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok },
      body: JSON.stringify({
        timeMs: Math.round(timeMs != null ? timeMs : 0),
        deaths: deaths != null ? deaths : 0,
        source: source === 'race' ? 'race' : 'campaign',
      }),
    }).catch(function (e) {
      console.warn('Sky Hop: could not save run to account', e);
    });
  };

  function bind() {
    const screen = document.getElementById('screenAccount');
    const btnOpen = document.getElementById('btnOpenAccount');
    const btnClose = document.getElementById('btnAccountClose');
    const accErr = document.getElementById('accError');
    const accLogged = document.getElementById('accLoggedBlock');
    const accGuest = document.getElementById('accGuestBlock');
    const accUserLabel = document.getElementById('accUserLabel');
    const accStatRuns = document.getElementById('accStatRuns');
    const accStatDeathTotal = document.getElementById('accStatDeathTotal');
    const accStatDeathMin = document.getElementById('accStatDeathMin');
    const accStatDeathMax = document.getElementById('accStatDeathMax');
    const accStatTimeBest = document.getElementById('accStatTimeBest');
    const accStatTimeAvg = document.getElementById('accStatTimeAvg');
    const accStatDeathAvg = document.getElementById('accStatDeathAvg');
    const accAchList = document.getElementById('accAchList');
    const accServerHint = document.getElementById('accServerHint');
    const inpLoginUser = document.getElementById('accLoginUser');
    const inpLoginPass = document.getElementById('accLoginPass');
    const inpRegUser = document.getElementById('accRegUser');
    const inpRegPass = document.getElementById('accRegPass');
    const btnLogin = document.getElementById('accBtnLogin');
    const btnRegister = document.getElementById('accBtnRegister');
    const btnLogout = document.getElementById('accBtnLogout');
    const inpApiBase = document.getElementById('accApiBase');

    if (!screen || !btnOpen) return;

    function serverHintText() {
      var hint = 'REST API: ' + apiOrigin();
      var apiOvr = null;
      try {
        apiOvr = localStorage.getItem(LS_API_ORIGIN);
      } catch {
        apiOvr = null;
      }
      if (sameSiteDefaultWs() && !apiOvr) {
        hint += ' — same as this page (leave Racing server blank).';
      } else if (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:') {
        hint += ' — use a hosted game URL, host-only in Racing, or optional API override below.';
      }
      return hint;
    }

    function setErr(t) {
      if (!accErr) return;
      accErr.textContent = t || '';
      accErr.classList.toggle('hidden', !t);
    }

    function renderAchievements(list) {
      if (!accAchList) return;
      accAchList.innerHTML = (list || [])
        .map(function (a) {
          const on = a.unlocked;
          return (
            '<li class="rounded-lg border px-2 py-2 text-left text-xs ' +
            (on ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-100' : 'border-white/10 bg-slate-950/50 text-slate-500') +
            '">' +
            '<span class="font-sem ' +
            (on ? 'text-emerald-200' : 'text-slate-500') +
            '">' +
            (on ? '★ ' : '○ ') +
            escapeHtml(a.title) +
            '</span>' +
            '<p class="mt-0.5 text-[11px] leading-snug opacity-90">' +
            escapeHtml(a.desc) +
            '</p></li>'
          );
        })
        .join('');
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function renderStats(st) {
      if (!st) return;
      if (accStatRuns) accStatRuns.textContent = String(st.runCount != null ? st.runCount : 0);
      if (accStatDeathTotal) accStatDeathTotal.textContent = String(st.totalDeaths != null ? st.totalDeaths : 0);
      if (accStatDeathMin) accStatDeathMin.textContent = st.minDeaths != null ? String(st.minDeaths) : '—';
      if (accStatDeathMax) accStatDeathMax.textContent = st.maxDeaths != null ? String(st.maxDeaths) : '—';
      if (accStatTimeBest) accStatTimeBest.textContent = fmtClock(st.bestTimeMs);
      if (accStatTimeAvg) accStatTimeAvg.textContent = fmtClock(st.avgTimeMs);
      if (accStatDeathAvg) accStatDeathAvg.textContent = fmtAvgDeaths(st.avgDeaths);
    }

    async function refreshPanel() {
      setErr('');
      if (inpApiBase) {
        try {
          var saved = localStorage.getItem(LS_API_ORIGIN) || '';
          if (saved && /supabase\.co/i.test(saved)) {
            localStorage.removeItem(LS_API_ORIGIN);
            saved = '';
            inpApiBase.value = '';
          } else {
            inpApiBase.value = saved;
          }
        } catch {
          inpApiBase.value = '';
        }
      }
      if (accServerHint) accServerHint.textContent = serverHintText();
      const tok = getToken();
      if (!tok) {
        if (accLogged) accLogged.classList.add('hidden');
        if (accGuest) accGuest.classList.remove('hidden');
        return;
      }
      try {
        const me = await api('/api/me', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        if (accGuest) accGuest.classList.add('hidden');
        if (accLogged) accLogged.classList.remove('hidden');
        if (accUserLabel) accUserLabel.textContent = me.username || '';
        setAuth(tok, me.username);
        renderStats(me.stats);
        renderAchievements(me.achievements);
      } catch (e) {
        setAuth(null, null);
        if (accLogged) accLogged.classList.add('hidden');
        if (accGuest) accGuest.classList.remove('hidden');
        setErr(String(e.message || e));
      }
    }

    btnOpen.addEventListener('click', function () {
      screen.classList.remove('hidden');
      screen.classList.add('flex');
      void refreshPanel();
    });
    if (btnClose) {
      btnClose.addEventListener('click', function () {
        screen.classList.add('hidden');
        screen.classList.remove('flex');
      });
    }

    if (btnLogin) {
      btnLogin.addEventListener('click', async function () {
        setErr('');
        try {
          const data = await api('/api/login', {
            method: 'POST',
            body: JSON.stringify({
              username: (inpLoginUser && inpLoginUser.value) || '',
              password: (inpLoginPass && inpLoginPass.value) || '',
            }),
          });
          setAuth(data.token, data.username);
          if (inpLoginPass) inpLoginPass.value = '';
          await refreshPanel();
        } catch (e) {
          setErr(String(e.message || e));
        }
      });
    }

    if (btnRegister) {
      btnRegister.addEventListener('click', async function () {
        setErr('');
        try {
          const data = await api('/api/register', {
            method: 'POST',
            body: JSON.stringify({
              username: (inpRegUser && inpRegUser.value) || '',
              password: (inpRegPass && inpRegPass.value) || '',
            }),
          });
          setAuth(data.token, data.username);
          if (inpRegPass) inpRegPass.value = '';
          await refreshPanel();
        } catch (e) {
          setErr(String(e.message || e));
        }
      });
    }

    if (btnLogout) {
      btnLogout.addEventListener('click', async function () {
        const tok = getToken();
        setErr('');
        try {
          if (tok) {
            await api('/api/logout', {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + tok },
            });
          }
        } catch {
          /* */
        }
        setAuth(null, null);
        await refreshPanel();
      });
    }

    if (inpApiBase) {
      inpApiBase.addEventListener('change', function () {
        setErr('');
        const v = inpApiBase.value.trim();
        try {
          if (!v) {
            localStorage.removeItem(LS_API_ORIGIN);
          } else {
            const parsed = new URL(v);
            if (/supabase\.co$/i.test(parsed.hostname)) {
              setErr(
                'Do not use your Supabase project URL here. The browser calls only your Sky Hop Node server; Supabase is used in server/.env.local on the machine running npm run play.'
              );
              return;
            }
            localStorage.setItem(LS_API_ORIGIN, v.replace(/\/$/, ''));
          }
        } catch {
          setErr('Invalid API base URL (use https://your.host — no trailing path needed)');
          return;
        }
        if (accServerHint) accServerHint.textContent = serverHintText();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
