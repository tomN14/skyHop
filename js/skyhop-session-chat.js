/**
 * Shared lobby / in-run chat for races and collabs.
 */
(function () {
  var sendFn = null;
  var open = false;

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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

  function appendRow(row) {
    var log = logEl();
    if (!log || !row) return;
    var empty = log.querySelector('[data-empty]');
    if (empty) empty.remove();
    var li = document.createElement('li');
    li.className = 'break-words text-[11px] leading-snug ' + (row.staff ? 'text-emerald-200' : 'text-slate-200');
    li.innerHTML =
      '<span class="font-semibold text-amber-200/90">' +
      escapeHtml(row.from || 'Player') +
      ':</span> ' +
      escapeHtml(row.text || '');
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
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

  function bind() {
    var tog = el('sessionChatToggle');
    var form = el('sessionChatForm');
    var close = el('sessionChatClose');
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
        var inp = el('sessionChatInput');
        var text = inp && inp.value ? String(inp.value).trim() : '';
        if (!text) return;
        if (typeof sendFn === 'function') sendFn(text);
        if (inp) inp.value = '';
      });
    }
  }

  window.SkyHopSessionChat = {
    attach: function (fn) {
      sendFn = typeof fn === 'function' ? fn : null;
      showDock(!!sendFn);
      if (sendFn) setOpen(false);
    },
    detach: function () {
      sendFn = null;
      showDock(false);
    },
    push: function (row) {
      appendRow(row);
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
