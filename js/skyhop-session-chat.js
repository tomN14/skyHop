/**
 * Shared lobby / in-run chat for races and collabs.
 */
(function () {
  var sendFn = null;
  var moderateFn = null;
  var open = false;

  function el(id) {
    return document.getElementById(id);
  }

  function myRole() {
    var me = window.__skyhopLastMe;
    return me && me.role ? me.role : 'player';
  }

  function isStaff() {
    var role = myRole();
    return role === 'moderator' || role === 'admin' || role === 'owner';
  }

  function canReveal() {
    var role = myRole();
    return role === 'owner' || role === 'admin';
  }

  function dock() {
    return el('sessionChatDock');
  }

  function logEl() {
    return el('sessionChatLog');
  }

  function setOpen(v) {
    open = !!v;
    var box = el('sessionChatBox');
    var tog = el('sessionChatToggle');
    if (box) box.classList.toggle('hidden', !open);
    if (tog) tog.setAttribute('aria-expanded', open ? 'true' : 'false');
    syncStaffUi();
    if (open) {
      var inp = el('sessionChatInput');
      if (inp) setTimeout(function () {
        try {
          inp.focus();
        } catch {
          /* */
        }
      }, 0);
    }
  }

  function syncStaffUi() {
    var btn = el('sessionChatAsMod');
    if (btn) btn.classList.toggle('hidden', !isStaff());
  }

  function fillRow(li, row) {
    li.textContent = '';
    if (row && row.id) li.setAttribute('data-id', String(row.id));
    else li.removeAttribute('data-id');
    li.className = 'break-words text-[11px] leading-snug ' + (row && (row.staff || row.modAlias) ? 'text-emerald-200' : 'text-slate-200');

    var name = document.createElement(row && row.modAlias && canReveal() && row.moderatorUsername ? 'button' : 'span');
    name.className = 'font-semibold ' + (row && row.modAlias ? 'text-emerald-300' : 'text-amber-200/90');
    name.textContent = (row && row.from) || 'Player';
    if (name.tagName === 'BUTTON') {
      name.type = 'button';
      name.className += ' underline decoration-dotted';
      name.title = 'Show who posted this';
      name.addEventListener('click', function () {
        var note = li.querySelector('[data-mod-who]');
        if (note) {
          note.remove();
          return;
        }
        note = document.createElement('span');
        note.setAttribute('data-mod-who', '1');
        note.className = 'ml-1 text-[10px] font-normal text-slate-400';
        note.textContent = 'Posted by ' + row.moderatorUsername;
        name.after(note);
      });
    }
    li.appendChild(name);

    var body = document.createElement('span');
    body.setAttribute('data-body', '1');
    body.textContent = ': ' + ((row && row.text) || '');
    li.appendChild(body);
    if (row && row.edited) {
      var edited = document.createElement('span');
      edited.className = 'text-slate-500';
      edited.textContent = ' (edited)';
      li.appendChild(edited);
    }

    if (isStaff() && row && row.id && typeof moderateFn === 'function') {
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ml-2 text-[10px] font-semibold text-amber-200/80 hover:text-white';
      edit.textContent = 'Edit';
      edit.addEventListener('click', function () {
        var next = window.prompt('Edit message', row.text || '');
        if (next == null) return;
        next = String(next).trim();
        if (!next) return;
        moderateFn('chatEdit', { id: row.id, text: next });
      });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ml-1 text-[10px] font-semibold text-rose-300/90 hover:text-white';
      del.textContent = 'Delete';
      del.addEventListener('click', function () {
        if (!window.confirm('Delete this message?')) return;
        moderateFn('chatDelete', { id: row.id });
      });
      li.appendChild(edit);
      li.appendChild(del);
    }
  }

  function appendRow(row) {
    var log = logEl();
    if (!log || !row) return;
    var empty = log.querySelector('[data-empty]');
    if (empty) empty.remove();
    var li = document.createElement('li');
    fillRow(li, row);
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  }

  function updateRow(row) {
    var log = logEl();
    if (!log || !row || !row.id) return;
    var li = log.querySelector('li[data-id="' + String(row.id).replace(/"/g, '') + '"]');
    if (!li) {
      appendRow(row);
      return;
    }
    fillRow(li, row);
  }

  function removeRow(id) {
    var log = logEl();
    if (!log || !id) return;
    var li = log.querySelector('li[data-id="' + String(id).replace(/"/g, '') + '"]');
    if (li) li.remove();
    if (!log.children.length) {
      log.innerHTML = '<li data-empty class="text-slate-500">No messages yet.</li>';
    }
  }

  function clearLog() {
    var log = logEl();
    if (!log) return;
    log.innerHTML = '<li data-empty class="text-slate-500">No messages yet.</li>';
  }

  function showDock(on) {
    var d = dock();
    if (!d) return;
    d.classList.toggle('hidden', !on);
    if (!on) {
      setOpen(false);
      clearLog();
    }
  }

  function sendText(asMod) {
    var inp = el('sessionChatInput');
    var text = inp && inp.value ? String(inp.value).trim() : '';
    if (!text) return;
    if (typeof sendFn === 'function') sendFn(text, !!asMod);
    if (inp) inp.value = '';
  }

  function bind() {
    var tog = el('sessionChatToggle');
    var form = el('sessionChatForm');
    var close = el('sessionChatClose');
    var asMod = el('sessionChatAsMod');
    if (tog) {
      tog.addEventListener('click', function () {
        setOpen(!open);
      });
    }
    if (close) {
      close.addEventListener('click', function () {
        setOpen(false);
      });
    }
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        sendText(false);
      });
    }
    if (asMod) {
      asMod.addEventListener('click', function () {
        sendText(true);
      });
    }
  }

  window.SkyHopSessionChat = {
    attach: function (fn, moderate) {
      sendFn = typeof fn === 'function' ? fn : null;
      moderateFn = typeof moderate === 'function' ? moderate : null;
      showDock(!!sendFn);
      syncStaffUi();
      if (sendFn) setOpen(false);
    },
    detach: function () {
      sendFn = null;
      moderateFn = null;
      showDock(false);
    },
    push: function (row) {
      appendRow(row);
    },
    update: function (row) {
      updateRow(row);
    },
    remove: function (id) {
      removeRow(id);
    },
    load: function (rows) {
      clearLog();
      if (!rows || !rows.length) return;
      for (var i = 0; i < rows.length; i++) appendRow(rows[i]);
    },
    visible: function () {
      var d = dock();
      return !!(d && !d.classList.contains('hidden'));
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
