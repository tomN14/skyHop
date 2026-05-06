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
        const err = new Error(data.error);
        err.skyhop = Object.assign({ status: r.status }, data);
        throw err;
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
      const err = new Error(String(r.status));
      err.skyhop = Object.assign({ status: r.status }, data && typeof data === 'object' ? data : {});
      throw err;
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

    function updateModFab(me) {
      const fab = document.getElementById('btnModInbox');
      const badge = document.getElementById('modInboxBadge');
      if (!fab || !badge) return;
      const role = me && me.role ? me.role : 'player';
      const n =
        role === 'owner'
          ? me.ownerInboxCount || 0
          : role === 'moderator'
            ? me.modInboxCount || 0
            : 0;
      const show = role === 'moderator' || role === 'owner';
      fab.classList.toggle('hidden', !show);
      if (n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    function showBanScreen(sh) {
      const el = document.getElementById('screenBan');
      const perm = document.getElementById('banBodyPermanent');
      const temp = document.getElementById('banBodyTemp');
      const untilL = document.getElementById('banUntilLabel');
      const reasonWrap = document.getElementById('banReasonWrap');
      const reasonLabel = document.getElementById('banReasonLabel');
      if (!el) return;
      if (sh && sh.permanent) {
        if (perm) perm.classList.remove('hidden');
        if (temp) temp.classList.add('hidden');
        if (untilL) untilL.classList.add('hidden');
      } else {
        if (perm) perm.classList.add('hidden');
        if (temp) temp.classList.remove('hidden');
        if (untilL) {
          untilL.classList.remove('hidden');
          untilL.textContent =
            sh && sh.untilMs != null && Number.isFinite(Number(sh.untilMs))
              ? new Date(Number(sh.untilMs)).toLocaleString()
              : '—';
        }
      }
      if (sh && sh.reason) {
        if (reasonWrap) reasonWrap.classList.remove('hidden');
        if (reasonLabel) reasonLabel.textContent = String(sh.reason);
      } else {
        if (reasonWrap) reasonWrap.classList.add('hidden');
      }
      el.classList.remove('hidden');
      el.classList.add('flex');
    }

    function hideBanScreen() {
      const el = document.getElementById('screenBan');
      if (!el) return;
      el.classList.add('hidden');
      el.classList.remove('flex');
    }

    async function refreshOwnerModList() {
      const ul = document.getElementById('ownerModList');
      const tok = getToken();
      if (!ul || !tok) return;
      try {
        const data = await api('/api/owner/moderators', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        const list = data.moderators || [];
        if (!list.length) {
          ul.innerHTML = '<li class="list-none text-slate-500">(none)</li>';
          return;
        }
        ul.innerHTML = list
          .map(function (m) {
            return (
              '<li class="list-none rounded bg-slate-900/40 px-2 py-0.5">' + escapeHtml(m.username) + '</li>'
            );
          })
          .join('');
      } catch {
        ul.innerHTML = '<li class="list-none text-slate-500">Could not load moderators</li>';
      }
    }

    function setModErr(t) {
      const x = document.getElementById('modInboxErr');
      if (!x) return;
      x.textContent = t || '';
      x.classList.toggle('hidden', !t);
    }

    async function loadModInboxList() {
      const tok = getToken();
      const listEl = document.getElementById('modInboxList');
      const kicker = document.getElementById('modInboxKicker');
      const hint = document.getElementById('modInboxHint');
      if (!tok || !listEl) return;
      setModErr('');
      const me = window.__skyhopLastMe || {};
      const role = me.role || 'player';
      if (role === 'owner') void refreshOwnerModList();
      if (kicker) kicker.textContent = role === 'owner' ? 'Owner queue' : 'Moderator queue';
      if (hint) {
        hint.textContent =
          role === 'owner'
            ? 'Escalated reports. Ban the reported user or dismiss without action.'
            : 'New reports. Reject if invalid, or escalate to the site owner.';
      }
      try {
        const data = await api('/api/mod/reports', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        const reports = data.reports || [];
        if (!reports.length) {
          listEl.innerHTML =
            '<li class="rounded-xl border border-white/10 bg-slate-950/50 py-8 text-center text-sm text-slate-500">No items.</li>';
          return;
        }
        listEl.innerHTML = reports
          .map(function (r) {
            var safe = function (s) {
              return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/"/g, '&quot;');
            };
            var actions = '';
            if (data.scope === 'pending') {
              actions =
                '<div class="mt-2 flex flex-wrap gap-2">' +
                '<button type="button" data-act="rej" data-id="' +
                safe(r.id) +
                '" class="rounded-lg border border-rose-500/50 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-950/40">Reject</button>' +
                '<button type="button" data-act="esc" data-id="' +
                safe(r.id) +
                '" class="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500">Escalate to owner</button>' +
                '</div>';
            } else {
              actions =
                '<div class="mt-2 flex flex-wrap items-center gap-2">' +
                '<select data-ban-dur="' +
                safe(r.id) +
                '" class="rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-[11px] text-white">' +
                '<option value="1w">1 week</option><option value="2w">2 weeks</option><option value="1m">1 month</option><option value="perm">Permanent</option></select>' +
                '<button type="button" data-act="ban" data-id="' +
                safe(r.id) +
                '" data-user="' +
                r.reportedUserId +
                '" class="rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-500">Ban user</button>' +
                '<button type="button" data-act="dismiss" data-id="' +
                safe(r.id) +
                '" class="rounded-lg border border-white/20 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10">Dismiss</button>' +
                '</div>';
            }
            return (
              '<li class="rounded-xl border border-white/10 bg-slate-950/60 p-3 text-left text-sm">' +
              '<p class="text-[11px] text-slate-500">Report <span class="font-mono text-slate-300">' +
              safe(r.id).slice(0, 8) +
              '…</span></p>' +
              '<p class="mt-1 text-slate-200"><span class="text-slate-500">Reporter:</span> ' +
              safe(r.reporterUsername) +
              ' · <span class="text-slate-500">Reported:</span> <strong>' +
              safe(r.reportedUsername) +
              '</strong></p>' +
              '<p class="mt-2 whitespace-pre-wrap text-xs text-slate-300">' +
              safe(r.reason) +
              '</p>' +
              actions +
              '</li>'
            );
          })
          .join('');

        listEl.querySelectorAll('button[data-act]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var act = btn.getAttribute('data-act');
            var id = btn.getAttribute('data-id');
            var userId = btn.getAttribute('data-user');
            var note = window.prompt('Optional note (for moderators):') || '';
            try {
              if (act === 'rej') {
                await api('/api/mod/reports/' + encodeURIComponent(id) + '/reject', {
                  method: 'POST',
                  headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ note: note || undefined }),
                });
              } else if (act === 'esc') {
                await api('/api/mod/reports/' + encodeURIComponent(id) + '/escalate', {
                  method: 'POST',
                  headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ note: note || undefined }),
                });
              } else if (act === 'dismiss') {
                await api('/api/owner/dismiss-report', {
                  method: 'POST',
                  headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ reportId: id, note: note || undefined }),
                });
              } else if (act === 'ban') {
                var sel = listEl.querySelector('select[data-ban-dur="' + id + '"]');
                var dur = sel ? sel.value : '1w';
                var banReason =
                  window.prompt('Ban reason (shown to user):', 'Terms violation') || 'Terms violation';
                await api('/api/owner/ban', {
                  method: 'POST',
                  headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    userId: Number(userId),
                    duration: dur,
                    reportId: id,
                    reason: banReason,
                    note: note || undefined,
                  }),
                });
              }
              await refreshPanel();
              await loadModInboxList();
            } catch (err) {
              setModErr(String(err.message || err));
            }
          });
        });
      } catch (e) {
        setModErr(String(e.message || e));
      }
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
      const fab = document.getElementById('btnModInbox');
      if (!tok) {
        if (accLogged) accLogged.classList.add('hidden');
        if (accGuest) accGuest.classList.remove('hidden');
        if (fab) fab.classList.add('hidden');
        window.__skyhopLastMe = null;
        return;
      }
      try {
        const me = await api('/api/me', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        window.__skyhopLastMe = me;
        if (accGuest) accGuest.classList.add('hidden');
        if (accLogged) accLogged.classList.remove('hidden');
        if (accUserLabel) {
          accUserLabel.textContent = me.username || '';
          if (me.role === 'moderator') {
            accUserLabel.className = 'font-semibold text-rose-400';
          } else {
            accUserLabel.className = 'font-semibold text-violet-200';
          }
        }
        setAuth(tok, me.username);
        renderStats(me.stats);
        renderAchievements(me.achievements);
        updateModFab(me);
        const ownerTools = document.getElementById('ownerTools');
        if (ownerTools) ownerTools.classList.toggle('hidden', (me.role || 'player') !== 'owner');
      } catch (e) {
        setAuth(null, null);
        if (accLogged) accLogged.classList.add('hidden');
        if (accGuest) accGuest.classList.remove('hidden');
        if (fab) fab.classList.add('hidden');
        window.__skyhopLastMe = null;
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
          if (e.skyhop && e.skyhop.banned) {
            showBanScreen(e.skyhop);
            return;
          }
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

    var screenModInbox = document.getElementById('screenModInbox');
    var btnModInbox = document.getElementById('btnModInbox');
    var btnModInboxClose = document.getElementById('btnModInboxClose');
    if (btnModInbox && screenModInbox) {
      btnModInbox.addEventListener('click', function () {
        screenModInbox.classList.remove('hidden');
        screenModInbox.classList.add('flex');
        void loadModInboxList();
      });
    }
    if (btnModInboxClose && screenModInbox) {
      btnModInboxClose.addEventListener('click', function () {
        screenModInbox.classList.add('hidden');
        screenModInbox.classList.remove('flex');
      });
    }

    var btnBanOk = document.getElementById('btnBanOk');
    if (btnBanOk) btnBanOk.addEventListener('click', hideBanScreen);

    var accBtnSubmitReport = document.getElementById('accBtnSubmitReport');
    var accReportUser = document.getElementById('accReportUser');
    var accReportReason = document.getElementById('accReportReason');
    var accReportMsg = document.getElementById('accReportMsg');
    if (accBtnSubmitReport) {
      accBtnSubmitReport.addEventListener('click', async function () {
        if (accReportMsg) {
          accReportMsg.textContent = '';
          accReportMsg.classList.add('hidden');
        }
        var tok = getToken();
        if (!tok) return;
        try {
          await api('/api/reports', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reportedUsername: (accReportUser && accReportUser.value) || '',
              reason: (accReportReason && accReportReason.value) || '',
            }),
          });
          if (accReportUser) accReportUser.value = '';
          if (accReportReason) accReportReason.value = '';
          if (accReportMsg) {
            accReportMsg.textContent = 'Report submitted. Thank you.';
            accReportMsg.classList.remove('hidden');
          }
        } catch (e) {
          if (accReportMsg) {
            accReportMsg.textContent = String(e.message || e);
            accReportMsg.classList.remove('hidden');
          }
        }
      });
    }

    var ownerBtnModOn = document.getElementById('ownerBtnModOn');
    var ownerBtnModOff = document.getElementById('ownerBtnModOff');
    var ownerModUsername = document.getElementById('ownerModUsername');
    var ownerModMsg = document.getElementById('ownerModMsg');
    function setOwnerModMsg(t, isErr) {
      if (!ownerModMsg) return;
      ownerModMsg.textContent = t || '';
      ownerModMsg.classList.toggle('hidden', !t);
      ownerModMsg.classList.toggle('text-rose-300', !!isErr);
      ownerModMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    if (ownerBtnModOn) {
      ownerBtnModOn.addEventListener('click', async function () {
        var tok = getToken();
        if (!tok) return;
        setOwnerModMsg('', false);
        try {
          await api('/api/owner/set-moderator', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: (ownerModUsername && ownerModUsername.value) || '',
              promote: true,
            }),
          });
          setOwnerModMsg('Updated.', false);
          void refreshOwnerModList();
        } catch (e) {
          setOwnerModMsg(String(e.message || e), true);
        }
      });
    }
    if (ownerBtnModOff) {
      ownerBtnModOff.addEventListener('click', async function () {
        var tok = getToken();
        if (!tok) return;
        setOwnerModMsg('', false);
        try {
          await api('/api/owner/set-moderator', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: (ownerModUsername && ownerModUsername.value) || '',
              promote: false,
            }),
          });
          setOwnerModMsg('Updated.', false);
          void refreshOwnerModList();
        } catch (e) {
          setOwnerModMsg(String(e.message || e), true);
        }
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

    if (getToken()) void refreshPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
