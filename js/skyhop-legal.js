(function () {
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(label, className, onClick) {
    var btn = el('button', className || '', label);
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
  }

  function field(label, value, type) {
    var wrap = el('label', 'mt-2 block text-[11px] text-slate-500', label);
    var input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type || 'text';
    else input.rows = 3;
    input.className = 'mt-0.5 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-white';
    if (value != null) input.value = value;
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  function getToken() {
    try {
      return localStorage.getItem('SKYHOP_AUTH_TOKEN') || '';
    } catch {
      return '';
    }
  }

  function api(path, opts) {
    if (typeof window.SkyHopApiRequest !== 'function') return Promise.reject(new Error('API not ready'));
    var options = opts || {};
    var headers = Object.assign({ Authorization: 'Bearer ' + getToken() }, options.headers || {});
    return window.SkyHopApiRequest(path, Object.assign({}, options, { headers: headers }));
  }

  function setMsg(text, bad) {
    var msg = document.getElementById('legalMsg');
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'text-sm ' + (bad ? 'text-rose-300' : 'text-emerald-200');
  }

  function post(body) {
    return api('/api/legal', { method: 'POST', body: JSON.stringify(body) })
      .then(function () {
        return load();
      })
      .catch(function (err) {
        setMsg(String(err.message || err), true);
      });
  }

  function companyOptions(companies, yoursOnly) {
    return (companies || []).filter(function (c) {
      return yoursOnly ? c.yours : true;
    });
  }

  function render(data) {
    var body = document.getElementById('legalBody');
    if (!body) return;
    body.textContent = '';
    var msg = el('p', 'text-sm text-emerald-200', '');
    msg.id = 'legalMsg';
    body.appendChild(msg);
    body.appendChild(
      el(
        'p',
        'text-[11px] text-slate-500',
        'Companies can partner, sign contracts, hire law firms, and sue. Moderators judge cases. Contracts are not auto-enforced.'
      )
    );

    var yours = companyOptions(data.companies, true);
    if (!yours.length) {
      body.appendChild(el('p', 'mt-4 text-sm text-slate-400', 'Register a company first to use partnerships and courts.'));
    }

    var partner = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    partner.appendChild(el('h3', 'text-sm font-semibold text-white', 'Propose a partnership'));
    var fromP = field('Your company id', yours[0] ? yours[0].id : '', 'text');
    var toP = field('Other company id', '', 'text');
    var termsP = field('Terms', '', 'textarea');
    var daysP = field('Duration in days', '30', 'number');
    partner.appendChild(fromP.wrap);
    partner.appendChild(toP.wrap);
    partner.appendChild(termsP.wrap);
    partner.appendChild(daysP.wrap);
    partner.appendChild(
      button('Send partnership', 'mt-3 rounded-xl bg-amber-700 px-3 py-2 text-sm font-semibold text-white', function () {
        post({
          action: 'proposePartnership',
          fromCompanyId: fromP.input.value,
          toCompanyId: toP.input.value,
          terms: termsP.input.value,
          durationDays: Number(daysP.input.value),
        });
      })
    );
    body.appendChild(partner);

    (data.partnerships || []).forEach(function (row) {
      var card = el('section', 'mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-3');
      card.appendChild(
        el(
          'p',
          'text-xs text-slate-200',
          row.fromName + ' → ' + row.toName + ' · ' + row.status + (row.exclusivity ? ' · exclusive' : '')
        )
      );
      card.appendChild(el('p', 'mt-1 text-[11px] text-slate-400', row.terms || ''));
      if (row.status === 'proposed') {
        var rowBtns = el('div', 'mt-2 flex flex-wrap gap-2');
        rowBtns.appendChild(
          button('Accept', 'rounded-lg bg-emerald-700 px-2 py-1 text-[11px] text-white', function () {
            post({ action: 'respondPartnership', id: row.id, response: 'accept' });
          })
        );
        rowBtns.appendChild(
          button('Reject', 'rounded-lg border border-white/15 px-2 py-1 text-[11px] text-slate-200', function () {
            post({ action: 'respondPartnership', id: row.id, response: 'reject' });
          })
        );
        card.appendChild(rowBtns);
      }
      body.appendChild(card);
    });

    var contract = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    contract.appendChild(el('h3', 'text-sm font-semibold text-white', 'Send a contract'));
    var fromC = field('Your company id', yours[0] ? yours[0].id : '', 'text');
    var toC = field('Other company id', '', 'text');
    var titleC = field('Title', 'Service contract', 'text');
    var termsC = field('Terms', '', 'textarea');
    var payC = field('Payment', '0', 'number');
    contract.appendChild(fromC.wrap);
    contract.appendChild(toC.wrap);
    contract.appendChild(titleC.wrap);
    contract.appendChild(termsC.wrap);
    contract.appendChild(payC.wrap);
    contract.appendChild(
      button('Send contract', 'mt-3 rounded-xl bg-amber-700 px-3 py-2 text-sm font-semibold text-white', function () {
        post({
          action: 'createContract',
          fromCompanyId: fromC.input.value,
          toCompanyId: toC.input.value,
          title: titleC.input.value,
          terms: termsC.input.value,
          payment: Number(payC.input.value),
        });
      })
    );
    body.appendChild(contract);

    (data.contracts || []).forEach(function (row) {
      var card = el('section', 'mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-3');
      card.appendChild(el('p', 'text-xs text-slate-200', row.title + ' · ' + row.fromName + ' → ' + row.toName + ' · ' + row.status));
      card.appendChild(el('p', 'mt-1 text-[11px] text-slate-400', row.terms || ''));
      if (row.status === 'proposed') {
        var rowBtns = el('div', 'mt-2 flex flex-wrap gap-2');
        rowBtns.appendChild(
          button('Accept', 'rounded-lg bg-emerald-700 px-2 py-1 text-[11px] text-white', function () {
            post({ action: 'respondContract', id: row.id, response: 'accept' });
          })
        );
        rowBtns.appendChild(
          button('Reject', 'rounded-lg border border-white/15 px-2 py-1 text-[11px] text-slate-200', function () {
            post({ action: 'respondContract', id: row.id, response: 'reject' });
          })
        );
        card.appendChild(rowBtns);
      }
      body.appendChild(card);
    });

    var suit = el('section', 'mt-4 rounded-2xl border border-rose-500/30 bg-slate-900/60 p-4');
    suit.appendChild(el('h3', 'text-sm font-semibold text-white', 'File a lawsuit'));
    var fromS = field('Your company id', yours[0] ? yours[0].id : '', 'text');
    var toS = field('Defendant company id', '', 'text');
    var reasonS = field('Reason', '', 'textarea');
    suit.appendChild(fromS.wrap);
    suit.appendChild(toS.wrap);
    suit.appendChild(reasonS.wrap);
    suit.appendChild(
      button('File lawsuit', 'mt-3 rounded-xl bg-rose-700 px-3 py-2 text-sm font-semibold text-white', function () {
        post({
          action: 'fileSuit',
          plaintiffCompanyId: fromS.input.value,
          defendantCompanyId: toS.input.value,
          reason: reasonS.input.value,
        });
      })
    );
    body.appendChild(suit);

    (data.suits || []).forEach(function (row) {
      var card = el('section', 'mt-3 rounded-xl border border-rose-500/20 bg-slate-950/70 p-3');
      card.appendChild(
        el(
          'p',
          'text-xs text-slate-200',
          row.plaintiffName + ' v. ' + row.defendantName + ' · ' + row.status + (row.judgeUsername ? ' · judge ' + row.judgeUsername : '')
        )
      );
      card.appendChild(el('p', 'mt-1 text-[11px] text-slate-400', row.reason || ''));
      if (row.verdict) {
        card.appendChild(
          el('p', 'mt-1 text-[11px] text-amber-200', 'Verdict: ' + row.verdict + (row.compensation ? ' · ' + row.compensation + ' coins' : ''))
        );
        card.appendChild(el('p', 'mt-1 text-[11px] text-slate-400', row.verdictReason || ''));
      }
      var evidence = field('Add evidence', '', 'textarea');
      card.appendChild(evidence.wrap);
      card.appendChild(
        button('Submit evidence (plaintiff)', 'mt-2 rounded-lg border border-white/15 px-2 py-1 text-[11px] text-slate-200', function () {
          post({ action: 'addEvidence', suitId: row.id, side: 'plaintiff', text: evidence.input.value });
        })
      );
      card.appendChild(
        button('Submit evidence (defendant)', 'ml-2 mt-2 rounded-lg border border-white/15 px-2 py-1 text-[11px] text-slate-200', function () {
          post({ action: 'addEvidence', suitId: row.id, side: 'defendant', text: evidence.input.value });
        })
      );
      if ((data.lawFirms || []).length) {
        var firmId = field('Law firm id', data.lawFirms[0].id, 'text');
        card.appendChild(firmId.wrap);
        card.appendChild(
          button('Hire for plaintiff', 'mt-2 rounded-lg bg-sky-800 px-2 py-1 text-[11px] text-white', function () {
            post({ action: 'hireFirm', suitId: row.id, side: 'plaintiff', firmCompanyId: firmId.input.value });
          })
        );
      }
      var me = window.__skyhopLastMe;
      if (me && (me.role === 'owner' || me.role === 'admin' || me.role === 'moderator' || me.adminPowers)) {
        card.appendChild(
          button('Take as judge', 'mt-2 rounded-lg bg-amber-700 px-2 py-1 text-[11px] text-white', function () {
            post({ action: 'claimJudge', suitId: row.id });
          })
        );
        var verdict = field('Verdict reason', '', 'textarea');
        var pay = field('Compensation', '0', 'number');
        card.appendChild(verdict.wrap);
        card.appendChild(pay.wrap);
        card.appendChild(
          button('Dismiss', 'mt-2 rounded-lg border border-white/15 px-2 py-1 text-[11px] text-slate-200', function () {
            post({ action: 'verdict', suitId: row.id, verdict: 'dismiss', reason: verdict.input.value });
          })
        );
        card.appendChild(
          button('Compensate', 'ml-2 mt-2 rounded-lg bg-emerald-700 px-2 py-1 text-[11px] text-white', function () {
            post({
              action: 'verdict',
              suitId: row.id,
              verdict: 'compensate',
              reason: verdict.input.value,
              compensation: Number(pay.input.value),
            });
          })
        );
      }
      if (row.status === 'closed' || row.status === 'dismissed') {
        card.appendChild(
          button('Appeal', 'mt-2 rounded-lg border border-amber-400/40 px-2 py-1 text-[11px] text-amber-100', function () {
            post({ action: 'appeal', suitId: row.id, companyId: row.plaintiffCompanyId, reason: 'Appeal' });
          })
        );
      }
      body.appendChild(card);
    });
  }

  function load() {
    return api('/api/legal')
      .then(render)
      .catch(function (err) {
        setMsg(String(err.message || err), true);
      });
  }

  function openLegal() {
    var screen = document.getElementById('screenLegal');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    load();
  }

  function closeLegal() {
    var screen = document.getElementById('screenLegal');
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
  }

  function bind() {
    var fab = document.getElementById('btnLegalFab');
    var close = document.getElementById('btnLegalClose');
    if (fab && !fab.dataset.bound) {
      fab.dataset.bound = '1';
      fab.addEventListener('click', openLegal);
    }
    if (close && !close.dataset.bound) {
      close.dataset.bound = '1';
      close.addEventListener('click', closeLegal);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
