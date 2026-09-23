/**
 * Owner-added campaign worlds: create (no stages here), play if unlocked, inbox stage edits.
 */
(function () {
  function api(path, opts) {
    if (typeof window.SkyHopApiRequest !== 'function') return Promise.reject(new Error('API not ready'));
    return window.SkyHopApiRequest(path, opts || {});
  }

  function isOwner() {
    var me = window.__skyhopLastMe;
    return !!(me && me.role === 'owner');
  }

  function setErr(t) {
    var el = document.getElementById('ownerWorldErr');
    if (!el) return;
    el.textContent = t || '';
    el.classList.toggle('hidden', !t);
  }

  function syncFab() {
    var fab = document.getElementById('btnOwnerAddWorldFab');
    var show = isOwner();
    if (fab) {
      fab.classList.toggle('hidden', !show);
      if (show) fab.style.display = 'flex';
      else fab.style.display = '';
    }
    if (!show) closePanel();
  }

  function closePanel() {
    var screen = document.getElementById('screenOwnerAddWorld');
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
    setErr('');
  }

  function fillWorldSelects(worlds) {
    ['ownerBuiltinWorldPick', 'ownerBuiltinWorldSelect'].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var keep = sel.value;
      Array.prototype.slice.call(sel.querySelectorAll('option[data-custom="1"]')).forEach(function (opt) {
        opt.remove();
      });
      (worlds || []).forEach(function (w) {
        if (!w || w.builtin || w.id < 3) return;
        var opt = document.createElement('option');
        opt.value = String(w.id);
        opt.setAttribute('data-custom', '1');
        opt.textContent = w.name + ' (' + String(w.stageCount || 0) + ' stages)';
        sel.appendChild(opt);
      });
      if (keep) sel.value = keep;
    });
  }

  function renderMenuWorlds(worlds) {
    var box = document.getElementById('menuExtraWorlds');
    if (!box) return;
    box.innerHTML = '';
    var extra = (worlds || []).filter(function (w) {
      return w && !w.builtin && w.id >= 3 && w.unlocked;
    });
    box.classList.toggle('hidden', extra.length === 0);
    extra.forEach(function (w) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'w-full rounded-2xl border border-violet-500/40 bg-violet-950/40 px-4 py-3 text-sm font-semibold text-violet-100 hover:bg-violet-900/50';
      btn.textContent = 'Play ' + w.name;
      btn.addEventListener('click', function () {
        void playCustomWorld(w);
      });
      box.appendChild(btn);
    });
  }

  function renderOwnerLists(worlds) {
    var req = document.getElementById('ownerWorldRequireList');
    var made = document.getElementById('ownerWorldMadeList');
    if (req) {
      req.innerHTML = '';
      (worlds || []).forEach(function (w) {
        var li = document.createElement('li');
        var label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-sm text-slate-200';
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.value = String(w.id);
        box.className = 'owner-world-req rounded border-white/20 bg-slate-900';
        label.appendChild(box);
        var span = document.createElement('span');
        span.textContent = w.name;
        label.appendChild(span);
        li.appendChild(label);
        req.appendChild(li);
      });
    }
    if (made) {
      made.innerHTML = '';
      var custom = (worlds || []).filter(function (w) {
        return w && !w.builtin;
      });
      if (!custom.length) {
        var empty = document.createElement('li');
        empty.className = 'text-xs text-slate-500';
        empty.textContent = 'None yet.';
        made.appendChild(empty);
      }
      custom.forEach(function (w) {
        var li = document.createElement('li');
        li.className = 'rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-200';
        var reqNames = (w.requires || [])
          .map(function (id) {
            var hit = (worlds || []).find(function (x) {
              return Number(x.id) === Number(id);
            });
            return hit ? hit.name : 'World ' + id;
          })
          .join(', ');
        li.textContent =
          w.name + ' · ' + String(w.stageCount || 0) + ' stages · unlock after ' + (reqNames || 'nothing');
        made.appendChild(li);
      });
    }
  }

  async function loadCatalog() {
    var data = await api('/api/worlds', { method: 'GET' });
    var worlds = (data && data.worlds) || [];
    window.__skyhopCustomWorldCatalog = worlds;
    fillWorldSelects(worlds);
    renderMenuWorlds(worlds);
    if (isOwner() && document.getElementById('screenOwnerAddWorld') && !document.getElementById('screenOwnerAddWorld').classList.contains('hidden')) {
      renderOwnerLists(worlds);
    }
    return worlds;
  }

  async function openPanel() {
    if (!isOwner()) return;
    var screen = document.getElementById('screenOwnerAddWorld');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    setErr('');
    try {
      var worlds = await loadCatalog();
      renderOwnerLists(worlds);
    } catch (e) {
      setErr(String(e.message || e));
    }
  }

  async function submitWorld() {
    setErr('');
    var nameEl = document.getElementById('ownerWorldName');
    var name = nameEl ? String(nameEl.value || '').trim() : '';
    if (!name) {
      setErr('Name is required.');
      return;
    }
    var requires = [];
    document.querySelectorAll('.owner-world-req:checked').forEach(function (box) {
      requires.push(Number(box.value));
    });
    var btn = document.getElementById('ownerWorldSubmit');
    if (btn) btn.disabled = true;
    try {
      await api('/api/owner/worlds', {
        method: 'POST',
        body: JSON.stringify({ name: name, requires: requires }),
      });
      if (nameEl) nameEl.value = '';
      var worlds = await loadCatalog();
      renderOwnerLists(worlds);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function playCustomWorld(world) {
    if (!world || world.stageCount < 1) {
      window.alert('This world has no stages yet. Add them from the owner inbox.');
      return;
    }
    var data = await api('/api/worlds/' + world.id + '/stages', { method: 'GET' });
    var stages = (data && data.stages) || [];
    if (!stages.length) {
      window.alert('This world has no stages yet.');
      return;
    }
    window.__skyhopCustomWorldStages = stages;
    window.__skyhopCustomWorldId = world.id;
    if (window.SkyHopWorlds && typeof window.SkyHopWorlds.setActiveWorld === 'function') {
      window.SkyHopWorlds.setActiveWorld(world.id);
    }
    if (typeof window.SkyHopStartCampaignPlay === 'function') window.SkyHopStartCampaignPlay();
  }

  function bind() {
    var fab = document.getElementById('btnOwnerAddWorldFab');
    var close = document.getElementById('btnOwnerAddWorldClose');
    var submit = document.getElementById('ownerWorldSubmit');
    var inbox = document.getElementById('btnModInbox');
    if (fab) fab.addEventListener('click', function () {
      void openPanel();
    });
    if (close) close.addEventListener('click', closePanel);
    if (submit) submit.addEventListener('click', function () {
      void submitWorld();
    });
    if (inbox) inbox.addEventListener('click', function () {
      void loadCatalog().catch(function () {});
    });
    window.addEventListener('skyhop-auth-changed', function () {
      syncFab();
      void loadCatalog().catch(function () {});
    });
    syncFab();
    void loadCatalog().catch(function () {});
  }

  window.SkyHopRefreshCustomWorlds = function () {
    return loadCatalog();
  };
  window.SkyHopSyncOwnerAddWorldFab = syncFab;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
