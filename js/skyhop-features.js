/**
 * Login notices, polls, collections, play time, owner tools, and automatic race entry.
 */
(function () {
  const MUSIC_TRACK = 'SKYHOP_MUSIC_TRACK';
  const MUSIC_VOLUME = 'SKYHOP_MUSIC_VOLUME';
  let musicAudio = null;
  let musicKickBound = false;

  function musicVolume() {
    const raw = localStorage.getItem(MUSIC_VOLUME);
    const n = raw == null || raw === '' ? 70 : Number(raw);
    if (!Number.isFinite(n)) return 70;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function musicFile() {
    try {
      return localStorage.getItem(MUSIC_TRACK) || '';
    } catch (e) {
      return '';
    }
  }

  function ensureMusic() {
    if (musicAudio) return musicAudio;
    musicAudio = document.getElementById('skyhopAccountMusic');
    if (!musicAudio) {
      musicAudio = document.createElement('audio');
      musicAudio.id = 'skyhopAccountMusic';
      musicAudio.loop = true;
      musicAudio.preload = 'auto';
      document.body.appendChild(musicAudio);
    }
    musicAudio.loop = true;
    return musicAudio;
  }

  function kickMusic() {
    const audio = ensureMusic();
    if (!musicFile()) return;
    const pending = audio.play();
    if (pending && pending.catch) {
      pending.catch(function () {
        if (musicKickBound) return;
        musicKickBound = true;
        const resume = function () {
          document.removeEventListener('pointerdown', resume);
          audio.play().catch(function () {});
        };
        document.addEventListener('pointerdown', resume);
      });
    }
  }

  function applyMusic(restart) {
    const audio = ensureMusic();
    const file = musicFile();
    audio.volume = musicVolume() / 100;
    audio.loop = true;
    if (!file) {
      audio.pause();
      audio.removeAttribute('src');
      audio.dataset.file = '';
      return;
    }
    if (audio.dataset.file !== file) {
      audio.src = '/music/' + encodeURIComponent(file);
      audio.dataset.file = file;
      audio.loop = true;
      restart = true;
    }
    if (restart || audio.paused) kickMusic();
  }

  function trackLabel(file) {
    return String(file || '').replace(/\.mp3$/i, '');
  }

  let fillingMusic = false;

  function fillMusicSelect(tracks) {
    const select = document.getElementById('accMusicTrack');
    const volume = document.getElementById('accMusicVolume');
    const label = document.getElementById('accMusicVolLabel');
    if (!select) return;
    const current = musicFile();
    const names = Array.isArray(tracks) ? tracks.slice() : [];
    if (current && names.indexOf(current) === -1) names.unshift(current);
    fillingMusic = true;
    select.innerHTML = '';
    const off = document.createElement('option');
    off.value = '';
    off.textContent = 'None';
    off.selected = !current;
    select.appendChild(off);
    names.forEach(function (file) {
      const opt = document.createElement('option');
      opt.value = file;
      opt.textContent = trackLabel(file);
      opt.selected = file === current;
      select.appendChild(opt);
    });
    select.selectedIndex = 0;
    if (current) {
      for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === current) select.selectedIndex = i;
      }
    }
    fillingMusic = false;
    if (volume) volume.value = String(musicVolume());
    if (label) label.textContent = String(musicVolume());
  }

  function loadMusicTracks() {
    fetch('/api/music')
      .then(function (res) { return res.json(); })
      .then(function (data) { fillMusicSelect((data && data.tracks) || []); })
      .catch(function () { fillMusicSelect([]); });
  }

  function bindMusic() {
    const select = document.getElementById('accMusicTrack');
    const volume = document.getElementById('accMusicVolume');
    const label = document.getElementById('accMusicVolLabel');
    fillMusicSelect([]);
    loadMusicTracks();
    applyMusic(false);
    if (select && !select.dataset.bound) {
      select.dataset.bound = '1';
      select.addEventListener('change', function () {
        if (fillingMusic) return;
        try { localStorage.setItem(MUSIC_TRACK, select.value || ''); } catch (e) { /* ignore */ }
        applyMusic(true);
      });
    }
    if (volume && !volume.dataset.bound) {
      volume.dataset.bound = '1';
      volume.addEventListener('input', function () {
        const n = Math.max(0, Math.min(100, Math.round(Number(volume.value) || 0)));
        try { localStorage.setItem(MUSIC_VOLUME, String(n)); } catch (e) { /* ignore */ }
        if (label) label.textContent = String(n);
        const audio = ensureMusic();
        audio.volume = n / 100;
        if (musicFile() && audio.paused) kickMusic();
      });
    }
    window.SkyHopMusic = {
      trackName: function () { return trackLabel(musicFile()); },
    };
  }

  function token() {
    try {
      return localStorage.getItem('SKYHOP_AUTH_TOKEN') || '';
    } catch (e) {
      return '';
    }
  }

  function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const tok = token();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body || undefined,
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || 'Request failed');
        return data;
      });
    });
  }

  let noticeQueue = [];

  function showNotice() {
    const screen = document.getElementById('screenNotices');
    const body = document.getElementById('noticeBody');
    const kind = document.getElementById('noticeKind');
    const btn = document.getElementById('noticeNext');
    if (!screen || !noticeQueue.length) {
      if (screen) {
        screen.classList.add('hidden');
        screen.classList.remove('flex');
      }
      return;
    }
    const item = noticeQueue[0];
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    if (kind) kind.textContent = item.kind === 'warning' ? 'Warning' : 'Announcement';
    if (body) body.textContent = item.text || '';
    if (btn) btn.textContent = noticeQueue.length === 1 ? 'Close' : 'Next';
  }

  function pullNotices() {
    if (!token()) return;
    api('/api/notices')
      .then(function (data) {
        noticeQueue = []
          .concat((data.announcements || []).map(function (row) { return Object.assign({ kind: 'announcement' }, row); }))
          .concat((data.warnings || []).map(function (row) { return Object.assign({ kind: 'warning' }, row); }));
        showNotice();
      })
      .catch(function () {});
  }

  function ackCurrent() {
    const item = noticeQueue.shift();
    if (item && item.id) {
      api('/api/notices/ack', { method: 'POST', body: JSON.stringify({ ids: [item.id] }) }).catch(function () {});
    }
    showNotice();
  }

  let playAcc = 0;
  let playStamp = Date.now();

  function formatPlayTime(ms) {
    const sec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function playTimeNow() {
    const pending = Math.max(0, Date.now() - playStamp);
    return (Number(window.__skyhopPlayBase) || 0) + playAcc + (token() ? pending : 0);
  }

  function paintPlayTime() {
    const el = document.getElementById('accStatPlayTime');
    if (!el) return;
    el.textContent = formatPlayTime(playTimeNow());
  }

  window.SkyHopNotePlayTime = function (ms) {
    const n = Math.max(0, Math.floor(Number(ms) || 0));
    if (!window.__skyhopPlayBase || n > window.__skyhopPlayBase) window.__skyhopPlayBase = n;
    paintPlayTime();
  };

  function flushPlayTime() {
    paintPlayTime();
    if (!token()) {
      playStamp = Date.now();
      return;
    }
    const now = Date.now();
    const dt = Math.min(300000, Math.max(0, now - playStamp));
    playStamp = now;
    playAcc += dt;
    if (playAcc < 15000) return;
    const send = playAcc;
    playAcc = 0;
    api('/api/me/play-time', { method: 'POST', body: JSON.stringify({ ms: send }) })
      .then(function (data) {
        if (data && data.playTimeMs != null) window.__skyhopPlayBase = Math.max(0, Math.floor(Number(data.playTimeMs) || 0));
        paintPlayTime();
      })
      .catch(function () {
        playAcc += send;
      });
  }

  let joinedRaces = {};

  function maybeJoinRaces() {
    if (!token() || !window.SkyHopJoinTournament) return;
    if (window.SKYHOP && window.SKYHOP.isRacing && window.SKYHOP.isRacing()) return;
    api('/api/economy')
      .then(function (data) {
        const companies = data.companies || [];
        for (let i = 0; i < companies.length; i++) {
          const races = companies[i].tournaments || [];
          for (let j = 0; j < races.length; j++) {
            const race = races[j];
            if (!race.canJoinLobby) continue;
            const key = companies[i].id + ':' + race.id;
            if (joinedRaces[key]) continue;
            joinedRaces[key] = true;
            window.SkyHopJoinTournament({ companyId: companies[i].id, tournamentId: race.id });
            return;
          }
        }
      })
      .catch(function () {});
  }

  function renderPolls(data) {
    const list = document.getElementById('pollList');
    if (!list) return;
    list.innerHTML = '';
    (data.polls || []).forEach(function (poll) {
      const box = document.createElement('section');
      box.className = 'rounded-2xl border border-white/10 p-3';
      const title = document.createElement('p');
      title.className = 'text-sm font-semibold text-white';
      title.textContent = poll.question;
      box.appendChild(title);
      const who = document.createElement('p');
      who.className = 'text-[11px] text-slate-500';
      who.textContent = poll.authorName || '';
      box.appendChild(who);
      (poll.options || []).forEach(function (opt, index) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'mt-2 flex w-full items-center justify-between rounded-lg border border-white/10 px-2 py-1.5 text-left text-xs text-slate-100 hover:bg-white/5';
        const count = (poll.counts && poll.counts[index]) || 0;
        row.textContent = opt + ' · ' + count + (poll.yourVote === index ? ' · your vote' : '');
        row.addEventListener('click', function () {
          api('/api/polls', { method: 'POST', body: JSON.stringify({ vote: true, id: poll.id, option: index }) })
            .then(renderPolls)
            .catch(function (e) { setMsg('pollMsg', e.message); });
        });
        box.appendChild(row);
      });
      list.appendChild(box);
    });
  }

  function setMsg(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }

  function openScreen(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('flex');
  }

  function closeScreen(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('flex');
  }

  function loadPolls() {
    if (!token()) {
      setMsg('pollMsg', 'Sign in from Account first.');
      return;
    }
    api('/api/polls').then(renderPolls).catch(function (e) { setMsg('pollMsg', e.message); });
  }

  let collectionDraftId = '';
  let collectionStages = [];

  function setLvlColMsg(text) {
    const el = document.getElementById('lvlColMsg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }

  function renderCollectionOrder() {
    const list = document.getElementById('lvlColOrder');
    if (!list) return;
    list.innerHTML = '';
    if (!collectionStages.length) {
      const empty = document.createElement('li');
      empty.className = 'text-[11px] text-slate-500';
      empty.textContent = 'No stages yet.';
      list.appendChild(empty);
      return;
    }
    collectionStages.forEach(function (stage, index) {
      const li = document.createElement('li');
      li.className = 'rounded-lg border border-white/10 bg-slate-900/70 p-2';
      const head = document.createElement('div');
      head.className = 'flex items-center justify-between gap-2';
      const name = document.createElement('span');
      name.className = 'font-semibold text-white';
      name.textContent = (index + 1) + '. ' + (stage.title || 'Level');
      const actions = document.createElement('span');
      actions.className = 'flex gap-1';
      function mini(label, fn) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rounded border border-white/15 px-1.5 py-0.5 text-[10px]';
        btn.textContent = label;
        btn.addEventListener('click', fn);
        actions.appendChild(btn);
      }
      mini('Up', function () {
        if (index < 1) return;
        const swap = collectionStages[index - 1];
        collectionStages[index - 1] = collectionStages[index];
        collectionStages[index] = swap;
        renderCollectionOrder();
      });
      mini('Down', function () {
        if (index >= collectionStages.length - 1) return;
        const swap = collectionStages[index + 1];
        collectionStages[index + 1] = collectionStages[index];
        collectionStages[index] = swap;
        renderCollectionOrder();
      });
      mini('Remove', function () {
        collectionStages.splice(index, 1);
        renderCollectionOrder();
      });
      head.appendChild(name);
      head.appendChild(actions);
      const music = document.createElement('input');
      music.className = 'mt-2 w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-[11px] text-white';
      music.placeholder = 'Music name for this stage';
      music.value = stage.musicName || '';
      music.addEventListener('input', function () { stage.musicName = music.value; });
      const script = document.createElement('textarea');
      script.rows = 2;
      script.className = 'mt-1 w-full rounded border border-white/15 bg-slate-950 p-2 font-mono text-[11px] text-slate-100';
      script.placeholder = 'SPL for this stage';
      script.value = stage.script || '';
      script.addEventListener('input', function () { stage.script = script.value; });
      li.appendChild(head);
      li.appendChild(music);
      li.appendChild(script);
      list.appendChild(li);
    });
  }

  function loadEditorLevels() {
    const pick = document.getElementById('lvlColLevelPick');
    if (!pick) return Promise.resolve();
    return api('/api/levels/mine').then(function (data) {
      pick.innerHTML = '';
      (data.levels || []).forEach(function (row) {
        const opt = document.createElement('option');
        opt.value = row.id;
        opt.textContent = row.title || 'Level';
        pick.appendChild(opt);
      });
      if (!pick.options.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No saved levels yet';
        pick.appendChild(opt);
      }
    }).catch(function (e) { setLvlColMsg(e.message); });
  }

  function loadEditorCollections() {
    const pick = document.getElementById('lvlColExisting');
    if (!pick) return Promise.resolve();
    return api('/api/collections?q=').then(function (data) {
      const current = pick.value;
      pick.innerHTML = '';
      const fresh = document.createElement('option');
      fresh.value = '';
      fresh.textContent = 'New collection';
      pick.appendChild(fresh);
      (data.collections || []).forEach(function (row) {
        if (!row.yours) return;
        const opt = document.createElement('option');
        opt.value = row.id;
        opt.textContent = row.title || 'Collection';
        pick.appendChild(opt);
      });
      if (current) pick.value = current;
    }).catch(function (e) { setLvlColMsg(e.message); });
  }

  function openCollectionDraft(id) {
    if (!id) {
      collectionDraftId = '';
      collectionStages = [];
      const title = document.getElementById('lvlColTitle');
      const shared = document.getElementById('lvlColShared');
      if (title) title.value = '';
      if (shared) shared.value = '';
      renderCollectionOrder();
      return;
    }
    api('/api/collections?id=' + encodeURIComponent(id)).then(function (col) {
      collectionDraftId = col.id;
      collectionStages = (col.stages || []).map(function (stage) {
        return {
          levelId: stage.levelId,
          title: stage.title || 'Level',
          musicName: stage.musicName || '',
          script: stage.script || '',
        };
      });
      const title = document.getElementById('lvlColTitle');
      const shared = document.getElementById('lvlColShared');
      if (title) title.value = col.title || '';
      if (shared) shared.value = col.sharedScript || '';
      renderCollectionOrder();
    }).catch(function (e) { setLvlColMsg(e.message); });
  }

  function saveEditorCollection(publish) {
    const title = document.getElementById('lvlColTitle');
    const shared = document.getElementById('lvlColShared');
    api('/api/collections', {
      method: 'POST',
      body: JSON.stringify({
        id: collectionDraftId || undefined,
        title: title ? title.value : '',
        stages: collectionStages.map(function (stage) {
          return {
            levelId: stage.levelId,
            title: stage.title || '',
            musicName: stage.musicName || '',
            script: stage.script || '',
          };
        }),
        sharedScript: shared ? shared.value : '',
        publish: !!publish,
      }),
    }).then(function (row) {
      collectionDraftId = row.id;
      setLvlColMsg(publish ? 'Published.' : 'Collection saved. Beat every stage, then publish.');
      const pick = document.getElementById('lvlColExisting');
      loadEditorCollections().then(function () {
        if (pick) pick.value = row.id;
      });
    }).catch(function (e) { setLvlColMsg(e.message); });
  }

  function renderCollections(data) {
    const list = document.getElementById('colList');
    if (!list) return;
    list.innerHTML = '';
    (data.collections || []).forEach(function (row) {
      const box = document.createElement('div');
      box.className = 'flex items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2';
      const label = document.createElement('div');
      label.innerHTML = '<p class="text-sm text-white"></p><p class="text-[11px] text-slate-500"></p>';
      label.querySelector('p').textContent = row.title;
      label.querySelectorAll('p')[1].textContent = (row.stageCount || 0) + ' stages · ' + (row.ownerName || '');
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'rounded-lg bg-cyan-600 px-2 py-1 text-xs font-semibold text-white';
      play.textContent = 'Play';
      play.addEventListener('click', function () { playCollection(row.id); });
      box.appendChild(label);
      box.appendChild(play);
      list.appendChild(box);
    });
  }

  function searchCollections() {
    const q = document.getElementById('colSearch');
    api('/api/collections?q=' + encodeURIComponent(q ? q.value : ''))
      .then(renderCollections)
      .catch(function (e) { setMsg('colMsg', e.message); });
  }

  window.SkyHopCollectionStageCleared = function (index) {
    const bag = window.__skyhopCollection;
    if (!bag || !bag.id || !bag.yours) return;
    const stageIndex = typeof bag.reportIndex === 'function' ? bag.reportIndex(index) : index;
    api('/api/collections', { method: 'POST', body: JSON.stringify({ id: bag.id, clearStage: stageIndex }) }).catch(function () {});
  };

  function playCollection(id, onlyIndex) {
    const single = onlyIndex == null || onlyIndex === '' ? null : Math.floor(Number(onlyIndex));
    const mine = document.getElementById('screenLevelsMine');
    const fromMine = !!(mine && !mine.classList.contains('hidden'));
    return api('/api/collections?id=' + encodeURIComponent(id))
      .then(function (col) {
        const stages = col.stages || [];
        return Promise.all(stages.map(function (stage) {
          return fetch('/api/levels/' + encodeURIComponent(stage.levelId)).then(function (res) {
            return res.json().then(function (body) {
              if (!res.ok) throw new Error((body && body.error) || 'Level missing');
              return body;
            });
          });
        })).then(function (rows) {
          const built = rows.map(function (row, index) {
            const data = JSON.parse(JSON.stringify(row.data || {}));
            const meta = stages[index] || {};
            data.musicName = meta.musicName || data.musicName || '';
            const scripts = [col.sharedScript || '', meta.script || '', data.script || ''].filter(Boolean);
            if (scripts.length) data.script = scripts.join('\n');
            return data;
          });
          const playable = single == null ? built : (built[single] ? [built[single]] : []);
          if (!playable.length) throw new Error('That stage is missing.');
          window.__skyhopCollection = {
            id: col.id,
            length: stages.length,
            yours: !!col.yours,
            reportIndex: function (playIndex) { return single == null ? playIndex : single; },
          };
          closeScreen('screenCollections');
          if (fromMine && mine) mine.classList.add('hidden');
          if (window.SKYHOP && window.SKYHOP.startUserLevel) {
            window.SKYHOP.startUserLevel(playable, {
              mode: 'play',
              hudTitle: col.title,
              levelTitle: col.title,
              onContinue: function () {
                window.__skyhopCollection = null;
                if (fromMine && mine) {
                  mine.classList.remove('hidden');
                  if (typeof window.SkyHopRefreshMineCollections === 'function') window.SkyHopRefreshMineCollections();
                }
              },
            });
          }
        });
      })
      .catch(function (e) {
        setMsg('colMsg', e.message);
        const err = document.getElementById('levelsMineErr');
        if (fromMine && err) {
          err.textContent = e.message || 'Could not start that collection.';
          err.classList.remove('hidden');
        }
      });
  }

  window.SkyHopPlayCollection = playCollection;

  function bindEditorCollection() {
    const toggle = document.getElementById('btnLvlEdCollection');
    const panel = document.getElementById('lvlEdCollection');
    if (toggle && panel && !toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.addEventListener('click', function () {
        const open = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        if (open) {
          loadEditorLevels();
          loadEditorCollections();
          renderCollectionOrder();
        }
      });
    }
    const existing = document.getElementById('lvlColExisting');
    if (existing && !existing.dataset.bound) {
      existing.dataset.bound = '1';
      existing.addEventListener('change', function () { openCollectionDraft(existing.value); });
    }
    const add = document.getElementById('lvlColAdd');
    if (add && !add.dataset.bound) {
      add.dataset.bound = '1';
      add.addEventListener('click', function () {
        const pick = document.getElementById('lvlColLevelPick');
        if (!pick || !pick.value) {
          setLvlColMsg('Save a level, then pick it here.');
          return;
        }
        collectionStages.push({
          levelId: pick.value,
          title: pick.options[pick.selectedIndex] ? pick.options[pick.selectedIndex].textContent : 'Level',
          musicName: '',
          script: '',
        });
        renderCollectionOrder();
        setLvlColMsg('');
      });
    }
    const addCurrent = document.getElementById('lvlColAddCurrent');
    if (addCurrent && !addCurrent.dataset.bound) {
      addCurrent.dataset.bound = '1';
      addCurrent.addEventListener('click', function () {
        if (!window.SkyHopSaveLevelDraft) return;
        Promise.resolve(window.SkyHopSaveLevelDraft()).then(function (id) {
          if (!id) {
            setLvlColMsg('Save this level before adding it.');
            return;
          }
          const titleEl = document.getElementById('lvlEdTitle');
          collectionStages.push({
            levelId: id,
            title: titleEl && titleEl.value.trim() ? titleEl.value.trim() : 'Level',
            musicName: '',
            script: '',
          });
          renderCollectionOrder();
          loadEditorLevels();
          setLvlColMsg('Added this level.');
        }).catch(function (e) { setLvlColMsg(e.message); });
      });
    }
    const save = document.getElementById('lvlColSave');
    if (save && !save.dataset.bound) save.dataset.bound = '1', save.addEventListener('click', function () { saveEditorCollection(false); });
    const pub = document.getElementById('lvlColPublish');
    if (pub && !pub.dataset.bound) pub.dataset.bound = '1', pub.addEventListener('click', function () { saveEditorCollection(true); });
  }

  function loadOwnerLists() {
    if (!token()) return;
    api('/api/owner/announcements')
      .then(function (data) {
        const list = document.getElementById('ownerAnnounceList');
        if (!list) return;
        list.innerHTML = '';
        (data.announcements || []).forEach(function (row) {
          const li = document.createElement('li');
          li.textContent = row.text + ' ';
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'text-rose-300';
          del.textContent = 'Delete';
          del.addEventListener('click', function () {
            api('/api/owner/announcements', { method: 'POST', body: JSON.stringify({ deleteId: row.id }) }).then(loadOwnerLists);
          });
          li.appendChild(del);
          list.appendChild(li);
        });
      })
      .catch(function () {});
    api('/api/owner/warnings')
      .then(function (data) {
        const list = document.getElementById('ownerWarnList');
        if (!list) return;
        list.innerHTML = '';
        (data.warnings || []).forEach(function (row) {
          const li = document.createElement('li');
          li.textContent = (row.username || '') + ': ' + row.text + ' ';
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'text-rose-300';
          del.textContent = 'Delete';
          del.addEventListener('click', function () {
            api('/api/owner/warnings', { method: 'POST', body: JSON.stringify({ deleteId: row.id }) }).then(loadOwnerLists);
          });
          li.appendChild(del);
          list.appendChild(li);
        });
      })
      .catch(function () {});
  }

  function bind() {
    const next = document.getElementById('noticeNext');
    if (next) next.addEventListener('click', ackCurrent);
    const polls = document.getElementById('btnOpenPolls');
    if (polls) polls.addEventListener('click', function () { openScreen('screenPolls'); loadPolls(); });
    const closePolls = document.getElementById('btnClosePolls');
    if (closePolls) closePolls.addEventListener('click', function () { closeScreen('screenPolls'); });
    const create = document.getElementById('btnCreatePoll');
    if (create) create.addEventListener('click', function () {
      const options = String(document.getElementById('pollOptions').value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      api('/api/polls', {
        method: 'POST',
        body: JSON.stringify({ question: document.getElementById('pollQuestion').value, options: options }),
      }).then(function (data) {
        setMsg('pollMsg', '');
        renderPolls(data);
      }).catch(function (e) { setMsg('pollMsg', e.message); });
    });
    const cols = document.getElementById('btnOpenCollections');
    if (cols) cols.addEventListener('click', function () { openScreen('screenCollections'); searchCollections(); });
    const closeCols = document.getElementById('btnCloseCollections');
    if (closeCols) closeCols.addEventListener('click', function () { closeScreen('screenCollections'); });
    const search = document.getElementById('colSearch');
    if (search) search.addEventListener('input', searchCollections);
    bindEditorCollection();
    const addA = document.getElementById('ownerBtnAddAnnounce');
    if (addA) addA.addEventListener('click', function () {
      api('/api/owner/announcements', { method: 'POST', body: JSON.stringify({ text: document.getElementById('ownerAnnounceText').value }) })
        .then(loadOwnerLists)
        .catch(function (e) { alert(e.message); });
    });
    const addW = document.getElementById('ownerBtnAddWarn');
    if (addW) addW.addEventListener('click', function () {
      api('/api/owner/warnings', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('ownerWarnUser').value,
          text: document.getElementById('ownerWarnText').value,
        }),
      }).then(loadOwnerLists).catch(function (e) { alert(e.message); });
    });
    const stats = document.getElementById('ownerBtnSaveStats');
    if (stats) stats.addEventListener('click', function () {
      api('/api/owner/stats', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('ownerStatUser').value,
          bestTimeMs: document.getElementById('ownerStatBest').value,
          runCount: document.getElementById('ownerStatRuns').value,
          totalDeaths: document.getElementById('ownerStatDeaths').value,
        }),
      }).then(function () { alert('Account stats saved.'); }).catch(function (e) { alert(e.message); });
    });
    const chat = document.getElementById('ownerBtnOpenChat');
    if (chat) chat.addEventListener('click', function () {
      const name = document.getElementById('ownerChatUser').value.trim();
      const screen = document.getElementById('screenFriends');
      const peer = document.getElementById('friendChatPeer');
      const load = document.getElementById('friendChatLoad');
      if (screen) {
        screen.classList.remove('hidden');
        screen.classList.add('flex');
      }
      if (peer) peer.value = name;
      if (load) load.click();
    });
    window.addEventListener('skyhop-auth-changed', function () {
      pullNotices();
      loadOwnerLists();
    });
    setInterval(flushPlayTime, 5000);
    setInterval(paintPlayTime, 1000);
    setInterval(maybeJoinRaces, 20000);
    pullNotices();
    bindMusic();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
