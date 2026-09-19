/**
 * Custom keybinds (localStorage). Used by skyhop-game.js via window.SkyHopKeybinds.
 */
(function () {
  const LS = 'SKYHOP_KEYBINDS';
  const DEFAULTS = {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    jump: 'Space',
    grapple: 'ShiftLeft',
    sword: 'KeyS',
    shield: 'KeyB',
  };
  const LABELS = {
    left: 'Move left',
    right: 'Move right',
    jump: 'Jump',
    grapple: 'Grapple (hold / release)',
    sword: 'Wooden sword',
    shield: 'Shield',
  };

  function loadRaw() {
    try {
      const j = JSON.parse(localStorage.getItem(LS) || 'null');
      if (j && typeof j === 'object') return Object.assign({}, DEFAULTS, j);
    } catch {
      /* */
    }
    return Object.assign({}, DEFAULTS);
  }

  let binds = loadRaw();
  let listeningAction = null;

  function codeLabel(code) {
    if (!code) return '—';
    if (code === 'Space') return 'Space';
    if (code.startsWith('Arrow')) return code.replace('Arrow', '');
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Shift')) return 'Shift';
    if (code.startsWith('Control')) return 'Ctrl';
    if (code.startsWith('Alt')) return 'Alt';
    return code;
  }

  function save() {
    try {
      localStorage.setItem(LS, JSON.stringify(binds));
    } catch {
      /* */
    }
    window.dispatchEvent(new CustomEvent('skyhop-keybinds-changed'));
  }

  function getBinds() {
    return Object.assign({}, binds);
  }

  function isCodeDown(codes, codeMap) {
    if (!code) return false;
    if (code.startsWith('Shift')) {
      return !!(codeMap['ShiftLeft'] || codeMap['ShiftRight'] || codeMap.Shift);
    }
    return !!codeMap[code];
  }

  function isActionDown(action, codeMap) {
    const code = binds[action] || DEFAULTS[action];
    return isCodeDown(code, codeMap || {});
  }

  function renderList() {
    var ul = document.getElementById('keybindsList');
    if (!ul) return;
    ul.innerHTML = '';
    Object.keys(LABELS).forEach(function (action) {
      var li = document.createElement('li');
      li.className =
        'flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2';
      var lab = document.createElement('span');
      lab.className = 'text-slate-300';
      lab.textContent = LABELS[action];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'kb-pick min-w-[4.5rem] rounded-lg border border-cyan-500/40 bg-slate-900 px-2 py-1 font-mono text-xs text-cyan-100 hover:bg-cyan-950/50';
      btn.dataset.action = action;
      btn.textContent = listeningAction === action ? 'Press key…' : codeLabel(binds[action]);
      if (listeningAction === action) {
        btn.classList.add('ring-2', 'ring-cyan-400');
      }
      li.appendChild(lab);
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  function bindUi() {
    var fab = document.getElementById('btnKeybindsFab');
    var screen = document.getElementById('screenKeybinds');
    var close = document.getElementById('btnKeybindsClose');
    var reset = document.getElementById('btnKeybindsReset');
    if (fab && screen) {
      fab.addEventListener('click', function () {
        listeningAction = null;
        renderList();
        screen.classList.remove('hidden');
        screen.classList.add('flex');
      });
    }
    if (close && screen) {
      close.addEventListener('click', function () {
        listeningAction = null;
        screen.classList.add('hidden');
        screen.classList.remove('flex');
      });
    }
    if (reset) {
      reset.addEventListener('click', function () {
        binds = Object.assign({}, DEFAULTS);
        save();
        listeningAction = null;
        renderList();
      });
    }
    var list = document.getElementById('keybindsList');
    if (list) {
      list.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.classList || !t.classList.contains('kb-pick')) return;
        listeningAction = t.dataset.action || null;
        renderList();
      });
    }
    window.addEventListener('keydown', function (e) {
      if (!listeningAction) return;
      if (e.code === 'Escape') {
        listeningAction = null;
        renderList();
        return;
      }
      if (['Tab'].includes(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
      binds[listeningAction] = e.code;
      save();
      listeningAction = null;
      renderList();
    });
    renderList();
  }

  window.SkyHopKeybinds = {
    getBinds: getBinds,
    isActionDown: isActionDown,
    codeLabel: codeLabel,
    defaults: DEFAULTS,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUi);
  } else {
    bindUi();
  }
})();
