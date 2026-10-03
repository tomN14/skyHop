/**
 * Player suggestion panel, moderator queue, and the owner's forwarded list.
 */
(function () {
  function token() {
    try {
      return localStorage.getItem('SKYHOP_AUTH_TOKEN') || '';
    } catch (e) {
      return '';
    }
  }

  function api(path, opts) {
    if (typeof window.SkyHopApiRequest !== 'function') return Promise.reject(new Error('API not ready'));
    var options = opts || {};
    var headers = Object.assign({ Authorization: 'Bearer ' + token() }, options.headers || {});
    return window.SkyHopApiRequest(path, Object.assign({}, options, { headers: headers }));
  }

  function t(key, fallback) {
    if (window.SkyHopI18n) return window.SkyHopI18n.t(key, fallback);
    return fallback || key;
  }

  function show(screen, on) {
    if (!screen) return;
    screen.classList.toggle('hidden', !on);
    screen.classList.toggle('flex', !!on);
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function when(ms) {
    var n = Number(ms);
    if (!n) return '';
    try {
      return new Date(n).toLocaleString();
    } catch (e) {
      return '';
    }
  }

  var screen = document.getElementById('screenSuggestions');
  var msg = document.getElementById('suggestMsg');
  var text = document.getElementById('suggestText');
  var openBtn = document.getElementById('btnOpenSuggestions');
  var closeBtn = document.getElementById('btnSuggestionsClose');
  var sendBtn = document.getElementById('btnSuggestSend');

  function setMsg(value, bad) {
    if (!msg) return;
    msg.textContent = value || '';
    msg.className = 'mt-2 text-xs ' + (bad ? 'text-rose-300' : 'text-emerald-200');
    msg.classList.toggle('hidden', !value);
  }

  if (openBtn && screen) {
    openBtn.addEventListener('click', function () {
      setMsg('', false);
      var me = window.__skyhopLastMe;
      var need = document.getElementById('suggestNeedLogin');
      var form = document.getElementById('suggestForm');
      var logged = !!(me && me.username);
      if (need) need.classList.toggle('hidden', logged);
      if (form) form.classList.toggle('hidden', !logged);
      show(screen, true);
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', function () { show(screen, false); });
  if (sendBtn && text) {
    sendBtn.addEventListener('click', function () {
      setMsg('', false);
      sendBtn.disabled = true;
      api('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.value }),
      })
        .then(function () {
          text.value = '';
          setMsg(t('suggest.sent', 'Sent. A moderator will read it.'), false);
        })
        .catch(function (e) {
          setMsg(e && e.message ? e.message : 'Could not send that.', true);
        })
        .then(function () {
          sendBtn.disabled = false;
        });
    });
  }

  var modScreen = document.getElementById('screenModSuggestions');
  var modList = document.getElementById('modSuggestionList');
  var modErr = document.getElementById('modSuggestionErr');
  var modBtn = document.getElementById('btnModSuggestions');
  var modBadge = document.getElementById('modSuggestionBadge');

  function setModErr(value) {
    if (!modErr) return;
    modErr.textContent = value || '';
    modErr.classList.toggle('hidden', !value);
  }

  function paintMod(rows) {
    if (!modList) return;
    if (!rows.length) {
      modList.innerHTML = '<li class="text-sm text-slate-400">No suggestions waiting.</li>';
      return;
    }
    modList.innerHTML = rows
      .map(function (row) {
        return (
          '<li class="rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-left">' +
          '<p class="text-[11px] text-slate-400">' +
          esc(row.username) +
          ' · ' +
          esc(when(row.createdAt)) +
          '</p>' +
          '<p class="mt-1 whitespace-pre-wrap text-sm text-slate-100">' +
          esc(row.text) +
          '</p>' +
          '<div class="mt-2 flex flex-wrap gap-2">' +
          '<button type="button" data-suggest-dismiss="' +
          esc(row.id) +
          '" class="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5">Dismiss</button>' +
          '<button type="button" data-suggest-send="' +
          esc(row.id) +
          '" class="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600">Send to owner</button>' +
          '</div></li>'
        );
      })
      .join('');
  }

  function loadMod() {
    setModErr('');
    return api('/api/mod/suggestions', { method: 'GET' })
      .then(function (data) {
        paintMod((data && data.suggestions) || []);
      })
      .catch(function (e) {
        setModErr(e && e.message ? e.message : 'Could not load suggestions.');
      });
  }

  if (modBtn && modScreen) {
    modBtn.addEventListener('click', function () {
      show(modScreen, true);
      loadMod();
    });
  }
  var modClose = document.getElementById('btnModSuggestionsClose');
  if (modClose) modClose.addEventListener('click', function () { show(modScreen, false); });
  if (modList) {
    modList.addEventListener('click', function (ev) {
      var dismiss = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-suggest-dismiss');
      var send = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-suggest-send');
      var id = dismiss || send;
      if (!id) return;
      var path = dismiss ? '/dismiss' : '/send';
      api('/api/mod/suggestions/' + encodeURIComponent(id) + path, { method: 'POST' })
        .then(function () {
          return loadMod();
        })
        .catch(function (e) {
          setModErr(e && e.message ? e.message : 'Could not update that suggestion.');
        });
    });
  }

  var ownerList = document.getElementById('ownerSuggestionList');
  var ownerErr = document.getElementById('ownerSuggestionErr');

  function paintOwner(rows) {
    if (!ownerList) return;
    if (!rows.length) {
      ownerList.innerHTML = '<li class="text-[11px] text-slate-500">No suggestions have been sent to you yet.</li>';
      return;
    }
    ownerList.innerHTML = rows
      .map(function (row) {
        return (
          '<li class="rounded-xl border border-white/10 bg-slate-950/50 p-3">' +
          '<p class="text-[11px] text-slate-400">From <span class="text-slate-200">' +
          esc(row.username) +
          '</span> · sent by <span class="text-emerald-200">' +
          esc(row.modName || 'a moderator') +
          '</span> · ' +
          esc(when(row.sentAt || row.createdAt)) +
          '</p>' +
          '<p class="mt-1 whitespace-pre-wrap text-sm text-slate-100">' +
          esc(row.text) +
          '</p></li>'
        );
      })
      .join('');
  }

  function loadOwner() {
    if (!ownerList) return;
    if (ownerErr) {
      ownerErr.textContent = '';
      ownerErr.classList.add('hidden');
    }
    api('/api/owner/suggestions', { method: 'GET' })
      .then(function (data) {
        paintOwner((data && data.suggestions) || []);
      })
      .catch(function (e) {
        if (!ownerErr) return;
        ownerErr.textContent = e && e.message ? e.message : 'Could not load suggestions.';
        ownerErr.classList.remove('hidden');
      });
  }

  var ownerOpen = document.getElementById('btnOpenOwnerPage');
  if (ownerOpen) ownerOpen.addEventListener('click', loadOwner);

  window.SkyHopSyncSuggestions = function (me) {
    var staff = !!(me && (me.role === 'moderator' || me.adminPowers));
    if (modBtn) modBtn.classList.toggle('hidden', !staff);
    var n = me && staff ? Number(me.suggestionCount) || 0 : 0;
    if (modBadge) {
      modBadge.textContent = n > 99 ? '99+' : String(n);
      modBadge.classList.toggle('hidden', n <= 0);
    }
    if (me && me.locale && window.SkyHopI18n && window.SkyHopI18n.get() !== me.locale) {
      window.SkyHopI18n.set(me.locale, { skipSave: true });
    }
  };
})();
