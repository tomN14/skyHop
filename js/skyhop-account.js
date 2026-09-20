/**
 * Cloud account: register, login, stats, achievements. Uses REST on the same host as Racing (SKYHOP_RACE_SERVER_URL → http).
 */
(function () {
  const LS_TOKEN = 'SKYHOP_AUTH_TOKEN';
  const LS_USER = 'SKYHOP_USERNAME';
  const LS_RACE_URL = 'SKYHOP_RACE_SERVER_URL';
  const DEF_WS = 'ws://127.0.0.1:3001';

  const LS_API_ORIGIN = 'SKYHOP_API_ORIGIN';

  let campaignRunSessionId = null;
  const campaignAttestQueue = [];
  let campaignAttestFlushing = false;

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
    const o = opts || {};
    const url = apiOrigin() + path;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
    if (!o.noAuth && !headers.Authorization) {
      const tok = getToken();
      if (tok) headers.Authorization = 'Bearer ' + tok;
    }
    let r;
    try {
      r = await fetch(url, Object.assign({}, o, { headers }));
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
  window.SkyHopApiOrigin = apiOrigin;

  function applyMenuBranding(b) {
    if (!b || typeof b !== 'object') return;
    var title = String(b.title || '').trim() || 'Sky Hop';
    var version = String(b.version || '').trim() || '3.19';
    var updateName = String(b.updateName || '').trim();
    var titleEl = document.getElementById('menuGameTitle');
    var versionEl = document.getElementById('menuGameVersion');
    var updateEl = document.getElementById('menuUpdateName');
    var wrap = document.getElementById('menuUpdateWrap');
    if (titleEl) titleEl.textContent = title;
    if (versionEl) versionEl.textContent = version;
    if (updateEl) updateEl.textContent = updateName;
    if (wrap) wrap.classList.toggle('hidden', !updateName);
    document.title = title + ' ' + version + ' — Worlds & Collab';
  }

  async function refreshMenuBranding() {
    try {
      var data = await api('/api/site/branding', { method: 'GET', noAuth: true });
      if (data && (data.title || data.version || data.updateName != null)) applyMenuBranding(data);
    } catch {
      /* keep bundled title in index.html */
    }
  }

  window.SkyHopApplyBranding = applyMenuBranding;
  window.SkyHopRefreshBranding = refreshMenuBranding;

  function staffNameClass(role) {
    if (role === 'owner') return 'font-semibold text-amber-300';
    if (role === 'admin') return 'font-semibold text-emerald-300';
    if (role === 'moderator') return 'font-semibold text-rose-400';
    if (role === 'report_advisor') return 'font-semibold text-sky-300';
    return 'font-semibold text-violet-200';
  }
  window.SkyHopAuthorNameClass = function (role) {
    if (role === 'owner') return 'text-amber-300 font-semibold';
    if (role === 'admin') return 'text-emerald-300 font-semibold';
    if (role === 'moderator') return 'text-rose-400 font-semibold';
    if (role === 'report_advisor') return 'text-sky-300 font-semibold';
    return 'text-slate-400';
  };

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

  window.SkyHopCampaignAttestReset = function () {
    campaignRunSessionId = null;
    campaignAttestQueue.length = 0;
    campaignAttestFlushing = false;
  };

  window.SkyHopCampaignAttestStart = function () {
    const tok = getToken();
    if (!tok) return Promise.resolve(null);
    campaignRunSessionId = null;
    campaignAttestQueue.length = 0;
    campaignAttestFlushing = false;
    return api('/api/campaign-run/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok },
      body: JSON.stringify({}),
    })
      .then(function (d) {
        campaignRunSessionId = d && d.sessionId ? d.sessionId : null;
        if (campaignRunSessionId) flushCampaignAttestQueue();
        return campaignRunSessionId;
      })
      .catch(function () {
        campaignRunSessionId = null;
        return null;
      });
  };

  function sendOneCheckpoint(sample) {
    const tok = getToken();
    if (!tok || !campaignRunSessionId) return Promise.resolve(false);
    return api('/api/campaign-run/checkpoint', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok },
      body: JSON.stringify(Object.assign({ sessionId: campaignRunSessionId }, sample)),
    })
      .then(function () {
        return true;
      })
      .catch(function (e) {
        console.warn('Sky Hop: checkpoint rejected', e);
        return false;
      });
  }

  function flushCampaignAttestQueue() {
    if (!campaignRunSessionId || campaignAttestFlushing || !campaignAttestQueue.length) return;
    campaignAttestFlushing = true;
    const sample = campaignAttestQueue.shift();
    sendOneCheckpoint(sample).finally(function () {
      campaignAttestFlushing = false;
      flushCampaignAttestQueue();
    });
  }

  window.SkyHopCampaignAttestCheckpoint = function (sample) {
    if (!getToken() || !sample) return;
    campaignAttestQueue.push(sample);
    if (campaignRunSessionId) flushCampaignAttestQueue();
  };

  window.SkyHopCampaignAttestFlush = function () {
    return new Promise(function (resolve) {
      function tick() {
        if (campaignAttestFlushing || campaignAttestQueue.length) {
          if (!campaignAttestFlushing && campaignAttestQueue.length && campaignRunSessionId) {
            flushCampaignAttestQueue();
          }
          setTimeout(tick, 40);
          return;
        }
        resolve(campaignRunSessionId);
      }
      tick();
    });
  };

  window.SkyHopCampaignAttestGetSessionId = function () {
    return campaignRunSessionId;
  };

  window.SkyHopSubmitRun = function (timeMs, deaths, source, extra) {
    const tok = getToken();
    if (!tok) return Promise.resolve();
    const payload = {
      timeMs: Math.round(timeMs != null ? timeMs : 0),
      deaths: deaths != null ? deaths : 0,
      source: source === 'race' ? 'race' : 'campaign',
    };
    if (extra && typeof extra === 'object' && source === 'race' && extra.raceFinishToken) {
      payload.raceFinishToken = extra.raceFinishToken;
    }
    if (extra && typeof extra === 'object' && source !== 'race') {
      const coinMeta = Object.assign({}, extra);
      if (coinMeta.difficulty) {
        payload.difficulty = coinMeta.difficulty;
        delete coinMeta.difficulty;
      }
      payload.campaignCoinMeta = coinMeta;
      if (extra.campaignRunSessionId) {
        payload.campaignRunSessionId = extra.campaignRunSessionId;
      }
    }
    return api('/api/runs', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok },
      body: JSON.stringify(payload),
    })
      .then(function (data) {
        if (typeof window.SkyHopRefreshLeaderboard === 'function') {
          try {
            window.SkyHopRefreshLeaderboard();
          } catch {
            /* */
          }
        }
        if (data && window.__skyhopLastMe) {
          if (data.coins != null) window.__skyhopLastMe.coins = data.coins;
          if (data.coinsInfinite != null) window.__skyhopLastMe.coinsInfinite = !!data.coinsInfinite;
          try {
            const el = document.getElementById('accStatCoins');
            if (el) {
              el.textContent = window.__skyhopLastMe.coinsInfinite
                ? '∞'
                : String(data.coins != null ? data.coins : window.__skyhopLastMe.coins);
            }
          } catch {
            /* */
          }
        }
        return data;
      })
      .catch(function (e) {
        console.warn('Sky Hop: could not save run to account', e);
      });
  };

  function bind() {
    if (document.documentElement.dataset.skyhopAccountBound === '1') return;
    document.documentElement.dataset.skyhopAccountBound = '1';

    let authRefreshSeq = 0;
    function bumpAuthRefresh() {
      authRefreshSeq += 1;
    }

    const screen = document.getElementById('screenAccount');
    const btnOpen = document.getElementById('btnOpenAccount');
    const btnClose = document.getElementById('btnAccountClose');
    const accErr = document.getElementById('accError');
    const accLogged = document.getElementById('accLoggedBlock');
    const accGuest = document.getElementById('accGuestBlock');
    const accUserLabel = document.getElementById('accUserLabel');
    const accStatRuns = document.getElementById('accStatRuns');
    const accStatCoins = document.getElementById('accStatCoins');
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
      const me = window.__skyhopLastMe;
      const coins = me && me.coins != null ? me.coins : 0;
      const inf = me && me.coinsInfinite;
      if (accStatCoins) accStatCoins.textContent = inf ? '∞' : String(coins);
      if (accStatRuns) accStatRuns.textContent = String(st.runCount != null ? st.runCount : 0);
      if (accStatDeathTotal) accStatDeathTotal.textContent = String(st.totalDeaths != null ? st.totalDeaths : 0);
      if (accStatDeathMin) accStatDeathMin.textContent = st.minDeaths != null ? String(st.minDeaths) : '—';
      if (accStatDeathMax) accStatDeathMax.textContent = st.maxDeaths != null ? String(st.maxDeaths) : '—';
      if (accStatTimeBest) accStatTimeBest.textContent = fmtClock(st.bestTimeMs);
      if (accStatTimeAvg) accStatTimeAvg.textContent = fmtClock(st.avgTimeMs);
      if (accStatDeathAvg) accStatDeathAvg.textContent = fmtAvgDeaths(st.avgDeaths);
    }

    function updateModDashboardFab(me) {
      if (typeof window.SkyHopUpdateModDashboardFab === 'function') {
        window.SkyHopUpdateModDashboardFab(me);
      }
    }

    function updateModFab(me) {
      const fab = document.getElementById('btnModInbox');
      const badge = document.getElementById('modInboxBadge');
      if (!fab || !badge) return;
      const role = me && me.role ? me.role : 'player';
      const n =
        role === 'owner'
          ? me.ownerInboxCount || 0
          : role === 'moderator' || role === 'admin' || role === 'report_advisor'
            ? me.modInboxCount || 0
            : 0;
      const show = role === 'moderator' || role === 'admin' || role === 'owner' || role === 'report_advisor';
      fab.classList.toggle('hidden', !show);
      if (n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    function updateAdminBanFab(me) {
      var fab = document.getElementById('btnAdminBanFab');
      if (!fab) return;
      fab.classList.toggle('hidden', !(me && me.role === 'admin'));
    }

    function hidePromotionNotice() {
      var screen = document.getElementById('screenPromotionNotice');
      if (!screen) return;
      screen.classList.add('hidden');
      screen.classList.remove('flex');
    }

    function showPromotionNoticeIfNeeded(me) {
      var notice = me && me.promotionNotice;
      var msg = notice && notice.message ? String(notice.message) : '';
      if (!msg) {
        hidePromotionNotice();
        return;
      }
      var screen = document.getElementById('screenPromotionNotice');
      var text = document.getElementById('promotionNoticeText');
      if (text) text.textContent = msg;
      if (!screen) return;
      screen.classList.remove('hidden');
      screen.classList.add('flex');
    }

    function updateOwnerRequestBadge(me) {
      var badge = document.getElementById('ownerAdminRequestBadge');
      if (!badge) return;
      var n = me && me.role === 'owner' && me.staffRequestCount != null ? Number(me.staffRequestCount) : 0;
      if (n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    function syncOwnerStrikeTools(me) {
      var fab = document.getElementById('btnOwnerStrikesFab');
      var screen = document.getElementById('screenOwnerStrikes');
      var show = !!(me && me.role === 'owner');
      if (fab) {
        fab.classList.toggle('hidden', !show);
        if (show) fab.style.display = 'flex';
      }
      if (!show && screen) {
        screen.classList.add('hidden');
        screen.classList.remove('flex');
      }
    }
    window.SkyHopSyncOwnerStrikeTools = function () {
      syncOwnerStrikeTools(window.__skyhopLastMe || null);
    };

    function formatStrikeLookup(data) {
      var n = data && data.strikes != null ? Number(data.strikes) : 0;
      return (
        String((data && data.username) || '') +
        ' · ' +
        String((data && (data.roleLabel || data.role)) || 'player') +
        ' · ' +
        String(n) +
        (n === 1 ? ' strike' : ' strikes')
      );
    }

    function updateFriendsFab(me) {
      const fab = document.getElementById('btnFriendsFab');
      const badge = document.getElementById('friendsFabBadge');
      if (!fab) return;
      fab.classList.remove('hidden');
      fab.style.display = 'flex';
      if (!badge) return;
      const tok = getToken();
      if (!tok) {
        badge.classList.add('hidden');
        return;
      }
      const n = me && me.friendIncomingCount != null ? Number(me.friendIncomingCount) : 0;
      if (n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    var lastBanAppealCreds = null;

    function showBanScreen(sh, creds) {
      lastBanAppealCreds = creds || null;
      const el = document.getElementById('screenBan');
      const appealBlock = document.getElementById('banAppealBlock');
      const appealMsg = document.getElementById('banAppealMsg');
      if (appealMsg) {
        appealMsg.textContent = '';
        appealMsg.classList.add('hidden');
      }
      if (appealBlock) {
        appealBlock.classList.toggle('hidden', !lastBanAppealCreds);
      }
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
      lastBanAppealCreds = null;
    }

    var btnBanAppealSubmit = document.getElementById('btnBanAppealSubmit');
    if (btnBanAppealSubmit) {
      btnBanAppealSubmit.addEventListener('click', async function () {
        var msgEl = document.getElementById('banAppealMsg');
        var reasonEl = document.getElementById('banAppealReason');
        if (!lastBanAppealCreds) {
          if (msgEl) {
            msgEl.textContent = 'Sign in with the banned account first (failed login).';
            msgEl.classList.remove('hidden');
            msgEl.classList.add('text-rose-300');
          }
          return;
        }
        var reason = reasonEl ? String(reasonEl.value || '').trim() : '';
        try {
          await api('/api/ban-appeal/submit', {
            method: 'POST',
            body: JSON.stringify({
              username: lastBanAppealCreds.username,
              password: lastBanAppealCreds.password,
              reason: reason,
            }),
          });
          if (msgEl) {
            msgEl.textContent = 'Appeal submitted. Moderators and the owner will vote.';
            msgEl.classList.remove('hidden', 'text-rose-300');
            msgEl.classList.add('text-emerald-200');
          }
        } catch (e) {
          if (msgEl) {
            msgEl.textContent = String(e.message || e);
            msgEl.classList.remove('hidden');
            msgEl.classList.add('text-rose-300');
          }
        }
      });
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
      if (role === 'player') {
        if (kicker) kicker.textContent = 'Reports';
        if (hint) {
          hint.textContent =
            'Submit a report from Account → Report a player. Report Advisors, moderators, the Admin, and the site owner use this inbox to review the queue.';
        }
        var ownerToolsPlayer = document.getElementById('ownerTools');
        if (ownerToolsPlayer) ownerToolsPlayer.classList.add('hidden');
        listEl.innerHTML =
          '<li class="rounded-xl border border-white/10 bg-slate-950/50 py-8 text-center text-sm text-slate-400">The moderation queue is only visible to <strong class="text-slate-300">Report Advisors</strong>, <strong class="text-slate-300">moderators</strong>, the <strong class="text-slate-300">Admin</strong>, and the <strong class="text-slate-300">site owner</strong>. Open <strong class="text-slate-300">Account</strong> in the menu to file a report.</li>';
        return;
      }
      if (role === 'owner') void refreshOwnerModList();
      else {
        var ownerToolsAdvisor = document.getElementById('ownerTools');
        if (ownerToolsAdvisor) ownerToolsAdvisor.classList.add('hidden');
      }
      if (kicker) {
        kicker.textContent =
          role === 'owner' ? 'Owner queue' : role === 'report_advisor' ? 'Report Advisor queue' : 'Moderator queue';
      }
      if (hint) {
        hint.textContent =
          role === 'owner'
            ? 'Escalated reports. Ban the reported user or dismiss without action.'
            : role === 'report_advisor'
              ? 'New reports. Dismiss if invalid, or escalate to the site owner. You cannot ban, vote on appeals, or open the moderator dashboard.'
              : 'New reports. Reject if invalid, or escalate to the site owner.';
      }
      try {
        const data = await api('/api/mod/reports', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        const reports = data.reports || [];
        const appeals = role === 'report_advisor' ? [] : data.appeals || [];
        if (!reports.length && !appeals.length) {
          listEl.innerHTML =
            '<li class="rounded-xl border border-white/10 bg-slate-950/50 py-8 text-center text-sm text-slate-500">No items.</li>';
          return;
        }
        var appealHtml = appeals
          .map(function (a) {
            var safe = function (s) {
              return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/"/g, '&quot;');
            };
            var votes = a.votes || {};
            return (
              '<li class="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-left text-sm">' +
              '<p class="text-[11px] font-sem uppercase tracking-wide text-amber-300/90">Ban appeal</p>' +
              '<p class="mt-1 text-slate-200"><strong>' +
              safe(a.username) +
              '</strong> <span class="text-slate-500">(user #' +
              String(a.userId) +
              ')</span></p>' +
              '<p class="mt-2 whitespace-pre-wrap text-xs text-slate-300">' +
              safe(a.reason) +
              '</p>' +
              '<p class="mt-2 text-[11px] text-slate-500">Votes — unban: ' +
              String(votes.unban || 0) +
              ' · keep ban: ' +
              String(votes.keep_ban || 0) +
              '</p>' +
              '<div class="mt-2 flex flex-wrap gap-2">' +
              '<button type="button" data-appeal-vote="unban" data-appeal-id="' +
              safe(a.id) +
              '" class="rounded-lg bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600">Vote unban</button>' +
              '<button type="button" data-appeal-vote="keep_ban" data-appeal-id="' +
              safe(a.id) +
              '" class="rounded-lg bg-rose-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-600">Vote keep ban</button>' +
              '</div></li>'
            );
          })
          .join('');
        listEl.innerHTML =
          appealHtml +
          reports
          .map(function (r) {
            var safe = function (s) {
              return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/"/g, '&quot;');
            };
            var actions = '';
            if (data.scope === 'pending') {
              var dismissLabel = role === 'report_advisor' ? 'Dismiss' : 'Reject';
              actions =
                '<div class="mt-2 flex flex-wrap gap-2">' +
                '<button type="button" data-act="rej" data-id="' +
                safe(r.id) +
                '" class="rounded-lg border border-rose-500/50 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-950/40">' +
                dismissLabel +
                '</button>' +
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
                '<option value="1w">1 week</option><option value="2w">2 weeks</option><option value="1m">1 month</option><option value="perm">Permanent</option><option value="custom">Custom…</option></select>' +
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

        listEl.querySelectorAll('button[data-appeal-vote]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var vote = btn.getAttribute('data-appeal-vote');
            var aid = btn.getAttribute('data-appeal-id');
            try {
              var res = await api('/api/mod/appeals/' + encodeURIComponent(aid) + '/vote', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
                body: JSON.stringify({ vote: vote }),
              });
              if (res.resolved === 'lifted') {
                setModErr('Appeal resolved: user unbanned.', false);
              } else if (res.resolved === 'upheld') {
                setModErr('Appeal resolved: ban upheld.', false);
              }
              await refreshPanel();
              await loadModInboxList();
            } catch (err) {
              setModErr(String(err.message || err));
            }
          });
        });

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
                var banPayload = {
                  userId: Number(userId),
                  duration: dur,
                  reportId: id,
                  reason: banReason,
                  note: note || undefined,
                };
                if (dur === 'custom') {
                  delete banPayload.duration;
                  banPayload.customDuration = {
                    weeks: parseInt(window.prompt('Weeks', '0') || '0', 10) || 0,
                    days: parseInt(window.prompt('Days', '0') || '0', 10) || 0,
                    hours: parseInt(window.prompt('Hours', '0') || '0', 10) || 0,
                    minutes: parseInt(window.prompt('Minutes', '0') || '0', 10) || 0,
                    seconds: parseInt(window.prompt('Seconds', '0') || '0', 10) || 0,
                  };
                }
                await api('/api/owner/ban', {
                  method: 'POST',
                  headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
                  body: JSON.stringify(banPayload),
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

    async function renderCoinShop(me) {
      const ul = document.getElementById('accCoinShopList');
      const shopMsg = document.getElementById('accCoinShopMsg');
      if (!ul) return;
      ul.innerHTML = '';
      if (shopMsg) {
        shopMsg.textContent = '';
        shopMsg.classList.add('hidden');
        shopMsg.classList.remove('text-rose-300', 'text-emerald-200');
      }
      try {
        const data = await api('/api/shop/items');
        const items = data.items || [];
        const unlocked = new Set((me && me.unlockedTextures) || []);
        const tok = getToken();
        if (!items.length) {
          ul.innerHTML =
            '<li class="text-xs text-slate-500">No items — add PNG/WebP skins under <span class="font-mono">textures/</span> and list them in <span class="font-mono">server/shop-catalog.js</span>.</li>';
          return;
        }
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const owned = unlocked.has(it.texture);
          const li = document.createElement('li');
          li.className =
            'flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-2 py-2';
          const priceLabel = infinite ? '—' : String(it.price);
          const left = document.createElement('span');
          left.className = 'text-slate-200';
          left.textContent = it.label || it.texture;
          const price = document.createElement('span');
          price.className = 'font-mono text-amber-200/90';
          price.textContent = priceLabel + ' coins';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className =
            'rounded-lg px-2 py-1 text-xs font-semibold ' +
            (owned ? 'cursor-default border border-white/10 text-slate-500' : 'bg-amber-600 text-white hover:bg-amber-500');
          btn.textContent = owned ? 'Owned' : 'Buy';
          btn.disabled = owned;
          if (!owned && tok) {
            btn.addEventListener('click', async function () {
              if (shopMsg) shopMsg.classList.add('hidden');
              try {
                const out = await api('/api/shop/buy', {
                  method: 'POST',
                  headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ itemId: it.id }),
                });
                if (window.__skyhopLastMe) {
                  window.__skyhopLastMe.unlockedTextures = out.unlockedTextures;
                  window.__skyhopLastMe.coins = out.coins;
                  window.__skyhopLastMe.coinsInfinite = out.coinsInfinite;
                }
                const elc = document.getElementById('accStatCoins');
                if (elc && window.__skyhopLastMe) {
                  elc.textContent = window.__skyhopLastMe.coinsInfinite
                    ? '∞'
                    : String(window.__skyhopLastMe.coins);
                }
                await refreshSkinUi(window.__skyhopLastMe);
                await renderCoinShop(window.__skyhopLastMe);
                if (shopMsg) {
                  shopMsg.textContent = 'Purchased ' + (it.label || it.texture) + '.';
                  shopMsg.classList.remove('hidden');
                  shopMsg.classList.add('text-emerald-200');
                }
              } catch (e) {
                if (shopMsg) {
                  shopMsg.textContent = String(e.message || e);
                  shopMsg.classList.remove('hidden');
                  shopMsg.classList.add('text-rose-300');
                }
              }
            });
          }
          const row = document.createElement('div');
          row.className = 'flex min-w-0 flex-1 flex-wrap items-center gap-2';
          row.appendChild(left);
          row.appendChild(price);
          li.appendChild(row);
          li.appendChild(btn);
          ul.appendChild(li);
        }
      } catch {
        ul.innerHTML = '<li class="text-xs text-rose-300">Could not load shop.</li>';
      }
    }

    function setFriendsErr(t, ok) {
      const x = document.getElementById('friendsPanelErr');
      if (!x) return;
      x.textContent = t || '';
      x.classList.toggle('hidden', !t);
      x.classList.toggle('text-rose-300', !!t && !ok);
      x.classList.toggle('text-emerald-200', !!t && !!ok);
    }

    function renderFriendsBundle(bundle) {
      const inc = document.getElementById('friendsIncomingList');
      const out = document.getElementById('friendsOutgoingList');
      const fr = document.getElementById('friendsListEl');
      if (fr) {
        var friends = bundle.friends || [];
        fr.innerHTML = friends.length
          ? friends
              .map(function (f) {
                return '<li class="rounded bg-slate-900/40 px-2 py-0.5">' + escapeHtml(f.username) + '</li>';
              })
              .join('')
          : '<li class="text-xs text-slate-500">No friends yet.</li>';
      }
      if (out) {
        var og = bundle.outgoing || [];
        out.innerHTML = og.length
          ? og
              .map(function (r) {
                return '<li class="text-slate-400">Pending → ' + escapeHtml(r.toUsername) + '</li>';
              })
              .join('')
          : '<li class="text-slate-600">None.</li>';
      }
      if (inc) {
        var incoming = bundle.incoming || [];
        inc.innerHTML = incoming.length
          ? incoming
              .map(function (r) {
                return (
                  '<li class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-900/60 px-2 py-2">' +
                  '<span class="text-slate-200">' +
                  escapeHtml(r.fromUsername) +
                  '</span>' +
                  '<span class="flex gap-1">' +
                  '<button type="button" data-fr-accept="' +
                  escapeHtml(r.id) +
                  '" class="rounded bg-teal-600 px-2 py-0.5 text-[11px] text-white hover:bg-teal-500">Accept</button>' +
                  '<button type="button" data-fr-decline="' +
                  escapeHtml(r.id) +
                  '" class="rounded border border-white/20 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10">Decline</button>' +
                  '</span></li>'
                );
              })
              .join('')
          : '<li class="text-xs text-slate-500">None.</li>';
      }
    }

    async function loadFriendsPanel() {
      const tok = getToken();
      if (!tok) {
        setFriendsErr('Log in from Account to use friends, chat, and gifts.', true);
        return;
      }
      setFriendsErr('', false);
      try {
        const bundle = await api('/api/friends', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        renderFriendsBundle(bundle);
      } catch (e) {
        setFriendsErr(String(e.message || e), false);
      }
    }

    function clearGuestLoginFields() {
      if (inpLoginPass) inpLoginPass.value = '';
      if (inpRegPass) inpRegPass.value = '';
    }

    async function refreshPanel() {
      const refreshSeq = authRefreshSeq;
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
        updateFriendsFab(null);
        updateModDashboardFab(null);
        updateAdminBanFab(null);
        updateOwnerRequestBadge(null);
        hidePromotionNotice();
        syncOwnerStrikeTools(null);
        var btnOwnerOut = document.getElementById('btnOpenOwnerPage');
        if (btnOwnerOut) btnOwnerOut.classList.add('hidden');
        window.__skyhopLastMe = null;
        try {
          window.dispatchEvent(new CustomEvent('skyhop-auth-changed'));
        } catch {
          /* */
        }
        return;
      }
      try {
        const me = await api('/api/me', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        if (refreshSeq !== authRefreshSeq) return;
        if (getToken() !== tok) return;
        window.__skyhopLastMe = me;
        if (accGuest) accGuest.classList.add('hidden');
        if (accLogged) accLogged.classList.remove('hidden');
        if (accUserLabel) {
          accUserLabel.textContent = me.username || '';
          accUserLabel.className = staffNameClass(me.role);
        }
        try {
          if (me.username) localStorage.setItem(LS_USER, me.username);
        } catch {
          /* */
        }
        renderStats(me.stats);
        renderAchievements(me.achievements);
        void refreshSkinUi(me);
        renderProfileUi(me);
        if (typeof window.SkyHopRefreshCoinShop === 'function') window.SkyHopRefreshCoinShop();
        updateModFab(me);
        updateModDashboardFab(me);
        updateFriendsFab(me);
        updateAdminBanFab(me);
        updateOwnerRequestBadge(me);
        syncOwnerStrikeTools(me);
        const ownerTools = document.getElementById('ownerTools');
        if (ownerTools) ownerTools.classList.toggle('hidden', (me.role || 'player') !== 'owner');
        var btnOpenOwnerPage = document.getElementById('btnOpenOwnerPage');
        if (btnOpenOwnerPage) btnOpenOwnerPage.classList.toggle('hidden', me.role !== 'owner');
        try {
          window.dispatchEvent(new CustomEvent('skyhop-auth-changed'));
        } catch {
          /* */
        }
        try {
          if (typeof window.SkyHopTosGateIfNeeded === 'function') {
            await window.SkyHopTosGateIfNeeded();
          }
        } catch (tosErr) {
          if (String(tosErr && tosErr.message) === 'logged_out') return;
        }
        if (!getToken()) return;
        showPromotionNoticeIfNeeded(me);
      } catch (e) {
        if (refreshSeq !== authRefreshSeq) return;
        if (getToken() !== tok) return;
        setAuth(null, null);
        clearGuestLoginFields();
        if (accLogged) accLogged.classList.add('hidden');
        if (accGuest) accGuest.classList.remove('hidden');
        if (fab) fab.classList.add('hidden');
        updateFriendsFab(null);
        updateModDashboardFab(null);
        updateAdminBanFab(null);
        updateOwnerRequestBadge(null);
        hidePromotionNotice();
        syncOwnerStrikeTools(null);
        window.__skyhopLastMe = null;
        setErr(String(e.message || e));
      }
    }

    function updateProfileBioCount() {
      var bioEl = document.getElementById('accProfileBio');
      var numEl = document.getElementById('accProfileBioCountNum');
      if (!numEl) return;
      numEl.textContent = String(bioEl ? bioEl.value.length : 0);
    }

    function renderProfileUi(me) {
      var bioEl = document.getElementById('accProfileBio');
      var imgEl = document.getElementById('accProfileAvatar');
      var msg = document.getElementById('accProfileMsg');
      if (msg) {
        msg.classList.add('hidden');
        msg.textContent = '';
      }
      if (bioEl && me) bioEl.value = me.profileBio || '';
      updateProfileBioCount();
      if (imgEl) {
        if (me && me.profileAvatarUrl) {
          imgEl.src = me.profileAvatarUrl + (me.profileAvatarUrl.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
          imgEl.classList.remove('hidden');
        } else {
          imgEl.removeAttribute('src');
          imgEl.classList.add('hidden');
        }
      }
    }

    window.refreshSkinUiFromMe = function (me) {
      void refreshSkinUi(me);
    };

    async function refreshSkinUi(me) {
      const sel = document.getElementById('accSkinSelect');
      const msg = document.getElementById('accSkinMsg');
      if (!sel) return;
      sel.innerHTML = '<option value="">Default look</option>';
      var list = [];
      if (me && me.role === 'owner') {
        try {
          const tok = getToken();
          const t = await api('/api/textures', {
            headers: tok ? { Authorization: 'Bearer ' + tok } : {},
          });
          list = t.textures || [];
        } catch {
          list = [];
        }
      } else {
        list = (me && me.unlockedTextures) || [];
      }
      for (var fi = 0; fi < list.length; fi++) {
        var f = list[fi];
        var o = document.createElement('option');
        o.value = f;
        o.textContent = f;
        sel.appendChild(o);
      }
      if (me && me.skinTexture) sel.value = me.skinTexture;
      else sel.value = '';
      if (msg) {
        msg.classList.add('hidden');
        msg.textContent = '';
      }
    }

    function openOwnerBanAnyDialog() {
      var tok = getToken();
      if (!tok) return;
      var un = window.prompt('Username to ban (exact match):');
      if (!un || !String(un).trim()) return;
      var preset = window.prompt('Preset duration: 1w, 2w, 1m, perm, or custom', '1w');
      if (preset == null) return;
      var reason = window.prompt('Ban reason (shown to user):', 'Terms violation') || 'Terms violation';
      var body = { username: String(un).trim(), reason: reason };
      var p = String(preset).trim().toLowerCase();
      if (p === 'custom') {
        body.customDuration = {
          weeks: parseInt(window.prompt('Weeks', '0') || '0', 10) || 0,
          days: parseInt(window.prompt('Days', '0') || '0', 10) || 0,
          hours: parseInt(window.prompt('Hours', '0') || '0', 10) || 0,
          minutes: parseInt(window.prompt('Minutes', '0') || '0', 10) || 0,
          seconds: parseInt(window.prompt('Seconds', '0') || '0', 10) || 0,
        };
      } else {
        body.duration = p;
      }
      api('/api/owner/ban', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok },
        body: JSON.stringify(body),
      })
        .then(function () {
          window.alert('Ban applied.');
        })
        .catch(function (e) {
          window.alert(String(e.message || e));
        });
    }

    if (document.getElementById('btnOwnerBanUser')) {
      document.getElementById('btnOwnerBanUser').addEventListener('click', function () {
        openOwnerBanAnyDialog();
      });
    }

    const accSkinSave = document.getElementById('accSkinSave');
    if (accSkinSave) {
      accSkinSave.addEventListener('click', async function () {
        const tok = getToken();
        const sel = document.getElementById('accSkinSelect');
        const msg = document.getElementById('accSkinMsg');
        if (!tok || !sel) return;
        try {
          const data = await api('/api/me/skin', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok },
            body: JSON.stringify({ skinTexture: sel.value || null }),
          });
          if (window.__skyhopLastMe) window.__skyhopLastMe.skinTexture = data.skinTexture;
          if (msg) {
            msg.textContent = 'Skin saved. Updates in-game after reload or when the canvas refreshes.';
            msg.classList.remove('hidden');
          }
          try {
            window.dispatchEvent(new CustomEvent('skyhop-auth-changed'));
          } catch {
            /* */
          }
        } catch (e) {
          if (msg) {
            msg.textContent = String(e.message || e);
            msg.classList.remove('hidden');
          }
        }
      });
    }

    if (btnOpen) btnOpen.addEventListener('click', function () {
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

    window.SkyHopTosOnLogout = async function () {
      bumpAuthRefresh();
      const tok = getToken();
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
      if (typeof window.SkyHopTosClearSessionAcceptance === 'function') {
        window.SkyHopTosClearSessionAcceptance();
      }
      setAuth(null, null);
      clearGuestLoginFields();
      await refreshPanel();
    };

    if (btnLogin) {
      btnLogin.addEventListener('click', async function () {
        setErr('');
        const loginUser = String((inpLoginUser && inpLoginUser.value) || '').trim();
        const loginPass = inpLoginPass ? inpLoginPass.value : '';
        if (!loginUser || !loginPass) {
          setErr('Enter both username and password.');
          return;
        }
        try {
          const data = await api('/api/login', {
            method: 'POST',
            body: JSON.stringify({
              username: loginUser,
              password: loginPass,
            }),
          });
          bumpAuthRefresh();
          setAuth(data.token, data.username);
          if (inpLoginPass) inpLoginPass.value = '';
          if (typeof window.SkyHopTosClearSessionAcceptance === 'function') {
            window.SkyHopTosClearSessionAcceptance();
          }
          await refreshPanel();
        } catch (e) {
          if (e.skyhop && e.skyhop.banned) {
            showBanScreen(e.skyhop, { username: loginUser, password: loginPass });
            return;
          }
          setErr(String(e.message || e));
        }
      });
    }

    if (btnRegister) {
      btnRegister.addEventListener('click', async function () {
        setErr('');
        const regUser = String((inpRegUser && inpRegUser.value) || '').trim();
        const regPass = inpRegPass ? inpRegPass.value : '';
        if (!regUser || !regPass) {
          setErr('Enter both username and password.');
          return;
        }
        if (regPass.length < 6) {
          setErr('Password must be at least 6 characters.');
          return;
        }
        try {
          const data = await api('/api/register', {
            method: 'POST',
            body: JSON.stringify({
              username: regUser,
              password: regPass,
            }),
          });
          bumpAuthRefresh();
          setAuth(data.token, data.username);
          if (inpRegPass) inpRegPass.value = '';
          if (typeof window.SkyHopTosClearSessionAcceptance === 'function') {
            window.SkyHopTosClearSessionAcceptance();
          }
          await refreshPanel();
        } catch (e) {
          setErr(String(e.message || e));
        }
      });
    }

    if (btnLogout) {
      btnLogout.addEventListener('click', async function () {
        bumpAuthRefresh();
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
        if (typeof window.SkyHopTosClearSessionAcceptance === 'function') {
          window.SkyHopTosClearSessionAcceptance();
        }
        setAuth(null, null);
        clearGuestLoginFields();
        await refreshPanel();
      });
    }

    if (inpLoginUser) {
      inpLoginUser.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') e.preventDefault();
      });
    }
    if (inpLoginPass) {
      inpLoginPass.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && btnLogin) {
          e.preventDefault();
          btnLogin.click();
        }
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

    var btnPromotionNoticeOk = document.getElementById('btnPromotionNoticeOk');
    if (btnPromotionNoticeOk) {
      btnPromotionNoticeOk.addEventListener('click', async function () {
        hidePromotionNotice();
        if (window.__skyhopLastMe) window.__skyhopLastMe.promotionNotice = null;
        var tok = getToken();
        if (!tok) return;
        try {
          await api('/api/me/ack-promotion', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok },
          });
        } catch {
          /* next login will show it again if it did not save */
        }
      });
    }

    var accBtnSaveProfileBio = document.getElementById('accBtnSaveProfileBio');
    var accProfileBio = document.getElementById('accProfileBio');
    var accProfileAvatarFile = document.getElementById('accProfileAvatarFile');
    var accProfileMsg = document.getElementById('accProfileMsg');
    if (accProfileBio) {
      accProfileBio.addEventListener('input', updateProfileBioCount);
      updateProfileBioCount();
    }
    function setProfileMsg(t, isErr) {
      if (!accProfileMsg) return;
      accProfileMsg.textContent = t || '';
      accProfileMsg.classList.toggle('hidden', !t);
      accProfileMsg.classList.toggle('text-rose-300', !!isErr);
      accProfileMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    if (accBtnSaveProfileBio) {
      accBtnSaveProfileBio.addEventListener('click', async function () {
        var tok = getToken();
        if (!tok) return;
        setProfileMsg('', false);
        try {
          var rawBio = (accProfileBio && accProfileBio.value) || '';
          var bioOut = rawBio;
          var bioCensored = false;
          if (typeof window.SkyHopCensorProfanity === 'function') {
            var censBio = window.SkyHopCensorProfanity(rawBio);
            bioOut = censBio.text;
            bioCensored = censBio.flagged;
            if (accProfileBio && bioCensored) accProfileBio.value = bioOut;
            updateProfileBioCount();
          }
          await api('/api/me/profile', {
            method: 'PATCH',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ bio: bioOut }),
          });
          setProfileMsg(bioCensored ? 'Bio saved (some language was censored).' : 'Bio saved.', false);
          if (window.__skyhopLastMe) {
            window.__skyhopLastMe.profileBio = bioOut;
          }
        } catch (e) {
          setProfileMsg(String(e.message || e), true);
        }
      });
    }
    if (accProfileAvatarFile) {
      accProfileAvatarFile.addEventListener('change', async function () {
        var tok = getToken();
        if (!tok || !accProfileAvatarFile.files || !accProfileAvatarFile.files[0]) return;
        setProfileMsg('', false);
        var file = accProfileAvatarFile.files[0];
        if (file.size > 512 * 1024) {
          setProfileMsg('Avatar must be 512 KB or smaller.', true);
          accProfileAvatarFile.value = '';
          return;
        }
        try {
          var b64 = await new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () {
              resolve(String(r.result || ''));
            };
            r.onerror = reject;
            r.readAsDataURL(file);
          });
          var data = await api('/api/me/profile/avatar', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: b64, contentType: file.type }),
          });
          if (window.__skyhopLastMe) {
            window.__skyhopLastMe.profileAvatarUrl = data.profileAvatarUrl;
          }
          renderProfileUi(window.__skyhopLastMe || { profileAvatarUrl: data.profileAvatarUrl });
          setProfileMsg('Avatar updated.', false);
        } catch (e) {
          setProfileMsg(String(e.message || e), true);
        }
        accProfileAvatarFile.value = '';
      });
    }

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
          var reportReason = String((accReportReason && accReportReason.value) || '').trim();
          var reportCensored = false;
          if (typeof window.SkyHopCensorProfanity === 'function') {
            var censRep = window.SkyHopCensorProfanity(reportReason);
            reportReason = censRep.text.trim();
            reportCensored = censRep.flagged;
            if (accReportReason && reportCensored) accReportReason.value = reportReason;
          }
          await api('/api/reports', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reportedUsername: String((accReportUser && accReportUser.value) || '').trim(),
              reason: reportReason,
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

    var ownerGiftUsername = document.getElementById('ownerGiftUsername');
    var ownerGiftAmount = document.getElementById('ownerGiftAmount');
    var ownerBtnGiftCoins = document.getElementById('ownerBtnGiftCoins');
    var ownerGiftMsg = document.getElementById('ownerGiftMsg');
    function setOwnerGiftMsg(t, isErr) {
      if (!ownerGiftMsg) return;
      ownerGiftMsg.textContent = t || '';
      ownerGiftMsg.classList.toggle('hidden', !t);
      ownerGiftMsg.classList.toggle('text-rose-300', !!isErr);
      ownerGiftMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    if (ownerBtnGiftCoins) {
      ownerBtnGiftCoins.addEventListener('click', async function () {
        var tok = getToken();
        if (!tok) return;
        setOwnerGiftMsg('', false);
        var un = (ownerGiftUsername && ownerGiftUsername.value) || '';
        var amt = ownerGiftAmount ? Number(ownerGiftAmount.value) : NaN;
        if (!String(un).trim()) {
          setOwnerGiftMsg('Enter a username.', true);
          return;
        }
        if (!Number.isFinite(amt) || amt < 1 || amt > 1000000 || Math.floor(amt) !== amt) {
          setOwnerGiftMsg('Amount must be a whole number from 1 to 1,000,000.', true);
          return;
        }
        try {
          var data = await api('/api/owner/gift-coins', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: String(un).trim(), amount: Math.floor(amt) }),
          });
          setOwnerGiftMsg(
            'Sent ' + String(Math.floor(amt)) + ' to ' + data.username + '. New balance: ' + String(data.coins) + '.',
            false
          );
        } catch (e) {
          setOwnerGiftMsg(String(e.message || e), true);
        }
      });
    }

    var ownerTakeUsername = document.getElementById('ownerTakeUsername');
    var ownerTakeAmount = document.getElementById('ownerTakeAmount');
    var ownerBtnTakeCoins = document.getElementById('ownerBtnTakeCoins');
    var ownerTakeMsg = document.getElementById('ownerTakeMsg');
    function setOwnerTakeMsg(t, isErr) {
      if (!ownerTakeMsg) return;
      ownerTakeMsg.textContent = t || '';
      ownerTakeMsg.classList.toggle('hidden', !t);
      ownerTakeMsg.classList.toggle('text-rose-300', !!isErr);
      ownerTakeMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    if (ownerBtnTakeCoins) {
      ownerBtnTakeCoins.addEventListener('click', async function () {
        var tok = getToken();
        if (!tok) return;
        setOwnerTakeMsg('', false);
        var un = (ownerTakeUsername && ownerTakeUsername.value) || '';
        var amt = ownerTakeAmount ? Number(ownerTakeAmount.value) : NaN;
        if (!String(un).trim()) {
          setOwnerTakeMsg('Enter a username.', true);
          return;
        }
        if (!Number.isFinite(amt) || amt < 1 || amt > 1000000 || Math.floor(amt) !== amt) {
          setOwnerTakeMsg('Amount must be a whole number from 1 to 1,000,000.', true);
          return;
        }
        try {
          var data = await api('/api/owner/remove-coins', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: String(un).trim(), amount: Math.floor(amt) }),
          });
          setOwnerTakeMsg(
            'Removed ' + String(Math.floor(amt)) + ' from ' + String(un).trim() + '. Balance now: ' + String(data.coins) + '.',
            false
          );
        } catch (e) {
          setOwnerTakeMsg(String(e.message || e), true);
        }
      });
    }

    var ownerGiftTexUser = document.getElementById('ownerGiftTexUser');
    var ownerGiftTexFile = document.getElementById('ownerGiftTexFile');
    var ownerBtnGiftTex = document.getElementById('ownerBtnGiftTex');
    var ownerGiftTexMsg = document.getElementById('ownerGiftTexMsg');
    function setOwnerGiftTexMsg(t, isErr) {
      if (!ownerGiftTexMsg) return;
      ownerGiftTexMsg.textContent = t || '';
      ownerGiftTexMsg.classList.toggle('hidden', !t);
      ownerGiftTexMsg.classList.toggle('text-rose-300', !!isErr);
      ownerGiftTexMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    if (ownerBtnGiftTex) {
      ownerBtnGiftTex.addEventListener('click', async function () {
        var tok = getToken();
        if (!tok) return;
        setOwnerGiftTexMsg('', false);
        var un = (ownerGiftTexUser && ownerGiftTexUser.value) || '';
        var tex = (ownerGiftTexFile && ownerGiftTexFile.value) || '';
        if (!String(un).trim() || !String(tex).trim()) {
          setOwnerGiftTexMsg('Username and texture filename required.', true);
          return;
        }
        try {
          var data = await api('/api/owner/gift-texture', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: String(un).trim(), texture: String(tex).trim() }),
          });
          setOwnerGiftTexMsg(
            (data.wasNew ? 'Granted ' : 'Already had ') + data.texture + ' for ' + data.username + '.',
            false
          );
        } catch (e) {
          setOwnerGiftTexMsg(String(e.message || e), true);
        }
      });
    }

    var screenFriends = document.getElementById('screenFriends');
    var btnFriendsFab = document.getElementById('btnFriendsFab');
    var btnFriendsClose = document.getElementById('btnFriendsClose');
    if (btnFriendsFab && screenFriends) {
      btnFriendsFab.addEventListener('click', function () {
        screenFriends.classList.remove('hidden');
        screenFriends.classList.add('flex');
        void loadFriendsPanel();
      });
    }
    if (btnFriendsClose && screenFriends) {
      btnFriendsClose.addEventListener('click', function () {
        screenFriends.classList.add('hidden');
        screenFriends.classList.remove('flex');
      });
    }
    if (screenFriends && !screenFriends.dataset.skyhopFrDel) {
      screenFriends.dataset.skyhopFrDel = '1';
      screenFriends.addEventListener('click', async function (ev) {
        var t = ev.target;
        if (!t || !t.getAttribute) return;
        var acc = t.getAttribute('data-fr-accept');
        var dec = t.getAttribute('data-fr-decline');
        if (!acc && !dec) return;
        var tok2 = getToken();
        if (!tok2) return;
        setFriendsErr('', false);
        try {
          var pathFr = acc ? '/api/friends/accept' : '/api/friends/decline';
          var data = await api(pathFr, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok2, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: acc || dec }),
          });
          renderFriendsBundle(data);
          if (window.__skyhopLastMe) {
            window.__skyhopLastMe.friendIncomingCount = (data.incoming || []).length;
            updateFriendsFab(window.__skyhopLastMe);
          }
        } catch (e) {
          setFriendsErr(String(e.message || e), false);
        }
      });
    }

    var friendBtnSendReq = document.getElementById('friendBtnSendReq');
    var friendReqUsername = document.getElementById('friendReqUsername');
    if (friendBtnSendReq) {
      friendBtnSendReq.addEventListener('click', async function () {
        var tok = getToken();
        if (!tok) return;
        setFriendsErr('', false);
        var un = (friendReqUsername && friendReqUsername.value) || '';
        if (!String(un).trim()) {
          setFriendsErr('Enter a username.', false);
          return;
        }
        try {
          await api('/api/friends/request', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: String(un).trim() }),
          });
          if (friendReqUsername) friendReqUsername.value = '';
          await loadFriendsPanel();
        } catch (e) {
          setFriendsErr(String(e.message || e), false);
        }
      });
    }

    var friendBtnGiftCoins = document.getElementById('friendBtnGiftCoins');
    var friendGiftUser = document.getElementById('friendGiftUser');
    var friendGiftAmt = document.getElementById('friendGiftAmt');
    var screenOwnerAdmin = document.getElementById('screenOwnerAdmin');
    var btnOwnerAdminClose = document.getElementById('btnOwnerAdminClose');
    var ownerAdminUsername = document.getElementById('ownerAdminUsername');
    var ownerAdminMsg = document.getElementById('ownerAdminMsg');
    function setOwnerAdminMsg(t, isErr) {
      if (!ownerAdminMsg) return;
      ownerAdminMsg.textContent = t || '';
      ownerAdminMsg.classList.toggle('hidden', !t);
      ownerAdminMsg.classList.toggle('text-rose-300', !!isErr);
      ownerAdminMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    function ownerTargetUsername() {
      return String((ownerAdminUsername && ownerAdminUsername.value) || '').trim();
    }
    var btnOpenOwnerPageEl = document.getElementById('btnOpenOwnerPage');
    if (btnOpenOwnerPageEl && screenOwnerAdmin) {
      btnOpenOwnerPageEl.addEventListener('click', function () {
        var me = window.__skyhopLastMe;
        if (!me || me.role !== 'owner') return;
        setOwnerAdminMsg('', false);
        screenOwnerAdmin.classList.remove('hidden');
        screenOwnerAdmin.classList.add('flex');
        void refreshOwnerLbList();
        void loadOwnerSiteContentEditors();
        void refreshOwnerAppealsList();
        void refreshOwnerAdminRole();
        void refreshOwnerStaffRequests();
        void refreshOwnerAdvisors();
      });
    }

    var ownerAdminCurrentLabel = document.getElementById('ownerAdminCurrentLabel');
    var ownerAdminRoleUsername = document.getElementById('ownerAdminRoleUsername');
    var ownerAdminRoleMsg = document.getElementById('ownerAdminRoleMsg');
    function setOwnerAdminRoleMsg(t, isErr) {
      if (!ownerAdminRoleMsg) return;
      ownerAdminRoleMsg.textContent = t || '';
      ownerAdminRoleMsg.classList.toggle('hidden', !t);
      ownerAdminRoleMsg.classList.toggle('text-rose-300', !!isErr);
      ownerAdminRoleMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    async function refreshOwnerAdminRole() {
      var tok = getToken();
      var me = window.__skyhopLastMe;
      if (!tok || !me || me.role !== 'owner') return;
      try {
        var data = await api('/api/owner/admin', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        var name = data.admin && data.admin.username ? data.admin.username : 'none';
        if (ownerAdminCurrentLabel) ownerAdminCurrentLabel.textContent = name;
      } catch (e) {
        if (ownerAdminCurrentLabel) ownerAdminCurrentLabel.textContent = '—';
        setOwnerAdminRoleMsg(String(e.message || e), true);
      }
    }
    async function ownerSetAdmin(promote) {
      var tok = getToken();
      var me = window.__skyhopLastMe;
      if (!tok || !me || me.role !== 'owner') return;
      var un = ownerAdminRoleUsername ? String(ownerAdminRoleUsername.value || '').trim() : '';
      if (!un) {
        setOwnerAdminRoleMsg('Username required.', true);
        return;
      }
      setOwnerAdminRoleMsg('', false);
      try {
        var data = await api('/api/owner/set-admin', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: un, promote: !!promote }),
        });
        var msg = promote
          ? 'Admin set to ' + (data.username || un) + '.'
          : 'Admin removed from ' + (data.username || un) + '.';
        if (data.previousAdmin) msg += ' Previous Admin ' + data.previousAdmin + ' is now a player.';
        setOwnerAdminRoleMsg(msg, false);
        await refreshOwnerAdminRole();
      } catch (e) {
        setOwnerAdminRoleMsg(String(e.message || e), true);
      }
    }
    var ownerBtnAdminOn = document.getElementById('ownerBtnAdminOn');
    var ownerBtnAdminOff = document.getElementById('ownerBtnAdminOff');
    if (ownerBtnAdminOn) {
      ownerBtnAdminOn.addEventListener('click', function () {
        void ownerSetAdmin(true);
      });
    }
    if (ownerBtnAdminOff) {
      ownerBtnAdminOff.addEventListener('click', function () {
        void ownerSetAdmin(false);
      });
    }

    var ownerAdvisorList = document.getElementById('ownerAdvisorList');
    var ownerAdvisorUsername = document.getElementById('ownerAdvisorUsername');
    var ownerAdvisorMsg = document.getElementById('ownerAdvisorMsg');
    function setOwnerAdvisorMsg(t, isErr) {
      if (!ownerAdvisorMsg) return;
      ownerAdvisorMsg.textContent = t || '';
      ownerAdvisorMsg.classList.toggle('hidden', !t);
      ownerAdvisorMsg.classList.toggle('text-rose-300', !!isErr);
      ownerAdvisorMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    async function refreshOwnerAdvisors() {
      var tok = getToken();
      var me = window.__skyhopLastMe;
      if (!tok || !me || me.role !== 'owner' || !ownerAdvisorList) return;
      try {
        var data = await api('/api/owner/report-advisors', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        var rows = data.advisors || [];
        if (!rows.length) {
          ownerAdvisorList.innerHTML = '<li class="list-none text-slate-500">none</li>';
        } else {
          ownerAdvisorList.innerHTML = rows
            .map(function (a) {
              return '<li>' + String(a.username || '').replace(/</g, '&lt;') + '</li>';
            })
            .join('');
        }
      } catch (e) {
        ownerAdvisorList.innerHTML = '<li class="list-none text-slate-500">Could not load</li>';
        setOwnerAdvisorMsg(String(e.message || e), true);
      }
    }
    async function ownerSetAdvisor(promote) {
      var tok = getToken();
      var me = window.__skyhopLastMe;
      if (!tok || !me || me.role !== 'owner') return;
      var un = ownerAdvisorUsername ? String(ownerAdvisorUsername.value || '').trim() : '';
      if (!un) {
        setOwnerAdvisorMsg('Username required.', true);
        return;
      }
      setOwnerAdvisorMsg('', false);
      try {
        var data = await api('/api/owner/set-report-advisor', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: un, promote: !!promote }),
        });
        setOwnerAdvisorMsg(
          promote
            ? (data.username || un) + ' is now a Report Advisor.'
            : 'Report Advisor removed from ' + (data.username || un) + '.',
          false
        );
        await refreshOwnerAdvisors();
      } catch (e) {
        setOwnerAdvisorMsg(String(e.message || e), true);
      }
    }
    var ownerBtnAdvisorOn = document.getElementById('ownerBtnAdvisorOn');
    var ownerBtnAdvisorOff = document.getElementById('ownerBtnAdvisorOff');
    if (ownerBtnAdvisorOn) {
      ownerBtnAdvisorOn.addEventListener('click', function () {
        void ownerSetAdvisor(true);
      });
    }
    if (ownerBtnAdvisorOff) {
      ownerBtnAdvisorOff.addEventListener('click', function () {
        void ownerSetAdvisor(false);
      });
    }

    var ownerStaffRequestList = document.getElementById('ownerStaffRequestList');
    var ownerStaffRequestMsg = document.getElementById('ownerStaffRequestMsg');
    function setOwnerStaffRequestMsg(t, isErr) {
      if (!ownerStaffRequestMsg) return;
      ownerStaffRequestMsg.textContent = t || '';
      ownerStaffRequestMsg.classList.toggle('hidden', !t);
      ownerStaffRequestMsg.classList.toggle('text-rose-300', !!isErr);
      ownerStaffRequestMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    function escapeStaff(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
    }
    async function refreshOwnerStaffRequests() {
      var tok = getToken();
      var me = window.__skyhopLastMe;
      if (!tok || !me || me.role !== 'owner' || !ownerStaffRequestList) return;
      setOwnerStaffRequestMsg('', false);
      try {
        var data = await api('/api/owner/staff-requests', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        var rows = data.requests || [];
        if (!rows.length) {
          ownerStaffRequestList.innerHTML =
            '<li class="list-none rounded-xl border border-white/10 bg-slate-950/50 py-3 text-center text-slate-500">No open requests.</li>';
          return;
        }
        ownerStaffRequestList.innerHTML = rows
          .map(function (r) {
            var kind = r.type === 'demote_moderator' ? 'Demote moderator' : 'Longer ban';
            var extra = '';
            if (r.type === 'longer_ban' && r.payload && r.payload.duration) {
              extra = ' · duration ' + escapeStaff(r.payload.duration);
            }
            var reason = r.payload && r.payload.reason ? r.payload.reason : '';
            return (
              '<li class="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-3 text-left">' +
              '<p class="font-sem text-emerald-200">' +
              escapeStaff(kind) +
              '</p>' +
              '<p class="mt-1 text-slate-300">From <strong>' +
              escapeStaff(r.fromUsername) +
              '</strong> → <strong>' +
              escapeStaff(r.targetUsername) +
              '</strong>' +
              extra +
              '</p>' +
              '<p class="mt-1 whitespace-pre-wrap text-slate-400">' +
              escapeStaff(reason) +
              '</p>' +
              '<div class="mt-2 flex flex-wrap gap-2">' +
              '<button type="button" data-staff-act="accept" data-id="' +
              escapeStaff(r.id) +
              '" class="rounded-lg bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600">Accept</button>' +
              '<button type="button" data-staff-act="decline" data-id="' +
              escapeStaff(r.id) +
              '" class="rounded-lg border border-white/20 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10">Decline</button>' +
              '</div></li>'
            );
          })
          .join('');
        ownerStaffRequestList.querySelectorAll('button[data-staff-act]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var tok2 = getToken();
            if (!tok2) return;
            try {
              await api('/api/owner/staff-requests/' + encodeURIComponent(btn.getAttribute('data-id')) + '/resolve', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + tok2, 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: btn.getAttribute('data-staff-act') }),
              });
              setOwnerStaffRequestMsg('Updated.', false);
              await refreshOwnerStaffRequests();
              await refreshPanel();
            } catch (err) {
              setOwnerStaffRequestMsg(String(err.message || err), true);
            }
          });
        });
      } catch (e) {
        ownerStaffRequestList.innerHTML =
          '<li class="rounded-xl border border-rose-500/30 bg-rose-950/30 py-3 text-center text-rose-200">Could not load requests.</li>';
        setOwnerStaffRequestMsg(String(e.message || e), true);
      }
    }
    var ownerBtnRefreshStaffRequests = document.getElementById('ownerBtnRefreshStaffRequests');
    if (ownerBtnRefreshStaffRequests) {
      ownerBtnRefreshStaffRequests.addEventListener('click', function () {
        void refreshOwnerStaffRequests();
      });
    }

    var screenAdminTools = document.getElementById('screenAdminTools');
    var btnAdminBanFab = document.getElementById('btnAdminBanFab');
    var btnAdminToolsClose = document.getElementById('btnAdminToolsClose');
    var adminToolsMsg = document.getElementById('adminToolsMsg');
    var adminQuotaLabel = document.getElementById('adminQuotaLabel');
    function setAdminToolsMsg(t, isErr) {
      if (!adminToolsMsg) return;
      adminToolsMsg.textContent = t || '';
      adminToolsMsg.classList.toggle('hidden', !t);
      adminToolsMsg.classList.toggle('text-rose-300', !!isErr);
      adminToolsMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    function syncAdminQuotaLabel(me) {
      if (!adminQuotaLabel) return;
      var q = me && me.adminBanQuota;
      if (!q) {
        adminQuotaLabel.textContent = 'One-day bans this week: —';
        return;
      }
      adminQuotaLabel.textContent =
        'One-day bans this week: ' + String(q.used) + ' / ' + String(q.max) + ' used (' + String(q.remaining) + ' left).';
    }
    function openAdminTools() {
      var me = window.__skyhopLastMe;
      if (!me || me.role !== 'admin') return;
      setAdminToolsMsg('', false);
      syncAdminQuotaLabel(me);
      if (screenAdminTools) {
        screenAdminTools.classList.remove('hidden');
        screenAdminTools.classList.add('flex');
      }
    }
    if (btnAdminBanFab) {
      btnAdminBanFab.addEventListener('click', openAdminTools);
    }
    if (btnAdminToolsClose && screenAdminTools) {
      btnAdminToolsClose.addEventListener('click', function () {
        screenAdminTools.classList.add('hidden');
        screenAdminTools.classList.remove('flex');
      });
    }
    var adminBtnStrikeLookup = document.getElementById('adminBtnStrikeLookup');
    if (adminBtnStrikeLookup) {
      adminBtnStrikeLookup.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        var out = document.getElementById('adminStrikeLookupResult');
        var inp = document.getElementById('adminStrikeLookupUser');
        if (!tok || !me || me.role !== 'admin') return;
        if (out) out.textContent = 'Looking up…';
        try {
          var data = await api('/api/strikes?username=' + encodeURIComponent(inp ? inp.value : ''), {
            method: 'GET',
            headers: { Authorization: 'Bearer ' + tok },
          });
          if (out) out.textContent = formatStrikeLookup(data);
        } catch (e) {
          if (out) out.textContent = String(e.message || e);
        }
      });
    }
    var adminBtnOneDayBan = document.getElementById('adminBtnOneDayBan');
    if (adminBtnOneDayBan) {
      adminBtnOneDayBan.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        if (!tok || !me || me.role !== 'admin') return;
        var unEl = document.getElementById('adminBanUsername');
        var reasonEl = document.getElementById('adminBanReason');
        setAdminToolsMsg('', false);
        try {
          var data = await api('/api/admin/ban', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: unEl ? unEl.value : '',
              reason: reasonEl ? reasonEl.value : '',
            }),
          });
          setAdminToolsMsg('1-day ban applied.', false);
          if (data && data.quota && window.__skyhopLastMe) window.__skyhopLastMe.adminBanQuota = data.quota;
          syncAdminQuotaLabel(window.__skyhopLastMe);
        } catch (e) {
          setAdminToolsMsg(String(e.message || e), true);
        }
      });
    }
    var adminBtnRequestLongBan = document.getElementById('adminBtnRequestLongBan');
    if (adminBtnRequestLongBan) {
      adminBtnRequestLongBan.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        if (!tok || !me || me.role !== 'admin') return;
        var unEl = document.getElementById('adminLongBanUser');
        var durEl = document.getElementById('adminLongBanDur');
        var reasonEl = document.getElementById('adminLongBanReason');
        setAdminToolsMsg('', false);
        try {
          await api('/api/admin/requests', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'longer_ban',
              username: unEl ? unEl.value : '',
              duration: durEl ? durEl.value : '1w',
              reason: reasonEl ? reasonEl.value : '',
            }),
          });
          setAdminToolsMsg('Longer-ban request sent to the owner.', false);
        } catch (e) {
          setAdminToolsMsg(String(e.message || e), true);
        }
      });
    }
    var adminBtnPromoteMod = document.getElementById('adminBtnPromoteMod');
    if (adminBtnPromoteMod) {
      adminBtnPromoteMod.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        if (!tok || !me || me.role !== 'admin') return;
        var unEl = document.getElementById('adminModUsername');
        setAdminToolsMsg('', false);
        try {
          await api('/api/owner/set-moderator', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: unEl ? unEl.value : '', promote: true }),
          });
          setAdminToolsMsg('Moderator promoted.', false);
        } catch (e) {
          setAdminToolsMsg(String(e.message || e), true);
        }
      });
    }
    var adminBtnRequestDemote = document.getElementById('adminBtnRequestDemote');
    if (adminBtnRequestDemote) {
      adminBtnRequestDemote.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        if (!tok || !me || me.role !== 'admin') return;
        var unEl = document.getElementById('adminDemoteUser');
        var reasonEl = document.getElementById('adminDemoteReason');
        setAdminToolsMsg('', false);
        try {
          await api('/api/admin/requests', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'demote_moderator',
              username: unEl ? unEl.value : '',
              reason: reasonEl ? reasonEl.value : '',
            }),
          });
          setAdminToolsMsg('Demotion request sent to the owner.', false);
        } catch (e) {
          setAdminToolsMsg(String(e.message || e), true);
        }
      });
    }

    function setOwnerStrikeEditMsg(t, isErr) {
      var el = document.getElementById('ownerStrikeEditMsg');
      if (!el) return;
      el.textContent = t || '';
      el.classList.toggle('hidden', !t);
      el.classList.toggle('text-rose-300', !!isErr);
      el.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    var screenOwnerStrikes = document.getElementById('screenOwnerStrikes');
    var btnOwnerStrikesFab = document.getElementById('btnOwnerStrikesFab');
    var btnOwnerStrikesClose = document.getElementById('btnOwnerStrikesClose');
    function openOwnerStrikes() {
      var me = window.__skyhopLastMe;
      if (!me || me.role !== 'owner' || !screenOwnerStrikes) return;
      setOwnerStrikeEditMsg('', false);
      screenOwnerStrikes.classList.remove('hidden');
      screenOwnerStrikes.classList.add('flex');
    }
    function closeOwnerStrikes() {
      if (!screenOwnerStrikes) return;
      screenOwnerStrikes.classList.add('hidden');
      screenOwnerStrikes.classList.remove('flex');
    }
    if (btnOwnerStrikesFab) {
      btnOwnerStrikesFab.addEventListener('click', openOwnerStrikes);
    }
    if (btnOwnerStrikesClose) {
      btnOwnerStrikesClose.addEventListener('click', closeOwnerStrikes);
    }
    function describeStrikePenalty(penalty) {
      if (!penalty) return '';
      if (penalty.type === 'demote') {
        return ' Demoted from ' + penalty.from + ' to ' + penalty.to + '.';
      }
      if (penalty.type === 'ban') {
        return ' Automatic 1-week ban applied.';
      }
      return '';
    }
    var ownerBtnStrikeLookup = document.getElementById('ownerBtnStrikeLookup');
    if (ownerBtnStrikeLookup) {
      ownerBtnStrikeLookup.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        var out = document.getElementById('ownerStrikeLookupResult');
        var inp = document.getElementById('ownerStrikeLookupUser');
        if (!tok || !me || me.role !== 'owner') return;
        if (out) out.textContent = 'Looking up…';
        try {
          var data = await api('/api/strikes?username=' + encodeURIComponent(inp ? inp.value : ''), {
            method: 'GET',
            headers: { Authorization: 'Bearer ' + tok },
          });
          if (out) out.textContent = formatStrikeLookup(data);
        } catch (e) {
          if (out) out.textContent = String(e.message || e);
        }
      });
    }
    async function ownerStrikeAction(action) {
      var tok = getToken();
      var me = window.__skyhopLastMe;
      if (!tok || !me || me.role !== 'owner') return;
      var inp = document.getElementById('ownerStrikeEditUser');
      var un = inp ? String(inp.value || '').trim() : '';
      if (!un) {
        setOwnerStrikeEditMsg('Username required.', true);
        return;
      }
      setOwnerStrikeEditMsg('', false);
      try {
        var data = await api('/api/owner/strikes', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: un, action: action }),
        });
        var msg =
          (data.username || un) +
          ' now has ' +
          String(data.strikes) +
          (Number(data.strikes) === 1 ? ' strike.' : ' strikes.') +
          describeStrikePenalty(data.penalty);
        setOwnerStrikeEditMsg(msg, false);
        var lookInp = document.getElementById('ownerStrikeLookupUser');
        var lookOut = document.getElementById('ownerStrikeLookupResult');
        if (lookInp) lookInp.value = data.username || un;
        if (lookOut) {
          lookOut.textContent = formatStrikeLookup({
            username: data.username || un,
            roleLabel: data.role,
            strikes: data.strikes,
          });
        }
      } catch (e) {
        setOwnerStrikeEditMsg(String(e.message || e), true);
      }
    }
    var ownerBtnStrikeAdd = document.getElementById('ownerBtnStrikeAdd');
    var ownerBtnStrikeRemove = document.getElementById('ownerBtnStrikeRemove');
    if (ownerBtnStrikeAdd) {
      ownerBtnStrikeAdd.addEventListener('click', function () {
        void ownerStrikeAction('add');
      });
    }
    if (ownerBtnStrikeRemove) {
      ownerBtnStrikeRemove.addEventListener('click', function () {
        void ownerStrikeAction('remove');
      });
    }

    var ownerAppealsList = document.getElementById('ownerAppealsList');
    var ownerAppealsMsg = document.getElementById('ownerAppealsMsg');
    function setOwnerAppealsMsg(t, isErr) {
      if (!ownerAppealsMsg) return;
      ownerAppealsMsg.textContent = t || '';
      ownerAppealsMsg.classList.toggle('hidden', !t);
      ownerAppealsMsg.classList.toggle('text-rose-300', !!isErr);
      ownerAppealsMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    async function refreshOwnerAppealsList() {
      var tok = getToken();
      var me = window.__skyhopLastMe;
      if (!ownerAppealsList || !tok || !me || me.role !== 'owner') return;
      try {
        var data = await api('/api/owner/appeals', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        var appeals = data.appeals || [];
        if (!appeals.length) {
          ownerAppealsList.innerHTML =
            '<li class="rounded-xl border border-white/10 bg-slate-950/50 py-4 text-center text-slate-500">No open appeals.</li>';
          setOwnerAppealsMsg('', false);
          return;
        }
        ownerAppealsList.innerHTML = appeals
          .map(function (a) {
            var safe = function (s) {
              return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/"/g, '&quot;');
            };
            return (
              '<li class="rounded-xl border border-amber-500/25 bg-slate-950/60 p-3 text-left">' +
              '<p class="font-semibold text-slate-100">' +
              safe(a.username) +
              ' <span class="font-normal text-slate-500">#' +
              String(a.userId) +
              '</span></p>' +
              '<p class="mt-1 whitespace-pre-wrap text-[11px] text-slate-400">' +
              safe(a.reason) +
              '</p>' +
              '<div class="mt-2 flex flex-wrap gap-2">' +
              '<button type="button" data-owner-appeal="accept" data-appeal-id="' +
              safe(a.id) +
              '" class="rounded-lg bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600">Accept (unban)</button>' +
              '<button type="button" data-owner-appeal="decline" data-appeal-id="' +
              safe(a.id) +
              '" class="rounded-lg bg-rose-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-600">Decline (keep ban)</button>' +
              '</div></li>'
            );
          })
          .join('');
        ownerAppealsList.querySelectorAll('button[data-owner-appeal]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var decision = btn.getAttribute('data-owner-appeal');
            var aid = btn.getAttribute('data-appeal-id');
            var label = decision === 'accept' ? 'Accept and unban' : 'Decline and keep ban';
            if (!window.confirm(label + ' this appeal?')) return;
            try {
              var res = await api('/api/owner/appeals/' + encodeURIComponent(aid) + '/resolve', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: decision }),
              });
              if (res.resolved === 'lifted') {
                setOwnerAppealsMsg('Appeal accepted — user unbanned.', false);
              } else {
                setOwnerAppealsMsg('Appeal declined — ban upheld.', false);
              }
              await refreshOwnerAppealsList();
              if (typeof loadModInboxList === 'function') void loadModInboxList();
            } catch (err) {
              setOwnerAppealsMsg(String(err.message || err), true);
            }
          });
        });
      } catch (e) {
        ownerAppealsList.innerHTML =
          '<li class="rounded-xl border border-rose-500/30 bg-rose-950/30 py-3 text-center text-rose-200">Could not load appeals.</li>';
        setOwnerAppealsMsg(String(e.message || e), true);
      }
    }
    var ownerBtnRefreshAppeals = document.getElementById('ownerBtnRefreshAppeals');
    if (ownerBtnRefreshAppeals) {
      ownerBtnRefreshAppeals.addEventListener('click', function () {
        void refreshOwnerAppealsList();
      });
    }
    if (btnOwnerAdminClose && screenOwnerAdmin) {
      btnOwnerAdminClose.addEventListener('click', function () {
        screenOwnerAdmin.classList.add('hidden');
        screenOwnerAdmin.classList.remove('flex');
      });
    }
    var ownerBtnDisable = document.getElementById('ownerBtnDisable');
    var ownerBtnEnable = document.getElementById('ownerBtnEnable');
    var ownerBtnDelete = document.getElementById('ownerBtnDelete');
    var ownerBtnResetBuiltinStages = document.getElementById('ownerBtnResetBuiltinStages');
    if (ownerBtnResetBuiltinStages) {
      ownerBtnResetBuiltinStages.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        if (!tok || !me || me.role !== 'owner') return;
        if (
          !window.confirm(
            'Clear the server built-in campaign override for World 1 and World 2?\n\nPlay will use the bundled stage files on this website.'
          )
        ) {
          return;
        }
        try {
          await api('/api/owner/builtin-stages/reset', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: '{}',
          });
          if (typeof window.SkyHopRestoreBundledCampaignFromFiles === 'function') {
            window.SkyHopRestoreBundledCampaignFromFiles();
          }
          setOwnerAdminMsg('Server campaign override cleared. Hard-refresh if Play still looks blank.', false);
        } catch (e) {
          setOwnerAdminMsg(String(e.message || e), true);
        }
      });
    }
    if (ownerBtnDisable) {
      ownerBtnDisable.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        if (!tok || !me || me.role !== 'owner') return;
        setOwnerAdminMsg('', false);
        var un = ownerTargetUsername();
        if (!un) {
          setOwnerAdminMsg('Enter the target username.', true);
          return;
        }
        if (
          !window.confirm(
            'Disable account "' +
              un +
              '"?\n\nThey cannot save or publish levels, join or host races, or use friend chat until re-enabled.'
          )
        ) {
          return;
        }
        try {
          await api('/api/owner/account-disable', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: un, disabled: true }),
          });
          setOwnerAdminMsg('Disabled ' + un + '.', false);
        } catch (e) {
          setOwnerAdminMsg(String(e.message || e), true);
        }
      });
    }
    if (ownerBtnEnable) {
      ownerBtnEnable.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        if (!tok || !me || me.role !== 'owner') return;
        setOwnerAdminMsg('', false);
        var un = ownerTargetUsername();
        if (!un) {
          setOwnerAdminMsg('Enter the target username.', true);
          return;
        }
        if (!window.confirm('Re-enable account "' + un + '"?')) return;
        try {
          await api('/api/owner/account-disable', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: un, disabled: false }),
          });
          setOwnerAdminMsg('Re-enabled ' + un + '.', false);
        } catch (e) {
          setOwnerAdminMsg(String(e.message || e), true);
        }
      });
    }
    if (ownerBtnDelete) {
      ownerBtnDelete.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        if (!tok || !me || me.role !== 'owner') return;
        setOwnerAdminMsg('', false);
        var un = ownerTargetUsername();
        if (!un) {
          setOwnerAdminMsg('Enter the target username.', true);
          return;
        }
        if (
          !window.confirm(
            'PERMANENTLY delete "' +
              un +
              '"?\n\nThis removes all stats and their levels. There is no restore.\n\nIf you click OK, a confirmation email is sent. You must open the link within 60 seconds.'
          )
        ) {
          return;
        }
        if (
          !window.confirm(
            'Last chance: delete "' + un + '" forever?\n\nClick OK to send the email confirmation.'
          )
        ) {
          return;
        }
        try {
          var data = await api('/api/owner/account-delete/request', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: un }),
          });
          setOwnerAdminMsg(data.message || 'Confirmation email sent.', false);
        } catch (e) {
          setOwnerAdminMsg(String(e.message || e), true);
        }
      });
    }

    var ownerLbDifficulty = document.getElementById('ownerLbDifficulty');
    var ownerBtnRefreshLb = document.getElementById('ownerBtnRefreshLb');
    var ownerLbList = document.getElementById('ownerLbList');
    var ownerLbMsg = document.getElementById('ownerLbMsg');
    function setOwnerLbMsg(t, isErr) {
      if (!ownerLbMsg) return;
      ownerLbMsg.textContent = t || '';
      ownerLbMsg.classList.toggle('hidden', !t);
      ownerLbMsg.classList.toggle('text-rose-300', !!isErr);
      ownerLbMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    function fmtLbTime(ms) {
      if (!Number.isFinite(ms)) return '—';
      var s = Math.floor(ms / 1000);
      var m = Math.floor(s / 60);
      s = s % 60;
      return m + ':' + String(s).padStart(2, '0');
    }
    async function refreshOwnerLbList() {
      var tok = getToken();
      var me = window.__skyhopLastMe;
      if (!tok || !me || me.role !== 'owner' || !ownerLbList) return;
      setOwnerLbMsg('', false);
      ownerLbList.innerHTML = '<li class="text-slate-500">Loading…</li>';
      var diff = ownerLbDifficulty ? ownerLbDifficulty.value : 'normal';
      try {
        var data = await api('/api/owner/leaderboard/campaign?difficulty=' + encodeURIComponent(diff), {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        var entries = (data && data.entries) || [];
        ownerLbList.innerHTML = '';
        if (!entries.length) {
          ownerLbList.innerHTML = '<li class="text-slate-500">No entries.</li>';
          return;
        }
        for (var i = 0; i < entries.length; i++) {
          (function (row, rank) {
            var li = document.createElement('li');
            li.className =
              'flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/50 px-2 py-1.5';
            li.innerHTML =
              '<span class="text-slate-200">' +
              String(rank) +
              '. ' +
              String(row.username || '').replace(/</g, '&lt;') +
              ' · ' +
              fmtLbTime(row.timeMs) +
              ' · ' +
              String(row.deaths) +
              'd</span>';
            var del = document.createElement('button');
            del.type = 'button';
            del.className =
              'rounded border border-rose-500/50 px-2 py-0.5 text-[10px] font-semibold text-rose-100 hover:bg-rose-950/50';
            del.textContent = 'Remove';
            del.addEventListener('click', async function () {
              if (!window.confirm('Remove this leaderboard entry for ' + row.username + '?')) return;
              try {
                await api('/api/owner/leaderboard/delete', {
                  method: 'POST',
                  headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ runId: row.runId }),
                });
                setOwnerLbMsg('Removed entry.', false);
                await refreshOwnerLbList();
              } catch (e) {
                setOwnerLbMsg(String(e.message || e), true);
              }
            });
            li.appendChild(del);
            ownerLbList.appendChild(li);
          })(entries[i], i + 1);
        }
      } catch (e) {
        ownerLbList.innerHTML = '';
        setOwnerLbMsg(String(e.message || e), true);
      }
    }
    if (ownerBtnRefreshLb) {
      ownerBtnRefreshLb.addEventListener('click', function () {
        void refreshOwnerLbList();
      });
    }
    if (ownerLbDifficulty) {
      ownerLbDifficulty.addEventListener('change', function () {
        void refreshOwnerLbList();
      });
    }

    function ownerLbTimeMsFromInputs(minEl, secEl) {
      var m = minEl ? Math.max(0, Math.floor(Number(minEl.value) || 0)) : 0;
      var s = secEl ? Math.max(0, Math.min(59, Math.floor(Number(secEl.value) || 0))) : 0;
      return (m * 60 + s) * 1000;
    }

    var ownerSiteContentMsg = document.getElementById('ownerSiteContentMsg');
    var ownerTosEditor = document.getElementById('ownerTosEditor');
    var ownerFeatureListEditor = document.getElementById('ownerFeatureListEditor');
    var ownerBrandTitle = document.getElementById('ownerBrandTitle');
    var ownerBrandVersion = document.getElementById('ownerBrandVersion');
    var ownerBrandUpdate = document.getElementById('ownerBrandUpdate');
    var ownerBrandingMsg = document.getElementById('ownerBrandingMsg');
    function setOwnerSiteContentMsg(t, isErr) {
      if (!ownerSiteContentMsg) return;
      ownerSiteContentMsg.textContent = t || '';
      ownerSiteContentMsg.classList.toggle('hidden', !t);
      ownerSiteContentMsg.classList.toggle('text-rose-300', !!isErr);
      ownerSiteContentMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    function setOwnerBrandingMsg(t, isErr) {
      if (!ownerBrandingMsg) return;
      ownerBrandingMsg.textContent = t || '';
      ownerBrandingMsg.classList.toggle('hidden', !t);
      ownerBrandingMsg.classList.toggle('text-rose-300', !!isErr);
      ownerBrandingMsg.classList.toggle('text-emerald-200', !isErr && !!t);
    }
    function fillOwnerBrandingFields(b) {
      if (!b || typeof b !== 'object') return;
      if (ownerBrandTitle && b.title != null) ownerBrandTitle.value = String(b.title);
      if (ownerBrandVersion && b.version != null) ownerBrandVersion.value = String(b.version);
      if (ownerBrandUpdate && b.updateName != null) ownerBrandUpdate.value = String(b.updateName);
    }
    async function loadOwnerSiteContentEditors() {
      var tok = getToken();
      var me = window.__skyhopLastMe;
      if (!tok || !me || me.role !== 'owner') return;
      setOwnerSiteContentMsg('', false);
      setOwnerBrandingMsg('', false);
      try {
        var data = await api('/api/owner/site-content', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tok },
        });
        if (ownerTosEditor) {
          ownerTosEditor.value =
            data.tosEditorText != null ? String(data.tosEditorText) : joinOwnerTosFallback(data.tosPages);
        }
        if (ownerFeatureListEditor && data.featureListHtml != null) {
          ownerFeatureListEditor.value = String(data.featureListHtml);
        }
        if (data.branding) fillOwnerBrandingFields(data.branding);
      } catch (e) {
        setOwnerSiteContentMsg(String(e.message || e), true);
      }
    }
    function joinOwnerTosFallback(pages) {
      if (!pages || !pages.length) return '';
      return pages.join('\n<<<SKYHOP_TOS_PAGE>>>\n');
    }
    var ownerBtnLoadSiteContent = document.getElementById('ownerBtnLoadSiteContent');
    if (ownerBtnLoadSiteContent) {
      ownerBtnLoadSiteContent.addEventListener('click', function () {
        void loadOwnerSiteContentEditors();
      });
    }
    var ownerBtnSaveSiteContent = document.getElementById('ownerBtnSaveSiteContent');
    if (ownerBtnSaveSiteContent) {
      ownerBtnSaveSiteContent.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        if (!tok || !me || me.role !== 'owner') return;
        setOwnerSiteContentMsg('', false);
        try {
          await api('/api/owner/site-content', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tosEditorText: ownerTosEditor ? ownerTosEditor.value : '',
              featureListHtml: ownerFeatureListEditor ? ownerFeatureListEditor.value : '',
            }),
          });
          setOwnerSiteContentMsg('Saved. New ToS applies on next login gate; feature list updates live.', false);
          if (typeof window.SkyHopTosPrefetch === 'function') void window.SkyHopTosPrefetch();
          if (typeof window.SkyHopRefreshFeatureListContent === 'function') {
            void window.SkyHopRefreshFeatureListContent();
          }
        } catch (e) {
          setOwnerSiteContentMsg(String(e.message || e), true);
        }
      });
    }

    var ownerBtnSaveBranding = document.getElementById('ownerBtnSaveBranding');
    if (ownerBtnSaveBranding) {
      ownerBtnSaveBranding.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        if (!tok || !me || me.role !== 'owner') return;
        setOwnerBrandingMsg('', false);
        try {
          var data = await api('/api/owner/site-content', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              branding: {
                title: ownerBrandTitle ? ownerBrandTitle.value : '',
                version: ownerBrandVersion ? ownerBrandVersion.value : '',
                updateName: ownerBrandUpdate ? ownerBrandUpdate.value : '',
              },
            }),
          });
          var saved = data && data.branding ? data.branding : null;
          if (saved) {
            fillOwnerBrandingFields(saved);
            applyMenuBranding(saved);
          } else {
            void refreshMenuBranding();
          }
          setOwnerBrandingMsg('Saved. Main menu title, version, and update name are live for everyone.', false);
        } catch (e) {
          setOwnerBrandingMsg(String(e.message || e), true);
        }
      });
    }

    var ownerBtnLbAddRun = document.getElementById('ownerBtnLbAddRun');
    if (ownerBtnLbAddRun) {
      ownerBtnLbAddRun.addEventListener('click', async function () {
        var tok = getToken();
        var me = window.__skyhopLastMe;
        if (!tok || !me || me.role !== 'owner') return;
        var unEl = document.getElementById('ownerLbAddUser');
        var minEl = document.getElementById('ownerLbAddMin');
        var secEl = document.getElementById('ownerLbAddSec');
        var deathsEl = document.getElementById('ownerLbAddDeaths');
        var un = unEl ? String(unEl.value || '').trim() : '';
        if (!un) {
          setOwnerLbMsg('Username required.', true);
          return;
        }
        var timeMs = ownerLbTimeMsFromInputs(minEl, secEl);
        var deaths = deathsEl ? Math.max(0, Math.floor(Number(deathsEl.value) || 0)) : 0;
        var diff = ownerLbDifficulty ? ownerLbDifficulty.value : 'normal';
        try {
          await api('/api/owner/leaderboard/add-campaign-run', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: un, difficulty: diff, timeMs: timeMs, deaths: deaths, runCount: 1 }),
          });
          setOwnerLbMsg('Added run for ' + un + '.', false);
          if (typeof window.SkyHopRefreshLeaderboard === 'function') window.SkyHopRefreshLeaderboard();
          await refreshOwnerLbList();
        } catch (e) {
          setOwnerLbMsg(String(e.message || e), true);
        }
      });
    }

    var friendChatPeer = document.getElementById('friendChatPeer');
    var friendChatLoad = document.getElementById('friendChatLoad');
    var friendChatLog = document.getElementById('friendChatLog');
    var friendChatInput = document.getElementById('friendChatInput');
    var friendChatSend = document.getElementById('friendChatSend');
    var friendChatHint = document.getElementById('friendChatHint');
    var friendChatActivePeer = '';
    var friendChatSince = 0;
    var friendChatAccum = [];
    var friendChatPollTimer = null;
    function stopFriendChatPoll() {
      if (friendChatPollTimer) {
        clearInterval(friendChatPollTimer);
        friendChatPollTimer = null;
      }
    }
    function renderFriendChatMessages(messages) {
      if (!friendChatLog) return;
      if (!messages || !messages.length) {
        if (!friendChatLog.dataset.hadMsgs) {
          friendChatLog.innerHTML =
            '<li class="text-slate-500">No messages yet. Say hi!</li>';
        }
        return;
      }
      friendChatLog.dataset.hadMsgs = '1';
      friendChatLog.innerHTML = messages
        .map(function (m) {
          var who = m.mine ? 'You' : friendChatActivePeer || '?';
          var t = new Date(m.createdAt || 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return (
            '<li><span class="text-slate-500">' +
            t +
            '</span> <span class="font-sem text-teal-200/90">' +
            who +
            ':</span> ' +
            String(m.body || '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;') +
            '</li>'
          );
        })
        .join('');
      friendChatLog.scrollTop = friendChatLog.scrollHeight;
    }
    async function pullFriendChat() {
      var tok = getToken();
      if (!tok || !friendChatActivePeer) return;
      try {
        var q =
          '/api/friends/chat/messages?friendUsername=' +
          encodeURIComponent(friendChatActivePeer) +
          '&since=' +
          encodeURIComponent(String(friendChatSince || 0));
        var data = await api(q, { headers: { Authorization: 'Bearer ' + tok } });
        var msgs = data.messages || [];
        for (var mi = 0; mi < msgs.length; mi++) {
          var msg = msgs[mi];
          if (!msg || !msg.id) continue;
          var dup = false;
          for (var dj = 0; dj < friendChatAccum.length; dj++) {
            if (friendChatAccum[dj].id === msg.id) {
              dup = true;
              break;
            }
          }
          if (!dup) friendChatAccum.push(msg);
        }
        friendChatAccum.sort(function (a, b) {
          return (a.createdAt || 0) - (b.createdAt || 0);
        });
        if (friendChatAccum.length > 250) {
          friendChatAccum = friendChatAccum.slice(friendChatAccum.length - 250);
        }
        if (friendChatAccum.length) {
          var lastM = friendChatAccum[friendChatAccum.length - 1];
          if (lastM && lastM.createdAt) {
            friendChatSince = Math.max(friendChatSince, Number(lastM.createdAt));
          }
        }
        renderFriendChatMessages(friendChatAccum);
      } catch (e) {
        if (friendChatHint) {
          friendChatHint.textContent = String(e.message || e);
          friendChatHint.classList.remove('hidden');
        }
      }
    }
    function startFriendChatPoll(peer) {
      stopFriendChatPoll();
      friendChatActivePeer = peer;
      friendChatSince = 0;
      friendChatAccum = [];
      if (friendChatLog) {
        delete friendChatLog.dataset.hadMsgs;
        friendChatLog.innerHTML = '<li class="text-slate-500">Loading…</li>';
      }
      if (friendChatHint) friendChatHint.classList.add('hidden');
      void pullFriendChat();
      friendChatPollTimer = setInterval(function () {
        void pullFriendChat();
      }, 3000);
    }
    if (friendChatLoad) {
      friendChatLoad.addEventListener('click', function () {
        var peer = String((friendChatPeer && friendChatPeer.value) || '').trim();
        if (!peer) {
          setFriendsErr('Enter a friend username for chat.', false);
          return;
        }
        startFriendChatPoll(peer);
      });
    }
    if (friendChatSend) {
      friendChatSend.addEventListener('click', async function () {
        var tok = getToken();
        if (!tok) return;
        var peer = friendChatActivePeer || String((friendChatPeer && friendChatPeer.value) || '').trim();
        var text = String((friendChatInput && friendChatInput.value) || '');
        if (!peer) {
          setFriendsErr('Open chat with a friend first.', false);
          return;
        }
        if (!text.trim()) return;
        if (typeof window.SkyHopCensorProfanity === 'function') {
          var censChat = window.SkyHopCensorProfanity(text);
          text = censChat.text;
          if (friendChatInput && censChat.flagged) friendChatInput.value = text;
        }
        try {
          await api('/api/friends/chat/send', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ toUsername: peer, text: text }),
          });
          if (friendChatInput) friendChatInput.value = '';
          if (!friendChatActivePeer) startFriendChatPoll(peer);
          else void pullFriendChat();
        } catch (e) {
          setFriendsErr(String(e.message || e), false);
        }
      });
    }
    if (btnFriendsClose) {
      btnFriendsClose.addEventListener('click', function () {
        stopFriendChatPoll();
        friendChatActivePeer = '';
      });
    }

    if (friendBtnGiftCoins) {
      friendBtnGiftCoins.addEventListener('click', async function () {
        var tok = getToken();
        if (!tok) return;
        setFriendsErr('', false);
        var un = (friendGiftUser && friendGiftUser.value) || '';
        var amt = friendGiftAmt ? Number(friendGiftAmt.value) : NaN;
        if (!String(un).trim()) {
          setFriendsErr('Enter your friend\'s username.', false);
          return;
        }
        if (!Number.isFinite(amt) || amt < 1 || amt > 100000 || Math.floor(amt) !== amt) {
          setFriendsErr('Amount must be a whole number from 1 to 100,000.', false);
          return;
        }
        try {
          var data = await api('/api/friends/gift-coins', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: String(un).trim(), amount: Math.floor(amt) }),
          });
          if (window.__skyhopLastMe) {
            window.__skyhopLastMe.coins = data.yourCoins;
            window.__skyhopLastMe.coinsInfinite = data.coinsInfinite;
          }
          var elc = document.getElementById('accStatCoins');
          if (elc && window.__skyhopLastMe) {
            elc.textContent = window.__skyhopLastMe.coinsInfinite ? '∞' : String(window.__skyhopLastMe.coins);
          }
          setFriendsErr(
            'Sent ' +
              String(Math.floor(amt)) +
              ' coins to ' +
              data.recipientUsername +
              ' (they now have ' +
              String(data.recipientCoins) +
              ').',
            true
          );
        } catch (e) {
          setFriendsErr(String(e.message || e), false);
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

    updateFriendsFab(null);
    updateModDashboardFab(null);
    updateAdminBanFab(null);
    updateOwnerRequestBadge(null);
    syncOwnerStrikeTools(null);
    void refreshMenuBranding();
    if (getToken()) void refreshPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
