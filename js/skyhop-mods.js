/**
 * User mods — upload .js (5 MB), activate up to 3 (saved on account).
 */
(function () {
  var pendingActivate = [];
  var confirmMode = false;
  var loadedScriptEls = [];
  var pendingUploadFile = null;
  var accountActiveIds = [];

  function api(path, opts) {
    if (typeof window.SkyHopApiRequest !== 'function') {
      return Promise.reject(new Error('Sign in first'));
    }
    return window.SkyHopApiRequest(path, opts || {});
  }

  function apiBase() {
    if (typeof window.SkyHopApiOrigin === 'function') return window.SkyHopApiOrigin();
    return window.location.origin;
  }

  function token() {
    try {
      return localStorage.getItem('SKYHOP_AUTH_TOKEN') || '';
    } catch {
      return '';
    }
  }

  function screen() {
    return document.getElementById('screenMyMods');
  }

  function setErr(t) {
    var el = document.getElementById('myModsErr');
    if (!el) return;
    el.textContent = t || '';
    el.classList.toggle('hidden', !t);
  }

  function unloadMods() {
    for (var i = 0; i < loadedScriptEls.length; i++) {
      try {
        loadedScriptEls[i].remove();
      } catch {
        /* */
      }
    }
    loadedScriptEls.length = 0;
  }

  function teardownAllModEffects() {
    var map = window.__skyhopUserModTeardowns;
    if (map && typeof map === 'object') {
      for (var k of Object.keys(map)) {
        try {
          if (typeof map[k] === 'function') map[k]();
        } catch {
          /* */
        }
      }
    }
    window.__skyhopUserModTeardowns = {};
    document.querySelectorAll('[data-skyhop-mod-ui]').forEach(function (el) {
      try {
        el.remove();
      } catch {
        /* */
      }
    });
    var badge = document.getElementById('skyhopTestModBadge');
    if (badge) badge.remove();
    delete window.__SKYHOP_TEST_MOD__;
    delete window.__SKYHOP_MOD_MINIMAL__;
  }

  window.SkyHopRegisterModTeardown = function (modId, fn) {
    if (!modId || typeof fn !== 'function') return;
    if (!window.__skyhopUserModTeardowns) window.__skyhopUserModTeardowns = {};
    window.__skyhopUserModTeardowns[String(modId)] = fn;
  };

  window.SkyHopClearAllModEffects = teardownAllModEffects;

  async function saveActiveToAccount(ids) {
    var data = await api('/api/user-mods/active', {
      method: 'POST',
      body: JSON.stringify({ ids: ids.slice(0, 3) }),
    });
    accountActiveIds = (data && data.activeModIds) || ids.slice(0, 3);
    pendingActivate = accountActiveIds.slice();
    return accountActiveIds;
  }

  async function applyMods(ids) {
    teardownAllModEffects();
    unloadMods();
    var tok = token();
    if (!tok || !ids.length) {
      accountActiveIds = [];
      return;
    }
    for (var j = 0; j < ids.length; j++) {
      var id = ids[j];
      var res = await fetch(apiBase() + '/api/user-mods/' + encodeURIComponent(id) + '/script', {
        headers: { Authorization: 'Bearer ' + tok },
      });
      if (!res.ok) continue;
      var code = await res.text();
      var s = document.createElement('script');
      s.type = 'text/javascript';
      s.dataset.skyhopUserMod = id;
      s.text =
        'window.__skyhopInjectedModId=' + JSON.stringify(String(id)) + ';\n' + code;
      document.body.appendChild(s);
      loadedScriptEls.push(s);
    }
  }

  async function syncActiveModsFromAccount() {
    teardownAllModEffects();
    unloadMods();
    pendingActivate = [];
    accountActiveIds = [];
    if (!token()) return;
    try {
      var data = await api('/api/user-mods/mine', {});
      accountActiveIds = (data && data.activeModIds) || [];
      pendingActivate = accountActiveIds.slice(0, 3);
      if (pendingActivate.length) await applyMods(pendingActivate);
    } catch {
      teardownAllModEffects();
      unloadMods();
    }
  }

  function show(on) {
    var el = screen();
    if (!el) return;
    if (on) {
      try {
        if (!localStorage.getItem('SKYHOP_AUTH_TOKEN')) {
          window.alert('Sign in to upload and use mods.');
          return;
        }
      } catch {
        window.alert('Sign in to use mods.');
        return;
      }
    }
    el.classList.toggle('hidden', !on);
    el.classList.toggle('flex', on);
    if (on) void refreshList();
  }

  async function refreshList() {
    var ul = document.getElementById('myModsList');
    if (!ul) return;
    ul.innerHTML = '<li class="text-sm text-slate-400">Loading…</li>';
    try {
      var data = await api('/api/user-mods/mine', {});
      var mods = (data && data.mods) || [];
      accountActiveIds = (data && data.activeModIds) || [];
      pendingActivate = accountActiveIds.slice(0, 3);
      ul.innerHTML = '';
      if (!mods.length) {
        ul.innerHTML =
          '<li class="rounded-xl border border-white/10 bg-slate-900/60 p-4 text-center text-sm text-slate-400">No mods yet — upload a .js file below.</li>';
        return;
      }
      for (var i = 0; i < mods.length; i++) {
        (function (mod) {
          var li = document.createElement('li');
          li.className =
            'flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm';
          var checked = pendingActivate.indexOf(mod.id) >= 0;
          li.innerHTML =
            '<label class="flex flex-1 cursor-pointer items-center gap-2">' +
            '<input type="checkbox" class="mod-pick rounded border-slate-600" ' +
            (checked ? 'checked' : '') +
            ' />' +
            '<span class="font-sem text-white">' +
            String(mod.title || 'Mod').replace(/</g, '&lt;') +
            '</span>' +
            '<span class="text-xs text-slate-500">' +
            Math.round((mod.byte_size || 0) / 1024) +
            ' KB</span></label>' +
            '<button type="button" class="mod-del rounded-lg border border-rose-500/45 px-2 py-1 text-xs text-rose-100 hover:bg-rose-950/50">Delete</button>';
          li.querySelector('.mod-pick').addEventListener('change', function (e) {
            var id = mod.id;
            if (e.target.checked) {
              if (pendingActivate.indexOf(id) < 0) pendingActivate.push(id);
            } else {
              pendingActivate = pendingActivate.filter(function (x) {
                return x !== id;
              });
            }
            if (pendingActivate.length > 3) {
              pendingActivate = pendingActivate.slice(-3);
              void refreshList();
              window.alert('You can activate at most 3 mods at once.');
            }
            syncActivateBtn();
          });
          li.querySelector('.mod-del').addEventListener('click', function () {
            if (
              !window.confirm(
                'Delete this mod permanently?\n\nIts in-game effects will stop right away.'
              )
            ) {
              return;
            }
            void (async function () {
              try {
                await api('/api/user-mods/delete', {
                  method: 'POST',
                  body: JSON.stringify({ id: mod.id }),
                });
                confirmMode = false;
                syncActivateBtn();
                await syncActiveModsFromAccount();
                await refreshList();
              } catch (e) {
                setErr(String(e.message || e));
              }
            })();
          });
          ul.appendChild(li);
        })(mods[i]);
      }
      syncActivateBtn();
    } catch (e) {
      ul.innerHTML = '';
      setErr(String(e.message || e));
    }
  }

  function syncActivateBtn() {
    var btn = document.getElementById('myModsActivate');
    if (!btn) return;
    if (confirmMode) {
      btn.textContent = 'Confirm';
      btn.classList.add('bg-emerald-600');
    } else {
      btn.textContent = 'Activate';
      btn.classList.remove('bg-emerald-600');
    }
  }

  function syncPendingUploadUi() {
    var nameEl = document.getElementById('myModsPendingName');
    var upBtn = document.getElementById('myModsUpload');
    if (nameEl) {
      if (pendingUploadFile) {
        nameEl.textContent = pendingUploadFile.name;
        nameEl.classList.remove('hidden');
      } else {
        nameEl.textContent = '';
        nameEl.classList.add('hidden');
      }
    }
    if (upBtn) {
      upBtn.disabled = !pendingUploadFile;
      upBtn.classList.toggle('opacity-50', !pendingUploadFile);
    }
  }

  function queueUploadFile(file) {
    if (!file) return;
    if (!/\.js$/i.test(file.name)) {
      window.alert('Choose a .js file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      window.alert('Max file size is 5 MB.');
      return;
    }
    pendingUploadFile = file;
    syncPendingUploadUi();
    setErr('');
  }

  async function uploadFile(file) {
    if (!file) return;
    var tok = token();
    if (!tok) {
      window.alert('Sign in first.');
      return;
    }
    var title = file.name.replace(/\.js$/i, '').slice(0, 120);
    var res = await fetch(apiBase() + '/api/user-mods/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/javascript',
        'X-Mod-Title': encodeURIComponent(title),
      },
      body: file,
    });
    var text = await res.text();
    var data = null;
    try {
      if (text) data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok) throw new Error((data && data.error) || text || 'Upload failed');
    pendingUploadFile = null;
    syncPendingUploadUi();
    await refreshList();
  }

  function bind() {
    try {
      localStorage.removeItem('SKYHOP_ACTIVE_MOD_IDS');
    } catch {
      /* legacy */
    }
    teardownAllModEffects();

    var nav = document.getElementById('btnNavMyMods');
    if (nav) nav.addEventListener('click', function () { show(true); });
    var close = document.getElementById('btnMyModsClose');
    if (close) close.addEventListener('click', function () { show(false); });

    var fileIn = document.getElementById('myModsFileInput');
    var drop = document.getElementById('myModsDropZone');
    if (fileIn) {
      fileIn.addEventListener('change', function () {
        var f = fileIn.files && fileIn.files[0];
        if (f) queueUploadFile(f);
        fileIn.value = '';
      });
    }
    var upBtn = document.getElementById('myModsUpload');
    if (upBtn) {
      upBtn.addEventListener('click', function () {
        if (!pendingUploadFile) return;
        void uploadFile(pendingUploadFile).catch(function (e) {
          setErr(String(e.message || e));
        });
      });
    }
    syncPendingUploadUi();
    if (drop) {
      drop.addEventListener('dragover', function (e) {
        e.preventDefault();
        drop.classList.add('ring-2', 'ring-violet-400');
      });
      drop.addEventListener('dragleave', function () {
        drop.classList.remove('ring-2', 'ring-violet-400');
      });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('ring-2', 'ring-violet-400');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) queueUploadFile(f);
      });
      drop.addEventListener('click', function () {
        if (fileIn) fileIn.click();
      });
    }

    var act = document.getElementById('myModsActivate');
    if (act) {
      act.addEventListener('click', async function () {
        if (!confirmMode) {
          if (!pendingActivate.length) {
            window.alert('Select up to 3 mods to activate.');
            return;
          }
          confirmMode = true;
          syncActivateBtn();
          return;
        }
        confirmMode = false;
        syncActivateBtn();
        try {
          var ids = pendingActivate.slice(0, 3);
          await saveActiveToAccount(ids);
          await applyMods(ids);
          window.alert('Mods active on your account — start a run to use them.');
          show(false);
        } catch (e) {
          setErr(String(e.message || e));
        }
      });
    }

    window.addEventListener('skyhop-auth-changed', function () {
      try {
        if (!localStorage.getItem('SKYHOP_AUTH_TOKEN')) {
          pendingActivate = [];
          confirmMode = false;
          accountActiveIds = [];
          teardownAllModEffects();
          unloadMods();
          return;
        }
        void syncActiveModsFromAccount();
      } catch {
        /* */
      }
    });

    void syncActiveModsFromAccount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
