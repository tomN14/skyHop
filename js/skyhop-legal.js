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

  function partyCompanyId(row, yours) {
    var yoursIds = {};
    (yours || []).forEach(function (c) {
      yoursIds[String(c.id)] = true;
    });
    if (yoursIds[String(row.fromCompanyId)]) return row.fromCompanyId;
    if (yoursIds[String(row.toCompanyId)]) return row.toCompanyId;
    return yours[0] ? yours[0].id : '';
  }

  function dealTimingLine(row) {
    var days = Number(row.durationDays);
    var ends = Number(row.endsAt);
    var parts = [];
    if (Number.isFinite(days) && days > 0) parts.push(days + ' day' + (days === 1 ? '' : 's'));
    if (Number.isFinite(ends) && ends > 0) {
      parts.push((row.status === 'expired' || Date.now() >= ends ? 'ended' : 'ends') + ' ' + new Date(ends).toLocaleString());
    }
    return parts.length ? parts.join(' · ') : '';
  }

  function mountActiveDealTools(card, dealKind, row, yours) {
    var timing = dealTimingLine(row);
    if (timing) card.appendChild(el('p', 'mt-1 text-[11px] text-slate-500', timing));
    if (!row || row.status === 'expired') {
      card.appendChild(
        el('p', 'mt-2 text-[11px] text-rose-300', 'Expired — messaging and payments are closed.')
      );
      return;
    }
    if (row.status !== 'active') return;
    var thread = el('div', 'mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/80 p-2');
    var messages = row.messages || [];
    if (!messages.length) {
      thread.appendChild(el('p', 'text-[11px] text-slate-500', 'No messages yet.'));
    } else {
      messages.forEach(function (m) {
        var line =
          (m.kind === 'payment' ? '💳 ' : '') +
          (m.companyName || 'Company') +
          (m.username ? ' · ' + m.username : '') +
          (m.kind === 'payment' && m.amount ? ' · ' + m.amount + ' coins' : '') +
          ': ' +
          (m.text || '');
        thread.appendChild(el('p', 'text-[11px] ' + (m.kind === 'payment' ? 'text-emerald-200' : 'text-slate-300'), line));
      });
    }
    card.appendChild(el('p', 'mt-3 text-[11px] font-semibold text-amber-200/90', 'Messages & payments'));
    card.appendChild(thread);

    var companyId = partyCompanyId(row, yours);
    var msg = field('Message the other company', '', 'textarea');
    card.appendChild(msg.wrap);
    card.appendChild(
      button('Send message', 'mt-2 rounded-lg border border-amber-400/40 px-2 py-1 text-[11px] font-semibold text-amber-100', function () {
        post({
          action: 'sendDealMessage',
          kind: dealKind,
          id: row.id,
          companyId: companyId,
          text: msg.input.value,
        });
      })
    );

    var amount = field('Pay from your company cash', '100', 'number');
    var auth = field('Your auth code', '', 'text');
    var note = field('Payment note (optional)', '', 'text');
    card.appendChild(amount.wrap);
    card.appendChild(auth.wrap);
    card.appendChild(note.wrap);
    card.appendChild(
      el('p', 'mt-1 text-[11px] text-slate-500', 'Payment uses your company cash and burns your one-time auth code.')
    );
    card.appendChild(
      button('Send payment', 'mt-2 rounded-lg bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white', function () {
        post({
          action: 'sendDealPayment',
          kind: dealKind,
          id: row.id,
          companyId: companyId,
          amount: Number(amount.input.value),
          authCode: auth.input.value,
          note: note.input.value,
        });
      })
    );
  }

  function mountCompanySearch(parent, companies, targetInput, label) {
    parent.appendChild(el('p', 'mt-2 text-[11px] font-semibold text-slate-300', label || 'Find a company'));
    var search = field('Name or ticker', '', 'text');
    search.input.placeholder = 'Type to find company id';
    parent.appendChild(search.wrap);
    parent.appendChild(
      el('p', 'mt-1 text-[11px] text-slate-500', 'Shows company id only. Auth codes are never listed in search.')
    );
    var hits = el('div', 'mt-2 space-y-1');
    parent.appendChild(hits);
    function paint() {
      hits.textContent = '';
      var q = search.input.value.trim().toLowerCase();
      if (!q) return;
      var list = (companies || [])
        .filter(function (c) {
          return (
            String(c.name || '').toLowerCase().indexOf(q) !== -1 ||
            String(c.ticker || '').toLowerCase().indexOf(q) !== -1 ||
            String(c.id || '').toLowerCase() === q
          );
        })
        .slice(0, 8);
      if (!list.length) {
        hits.appendChild(el('p', 'text-[11px] text-slate-500', 'No companies match.'));
        return;
      }
      list.forEach(function (c) {
        var row = el('button', 'block w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5 text-left hover:bg-white/5');
        row.type = 'button';
        row.appendChild(
          el('p', 'text-xs text-slate-200', c.name + (c.ticker ? ' · ' + c.ticker : '') + ' · ' + c.kind + (c.yours ? ' · yours' : ''))
        );
        row.appendChild(el('p', 'mt-0.5 font-mono text-[10px] text-sky-200/90', 'id ' + c.id));
        row.addEventListener('click', function () {
          if (targetInput) targetInput.value = c.id;
          search.input.value = c.name;
          paint();
          setMsg('Filled company id for ' + c.name + '.', false);
        });
        hits.appendChild(row);
      });
    }
    search.input.addEventListener('input', paint);
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

    var findCard = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    findCard.appendChild(el('h3', 'text-sm font-semibold text-white', 'Find a company id'));
    var findTarget = field('Selected company id', '', 'text');
    mountCompanySearch(findCard, data.companies, findTarget.input, 'Search by name or ticker');
    findCard.appendChild(findTarget.wrap);
    body.appendChild(findCard);

    var partner = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    partner.appendChild(el('h3', 'text-sm font-semibold text-white', 'Propose a partnership'));
    var fromP = field('Your company id', yours[0] ? yours[0].id : '', 'text');
    var toP = field('Other company id', '', 'text');
    var termsP = field('Terms', '', 'textarea');
    var daysP = field('Duration in days', '30', 'number');
    partner.appendChild(fromP.wrap);
    mountCompanySearch(partner, data.companies, toP.input, 'Find other company');
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
      mountActiveDealTools(card, 'partnership', row, yours);
      body.appendChild(card);
    });

    var contract = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    contract.appendChild(el('h3', 'text-sm font-semibold text-white', 'Send a contract'));
    var fromC = field('Your company id', yours[0] ? yours[0].id : '', 'text');
    var toC = field('Other company id', '', 'text');
    var titleC = field('Title', 'Service contract', 'text');
    var termsC = field('Terms', '', 'textarea');
    var payC = field('Payment', '0', 'number');
    var daysC = field('Duration in days', '30', 'number');
    contract.appendChild(fromC.wrap);
    mountCompanySearch(contract, data.companies, toC.input, 'Find other company');
    contract.appendChild(toC.wrap);
    contract.appendChild(titleC.wrap);
    contract.appendChild(termsC.wrap);
    contract.appendChild(payC.wrap);
    contract.appendChild(daysC.wrap);
    contract.appendChild(
      el('p', 'mt-1 text-[11px] text-slate-500', 'After accept, messaging and payments stay open until this duration ends.')
    );
    contract.appendChild(
      button('Send contract', 'mt-3 rounded-xl bg-amber-700 px-3 py-2 text-sm font-semibold text-white', function () {
        post({
          action: 'createContract',
          fromCompanyId: fromC.input.value,
          toCompanyId: toC.input.value,
          title: titleC.input.value,
          terms: termsC.input.value,
          payment: Number(payC.input.value),
          durationDays: Number(daysC.input.value),
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
      mountActiveDealTools(card, 'contract', row, yours);
      body.appendChild(card);
    });

    var suit = el('section', 'mt-4 rounded-2xl border border-rose-500/30 bg-slate-900/60 p-4');
    suit.appendChild(el('h3', 'text-sm font-semibold text-white', 'File a lawsuit'));
    var fromS = field('Your company id', yours[0] ? yours[0].id : '', 'text');
    var authS = field('Your auth code', '', 'text');
    var toS = field('Defendant company id', '', 'text');
    var reasonS = field('Reason', '', 'textarea');
    suit.appendChild(fromS.wrap);
    suit.appendChild(authS.wrap);
    suit.appendChild(
      el('p', 'mt-1 text-[11px] text-slate-500', 'Use your company’s one-time auth code from Economy. It regenerates after filing.')
    );
    mountCompanySearch(suit, data.companies, toS.input, 'Find defendant company');
    suit.appendChild(toS.wrap);
    suit.appendChild(reasonS.wrap);
    suit.appendChild(
      button('File lawsuit', 'mt-3 rounded-xl bg-rose-700 px-3 py-2 text-sm font-semibold text-white', function () {
        post({
          action: 'fileSuit',
          plaintiffCompanyId: fromS.input.value,
          defendantCompanyId: toS.input.value,
          authCode: authS.input.value,
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
