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

  function parseStages(text, extraScript) {
    return String(text || '')
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean)
      .map(function (line) {
        const parts = line.split('|');
        return {
          levelId: (parts[0] || '').trim(),
          title: (parts[1] || '').trim(),
          musicName: (parts[2] || '').trim(),
          script: [(parts[3] || '').trim(), extraScript || ''].filter(Boolean).join('\n'),
        };
      });
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
    api('/api/collections', { method: 'POST', body: JSON.stringify({ id: bag.id, clearStage: index }) }).catch(function () {});
  };

  function playCollection(id) {
    api('/api/collections?id=' + encodeURIComponent(id))
      .then(function (col) {
        const stages = col.stages || [];
        return Promise.all(stages.map(function (stage) {
          return fetch('/api/levels/' + encodeURIComponent(stage.levelId)).then(function (res) { return res.json(); });
        })).then(function (rows) {
          const playable = rows.map(function (row, index) {
            const data = JSON.parse(JSON.stringify(row.data || {}));
            const meta = stages[index] || {};
            data.musicName = meta.musicName || data.musicName || '';
            const scripts = [col.sharedScript || '', meta.script || '', data.script || ''].filter(Boolean);
            if (scripts.length) data.script = scripts.join('\n');
            return data;
          });
          window.__skyhopCollection = { id: col.id, length: playable.length, yours: !!col.yours };
          closeScreen('screenCollections');
          if (window.SKYHOP && window.SKYHOP.startUserLevel) {
            window.SKYHOP.startUserLevel(playable, {
              mode: 'play',
              hudTitle: col.title,
              levelTitle: col.title,
              onContinue: function () {
                window.__skyhopCollection = null;
              },
            });
          }
        });
      })
      .catch(function (e) { setMsg('colMsg', e.message); });
  }

  function saveCollection(publish) {
    const stages = parseStages(
      document.getElementById('colStages') && document.getElementById('colStages').value,
      document.getElementById('colStageScript') && document.getElementById('colStageScript').value
    );
    api('/api/collections', {
      method: 'POST',
      body: JSON.stringify({
        id: collectionDraftId || undefined,
        title: document.getElementById('colTitle') && document.getElementById('colTitle').value,
        stages: stages,
        sharedScript: document.getElementById('colShared') && document.getElementById('colShared').value,
        publish: !!publish,
      }),
    })
      .then(function (row) {
        collectionDraftId = row.id;
        setMsg('colMsg', publish ? 'Published.' : 'Draft saved. Beat every stage, then publish.');
        searchCollections();
      })
      .catch(function (e) { setMsg('colMsg', e.message); });
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
    const save = document.getElementById('btnSaveCollection');
    if (save) save.addEventListener('click', function () { saveCollection(false); });
    const pub = document.getElementById('btnPublishCollection');
    if (pub) pub.addEventListener('click', function () { saveCollection(true); });
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
