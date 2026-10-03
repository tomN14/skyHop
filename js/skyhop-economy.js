/**
 * Company registration, stocks, national bank, and bank heists.
 */
(function () {
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

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function field(label, value, type) {
    var wrap = el('label', 'block text-[11px] text-slate-500', label);
    var input = document.createElement('input');
    input.className = 'mt-0.5 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-white';
    input.type = type || 'number';
    if (value != null) input.value = String(value);
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  function button(label, className, onClick) {
    var b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function setNamedMsg(id, text, bad) {
    var msg = document.getElementById(id);
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'mt-2 text-sm ' + (bad ? 'text-rose-300' : 'text-emerald-200');
  }

  function setMsg(text, bad) {
    setNamedMsg('economyMsg', text, bad);
  }

  function setRaceMsg(text, bad) {
    setNamedMsg('racesMsg', text, bad);
  }

  function post(path, body, draw, msgId) {
    if (msgId) setNamedMsg(msgId, '', false);
    else if (draw) setRaceMsg('', false);
    else setMsg('', false);
    var note = '';
    var failed = false;
    function write(text, bad) {
      if (msgId) setNamedMsg(msgId, text, bad);
      else if (draw) setRaceMsg(text, bad);
      else setMsg(text, bad);
    }
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
      .then(function (data) {
        if (data && data.message) note = data.message;
        if (data && data.ok === false) failed = true;
        if (data && data.banned) {
          write(note || 'Banned.', true);
          return null;
        }
        return data && data.view ? data.view : data;
      })
      .then(function (view) {
        if (view) (draw || render)(view);
        if (note) write(note, failed);
      })
      .catch(function (e) {
        write(String(e.message || e), true);
      });
  }

  function money(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) x = 0;
    return '$' + x.toFixed(2);
  }

  function commas(n) {
    var x = Math.round(Number(n) || 0);
    return x.toLocaleString('en-US');
  }

  function pct(n) {
    return (Number(n) * 100).toFixed(2) + '%';
  }

  function tournamentLine(t) {
    var when = 'No start date';
    if (t.startsAt) {
      var d = new Date(t.startsAt);
      when = Number.isNaN(d.getTime()) ? 'No start date' : (t.started ? 'Started ' : 'Starts ') + d.toLocaleString();
    }
    return 'Entry ' + t.fee + ' · prize ' + t.prize + ' · ' + t.entrants + ' entered · ' + when;
  }

  function render(data) {
    var body = document.getElementById('economyBody');
    if (!body || !data || !data.rules) return;
    body.textContent = '';
    var rules = data.rules;
    body.appendChild(
      el(
        'p',
        'text-xs text-slate-400',
        'Register a racing company, a bank, or an insurer for ' +
          rules.registerCost +
          ' coins. Open a company you already own to edit it. Banks, insurers, stocks, races, and the National Bank each have their own button.'
      )
    );
    var msg = el('p', 'mt-2 text-sm text-emerald-200', '');
    msg.id = 'economyMsg';
    body.appendChild(msg);
    if (window.__skyhopLastMe && data.coins != null) {
      window.__skyhopLastMe.coins = data.coins;
      if (data.coinsInfinite != null) window.__skyhopLastMe.coinsInfinite = !!data.coinsInfinite;
      var coinLabel = data.coinsInfinite ? '∞' : String(data.coins);
      var accCoins = document.getElementById('accStatCoins');
      if (accCoins) accCoins.textContent = coinLabel;
      var shopCoins = document.getElementById('shopCoinBalance');
      if (shopCoins) shopCoins.textContent = coinLabel;
    }

    var yours = data.yourCompanies || [];
    var card = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    card.appendChild(el('h3', 'text-sm font-semibold text-white', yours.length ? 'Register another company' : 'Start a company'));
    var name = field('Name', '', 'text');
    name.input.maxLength = 24;
    var kind = el('label', 'mt-2 block text-[11px] text-slate-500', 'Type');
    var select = document.createElement('select');
    select.className = 'mt-0.5 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-white';
    ['racing', 'bank', 'insurance'].forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k === 'racing' ? 'Racing company' : k === 'bank' ? 'Bank' : 'Insurance company';
      select.appendChild(opt);
    });
    kind.appendChild(select);
    card.appendChild(name.wrap);
    card.appendChild(kind);
    card.appendChild(
      button('Register for 1,000 coins', 'mt-3 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white', function () {
        post('/api/economy/register', { name: name.input.value, kind: select.value });
      })
    );
    body.appendChild(card);
    var ownedHost = el('div', '');
    body.appendChild(ownedHost);
    function paintMine(mine) {
      selectedOwnedId = mine.id;
      ownedHost.textContent = '';
      var card = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
      card.appendChild(el('h3', 'text-sm font-semibold text-white', mine.name));
      card.appendChild(
        el(
          'p',
          'mt-1 text-xs text-slate-400',
          mine.kind +
            ' · cash ' +
            mine.cash +
            ' · this week ' +
            mine.weekProfit +
            ' · you hold ' +
            mine.yourShares +
            ' / ' +
            rules.shares +
            ' shares · ' +
            (mine.isPublic ? 'public' : 'private') +
            ' · ' +
            money(mine.shareExact) +
            (mine.ticker ? ' · ' + mine.ticker : '')
        )
      );
      var price = field('Share price in dollars', mine.shareExact);
      var listed = field('Shares listed for sale', mine.listed);
      var ticker = field('Ticker', mine.ticker || '', 'text');
      ticker.input.maxLength = 5;
      ticker.input.placeholder = '1–5 letters or numbers';
      card.appendChild(price.wrap);
      card.appendChild(listed.wrap);
      card.appendChild(ticker.wrap);
      var row = el('div', 'mt-2 flex flex-wrap gap-2');
      row.appendChild(
        button('Save shares', 'rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
          post('/api/economy/company', {
            companyId: mine.id,
            sharePrice: Number(price.input.value),
            listed: Number(listed.input.value),
            ticker: ticker.input.value,
          });
        })
      );
      row.appendChild(
        button(mine.isPublic ? 'Go private' : 'Go public', 'rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200', function () {
          post('/api/economy/company', { companyId: mine.id, isPublic: !mine.isPublic });
        })
      );
      card.appendChild(row);
      if (mine.kind === 'bank') {
        var saveRate = field('Deposit rate (0.012 = 1.2%)', mine.interestRate);
        var loanRate = field('Loan rate (0.1432 = 14.32%)', mine.loanRate);
        card.appendChild(saveRate.wrap);
        card.appendChild(loanRate.wrap);
        card.appendChild(
          button('Save bank rates', 'mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
            post('/api/economy/company', { companyId: mine.id, interestRate: Number(saveRate.input.value), loanRate: Number(loanRate.input.value) });
          })
        );
        if (mine.deposits && mine.deposits.length) {
          card.appendChild(el('p', 'mt-3 text-[11px] font-semibold text-slate-300', 'Deposits'));
          mine.deposits.forEach(function (d) {
            card.appendChild(el('p', 'text-[11px] text-slate-400', d.username + ': ' + d.amount));
          });
        }
      }
      if (mine.kind === 'insurance') {
        var premium = field('Weekly premium', mine.premium);
        var coverage = field('Coverage per week', mine.coverage);
        card.appendChild(premium.wrap);
        card.appendChild(coverage.wrap);
        card.appendChild(
          button('Save policy', 'mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
            post('/api/economy/company', { companyId: mine.id, premium: Number(premium.input.value), coverage: Number(coverage.input.value) });
          })
        );
      }
      if (mine.kind === 'racing') {
        var fee = field('Entry fee', 25);
        var prize = field('Prize', 100);
        var desc = field('Description', '', 'text');
        desc.input.maxLength = 200;
        desc.input.placeholder = 'What this race is';
        var start = field('Start', '', 'datetime-local');
        card.appendChild(fee.wrap);
        card.appendChild(prize.wrap);
        card.appendChild(desc.wrap);
        card.appendChild(start.wrap);
        card.appendChild(
          button('Open tournament', 'mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
            post('/api/economy/company', {
              companyId: mine.id,
              openTournament: true,
              fee: Number(fee.input.value),
              prize: Number(prize.input.value),
              description: desc.input.value,
              startsAt: start.input.value ? new Date(start.input.value).toISOString() : null,
            });
          })
        );
        (mine.tournaments || []).forEach(function (t) {
          var race = el('div', 'mt-3 rounded-xl border border-white/10 p-3');
          race.appendChild(el('p', 'text-xs font-semibold text-white', t.description || 'Untitled tournament'));
          race.appendChild(el('p', 'mt-1 text-[11px] text-slate-400', tournamentLine(t)));
          if (t.names && t.names.length) race.appendChild(el('p', 'mt-1 text-[11px] text-slate-500', 'Entered: ' + t.names.join(', ')));
          var winner = field('Pay winner username', '', 'text');
          race.appendChild(winner.wrap);
          var raceRow = el('div', 'mt-2 flex flex-wrap gap-2');
          raceRow.appendChild(
            button('Pay winner and close', 'rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
              post('/api/economy/tournament/pay', { companyId: mine.id, tournamentId: t.id, username: winner.input.value });
            })
          );
          raceRow.appendChild(
            button('Close without paying', 'rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200', function () {
              post('/api/economy/company', { companyId: mine.id, closeTournament: true, tournamentId: t.id });
            })
          );
          race.appendChild(raceRow);
          card.appendChild(race);
        });
      }
      var fundAmt = field('Add your own coins', 1000);
      card.appendChild(fundAmt.wrap);
      card.appendChild(
        button('Fund from your coins', 'mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
          post('/api/economy/company/fund', { companyId: mine.id, amount: Number(fundAmt.input.value) });
        })
      );
      var borrowAmt = field('Borrow for the company', 1000);
      card.appendChild(borrowAmt.wrap);
      card.appendChild(
        button('Take a National Bank loan', 'mt-2 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-100', function () {
          post('/api/economy/borrow', { lender: 'national', amount: Number(borrowAmt.input.value), forCompany: true, companyId: mine.id });
        })
      );
      card.appendChild(
        button('Delete company', 'mt-4 rounded-lg border border-rose-500/50 px-3 py-1.5 text-xs font-semibold text-rose-200', function () {
          if (!window.confirm('Delete this company? Its shares become worthless. This cannot be undone.')) return;
          post('/api/economy/company/delete', { companyId: mine.id });
        })
      );
      ownedHost.appendChild(card);
    }
    if (yours.length === 1) paintMine(yours[0]);
    else if (yours.length > 1) {
      var finder = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
      finder.appendChild(el('h3', 'text-sm font-semibold text-white', 'Your companies'));
      finder.appendChild(el('p', 'mt-1 text-[11px] text-slate-500', 'Search by name or ticker, then edit that company.'));
      var findWrap = el('div', 'relative mt-2');
      var find = field('Your companies', ownedQuery, 'text');
      find.input.maxLength = 24;
      find.input.autocomplete = 'off';
      find.input.placeholder = 'Name or ticker';
      findWrap.appendChild(find.wrap);
      var found = el('div', 'absolute left-0 right-0 top-full z-20 mt-1 hidden max-h-80 overflow-y-auto rounded-xl border border-white/15 bg-slate-900 shadow-xl');
      findWrap.appendChild(found);
      finder.appendChild(findWrap);
      function hideFound() {
        found.classList.add('hidden');
        found.textContent = '';
      }
      function showFound(list) {
        found.textContent = '';
        if (!list.length) {
          found.classList.remove('hidden');
          found.appendChild(el('p', 'px-3 py-2 text-sm text-slate-400', 'None of your companies match.'));
          return;
        }
        found.classList.remove('hidden');
        list.forEach(function (c) {
          found.appendChild(
            button(
              c.name + (c.ticker ? ' · ' + c.ticker : '') + ' · ' + c.kind + ' · ' + money(c.shareExact),
              'block w-full border-b border-white/10 px-3 py-2 text-left text-sm text-slate-200 last:border-b-0 hover:bg-slate-800',
              function () {
                ownedQuery = c.name;
                find.input.value = c.name;
                hideFound();
                paintMine(c);
              }
            )
          );
        });
      }
      function filterOwned() {
        var q = find.input.value.trim().toLowerCase();
        ownedQuery = find.input.value;
        if (!q) {
          hideFound();
          return;
        }
        showFound(
          yours.filter(function (c) {
            return c.name.toLowerCase().indexOf(q) !== -1 || String(c.ticker || '').toLowerCase().indexOf(q) !== -1;
          })
        );
      }
      find.input.addEventListener('input', filterOwned);
      find.input.addEventListener('focus', function () {
        if (!find.input.value.trim()) showFound(yours);
        else filterOwned();
      });
      find.input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') hideFound();
      });
      ownedHost.parentNode.insertBefore(finder, ownedHost);
      var chosen = yours.filter(function (c) {
        return c.id === selectedOwnedId;
      })[0];
      if (chosen) paintMine(chosen);
    }
  }

  function openEconomy() {
    if (!getToken()) {
      window.alert('Sign in from Account first.');
      return;
    }
    var screen = document.getElementById('screenEconomy');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    var body = document.getElementById('economyBody');
    if (body) body.textContent = 'Loading…';
    api('/api/economy', { method: 'GET' })
      .then(render)
      .catch(function (e) {
        if (body) body.textContent = String(e.message || e);
      });
  }

  function closeEconomy() {
    var screen = document.getElementById('screenEconomy');
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
  }

  function creditCard(data) {
    var credit = data.credit || {};
    var scoreCard = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    scoreCard.appendChild(el('h3', 'text-sm font-semibold text-white', 'Sky Hop score'));
    scoreCard.appendChild(
      el('p', 'mt-1 text-sm text-white', credit.score == null ? 'Unscored' : credit.score + ' · ' + credit.band)
    );
    scoreCard.appendChild(
      el(
        'p',
        'mt-1 text-[11px] text-slate-400',
        'Runs from 300 to 850. It moves with on-time payments, debt against what you hold, how long you have banked, loans opened in the last two weeks, and whether you both save and borrow. Under 500, new loans are refused. A higher score borrows more, and pays less interest. Saving with no loan still builds a file.'
      )
    );
    return scoreCard;
  }

  function loansBlock(data, draw, msgId) {
    if (!data.loans || !data.loans.length) return null;
    var loans = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    loans.appendChild(el('h3', 'text-sm font-semibold text-white', 'Your loans'));
    data.loans.forEach(function (loan) {
      var line = el('div', 'mt-2 flex flex-wrap items-center gap-2');
      line.appendChild(el('p', 'text-xs text-slate-300', loan.lender + ' · ' + loan.principal + ' at ' + pct(loan.rate)));
      var repayAmt = field('Repay', loan.principal);
      line.appendChild(repayAmt.wrap);
      line.appendChild(
        button('Repay', 'rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200', function () {
          post('/api/economy/repay', { loanId: loan.id, amount: Number(repayAmt.input.value) }, draw, msgId);
        })
      );
      loans.appendChild(line);
    });
    return loans;
  }

  function categoryFinder(parent, items, placeholder, onPick) {
    var wrap = el('div', 'relative mt-3');
    var find = field('Name or ticker', '', 'text');
    find.input.maxLength = 24;
    find.input.autocomplete = 'off';
    find.input.placeholder = placeholder;
    wrap.appendChild(find.wrap);
    var found = el('div', 'absolute left-0 right-0 top-full z-20 mt-1 hidden max-h-52 overflow-y-auto rounded-xl border border-white/15 bg-slate-900 shadow-xl');
    wrap.appendChild(found);
    parent.appendChild(wrap);
    function hide() {
      found.classList.add('hidden');
      found.textContent = '';
    }
    function show(list) {
      found.textContent = '';
      found.classList.remove('hidden');
      if (!list.length) {
        found.appendChild(el('p', 'px-3 py-2 text-sm text-slate-400', 'No match.'));
        return;
      }
      list.slice(0, 12).forEach(function (c) {
        found.appendChild(
          button(
            c.name + (c.ticker ? ' · ' + c.ticker : ''),
            'block w-full border-b border-white/10 px-3 py-2 text-left text-sm text-slate-200 last:border-b-0 hover:bg-slate-800',
            function () {
              find.input.value = c.name;
              hide();
              onPick(c);
            }
          )
        );
      });
    }
    function filter() {
      var q = find.input.value.trim().toLowerCase();
      var list = !q
        ? items
        : items.filter(function (c) {
            return c.name.toLowerCase().indexOf(q) !== -1 || String(c.ticker || '').toLowerCase().indexOf(q) !== -1;
          });
      show(list);
    }
    find.input.addEventListener('input', filter);
    find.input.addEventListener('focus', filter);
    find.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') hide();
    });
  }

  var bankPick = '';
  var insurerPick = '';

  function paintBank(c, host) {
    host.textContent = '';
    var box = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    box.appendChild(el('h3', 'text-sm font-semibold text-white', c.name + (c.ticker ? ' · ' + c.ticker : '')));
    box.appendChild(el('p', 'mt-1 text-[11px] text-slate-500', c.ownerName));
    box.appendChild(
      el(
        'p',
        'mt-2 text-sm text-slate-200',
        'Deposits pay ' + pct(c.interestRate) + ' a week. Loans cost ' + pct(c.loanRate) + ' a week. Your deposit: ' + (c.yourDeposit || 0)
      )
    );
    var amt = field('Amount', 100);
    box.appendChild(amt.wrap);
    var row = el('div', 'mt-2 flex flex-wrap gap-2');
    row.appendChild(
      button('Deposit', 'rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
        post('/api/economy/deposit', { bankId: c.id, amount: Number(amt.input.value) }, renderBanks, 'banksMsg');
      })
    );
    row.appendChild(
      button('Withdraw', 'rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200', function () {
        post('/api/economy/withdraw', { bankId: c.id, amount: Number(amt.input.value) }, renderBanks, 'banksMsg');
      })
    );
    row.appendChild(
      button('Borrow', 'rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-100', function () {
        post('/api/economy/borrow', { lender: c.id, amount: Number(amt.input.value), forCompany: false }, renderBanks, 'banksMsg');
      })
    );
    row.appendChild(
      button('Heist', 'rounded-lg border border-rose-500/50 px-3 py-1.5 text-xs font-semibold text-rose-200', function () {
        if (!window.confirm('A failed heist bans you for 1 day. The chance of success is 0.04%.')) return;
        post('/api/economy/heist', { bankId: c.id }, renderBanks, 'banksMsg');
      })
    );
    box.appendChild(row);
    host.appendChild(box);
  }

  function renderBanks(data) {
    var body = document.getElementById('banksBody');
    if (!body || !data) return;
    body.textContent = '';
    body.appendChild(el('p', 'text-xs text-slate-400', 'Search a bank by name or ticker. Focus the box to see every private bank.'));
    var msg = el('p', 'mt-2 text-sm text-emerald-200', '');
    msg.id = 'banksMsg';
    body.appendChild(msg);
    body.appendChild(creditCard(data));
    var banks = (data.companies || []).filter(function (c) {
      return c.kind === 'bank' && !c.sovereign;
    });
    var host = el('div', '');
    categoryFinder(body, banks, 'Bank name or ticker', function (c) {
      bankPick = c.id;
      paintBank(c, host);
    });
    body.appendChild(host);
    var chosen = banks.filter(function (c) {
      return c.id === bankPick;
    })[0];
    if (chosen) paintBank(chosen, host);
    var loans = loansBlock(data, renderBanks, 'banksMsg');
    if (loans) body.appendChild(loans);
  }

  function paintInsurer(c, host) {
    host.textContent = '';
    var box = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    box.appendChild(el('h3', 'text-sm font-semibold text-white', c.name + (c.ticker ? ' · ' + c.ticker : '')));
    box.appendChild(el('p', 'mt-1 text-[11px] text-slate-500', c.ownerName));
    box.appendChild(
      el(
        'p',
        'mt-2 text-sm text-slate-200',
        'Weekly premium ' + c.premium + ' · coverage up to ' + c.coverage + (c.insured ? ' · you are covered' : '')
      )
    );
    box.appendChild(
      el('p', 'mt-1 text-[11px] text-slate-500', 'A policy pays a drop in the shares you hold, up to the coverage and the cash the company has.')
    );
    if (c.cash == null) {
      box.appendChild(
        button(c.insured ? 'Renew policy' : 'Buy policy', 'mt-3 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
          post('/api/economy/policy', { companyId: c.id }, renderInsurers, 'insurersMsg');
        })
      );
    } else {
      box.appendChild(el('p', 'mt-2 text-[11px] text-slate-400', 'This is your company. Set the premium and coverage from the briefcase.'));
    }
    host.appendChild(box);
  }

  function renderInsurers(data) {
    var body = document.getElementById('insurersBody');
    if (!body || !data) return;
    body.textContent = '';
    body.appendChild(el('p', 'text-xs text-slate-400', 'Search an insurer by name or ticker. Focus the box to see every insurance company.'));
    var msg = el('p', 'mt-2 text-sm text-emerald-200', '');
    msg.id = 'insurersMsg';
    body.appendChild(msg);
    var firms = (data.companies || []).filter(function (c) {
      return c.kind === 'insurance';
    });
    var host = el('div', '');
    categoryFinder(body, firms, 'Insurer name or ticker', function (c) {
      insurerPick = c.id;
      paintInsurer(c, host);
    });
    body.appendChild(host);
    var chosen = firms.filter(function (c) {
      return c.id === insurerPick;
    })[0];
    if (chosen) paintInsurer(chosen, host);
  }

  function renderNational(data) {
    var body = document.getElementById('nationalBody');
    if (!body || !data || !data.national) return;
    body.textContent = '';
    var msg = el('p', 'mt-2 text-sm text-emerald-200', '');
    msg.id = 'nationalMsg';
    body.appendChild(msg);
    body.appendChild(creditCard(data));
    var nat = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    nat.appendChild(el('h3', 'text-sm font-semibold text-white', 'Sky Hop National Bank'));
    nat.appendChild(
      el(
        'p',
        'mt-1 text-xs text-slate-400',
        'Tax pool ' +
          data.national.taxPool +
          ' · your deposit ' +
          data.national.yourDeposit +
          ' · savings ' +
          pct(data.national.savingsRate) +
          ' · loans ' +
          pct(data.national.loanRate) +
          '. This bank cannot go bankrupt. A successful heist returns 75% of the loss from the tax pool. SHNB is public: ' +
          commas((data.national.stock || {}).shareCount || 0) +
          ' shares, ' +
          commas((data.national.stock || {}).listed || 0) +
          ' listed, now ' +
          money((data.national.stock || {}).shareExact || 0) +
          '.'
      )
    );
    var natAmt = field('Amount', 100);
    nat.appendChild(natAmt.wrap);
    var natRow = el('div', 'mt-2 flex flex-wrap gap-2');
    natRow.appendChild(
      button('Deposit', 'rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
        post('/api/economy/deposit', { bankId: 'national', amount: Number(natAmt.input.value) }, renderNational, 'nationalMsg');
      })
    );
    natRow.appendChild(
      button('Withdraw', 'rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200', function () {
        post('/api/economy/withdraw', { bankId: 'national', amount: Number(natAmt.input.value) }, renderNational, 'nationalMsg');
      })
    );
    natRow.appendChild(
      button('Borrow personally', 'rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-100', function () {
        post('/api/economy/borrow', { lender: 'national', amount: Number(natAmt.input.value), forCompany: false }, renderNational, 'nationalMsg');
      })
    );
    natRow.appendChild(
      button('Heist the National Bank', 'rounded-lg border border-rose-500/50 px-3 py-1.5 text-xs font-semibold text-rose-200', function () {
        if (!window.confirm('A failed heist bans you for 1 day. The chance of success is 0.016%.')) return;
        post('/api/economy/heist', { bankId: 'national' }, renderNational, 'nationalMsg');
      })
    );
    nat.appendChild(natRow);
    if (data.national.stock) {
      var sh = field('SHNB shares to buy', 1);
      nat.appendChild(sh.wrap);
      nat.appendChild(
        button('Buy SHNB', 'mt-2 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
          post('/api/economy/shares/buy', { companyId: data.national.stock.id, qty: Number(sh.input.value) }, renderNational, 'nationalMsg');
        })
      );
    }
    body.appendChild(nat);
    var loans = loansBlock(data, renderNational, 'nationalMsg');
    if (loans) body.appendChild(loans);
  }

  function openPanel(screenId, bodyId, draw) {
    if (!getToken()) {
      window.alert('Sign in from Account first.');
      return;
    }
    var screen = document.getElementById(screenId);
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    var body = document.getElementById(bodyId);
    if (body) body.textContent = 'Loading…';
    api('/api/economy', { method: 'GET' })
      .then(draw)
      .catch(function (e) {
        if (body) body.textContent = String(e.message || e);
      });
  }

  function closePanel(screenId) {
    var screen = document.getElementById(screenId);
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
  }

  function renderRaces(data) {
    var body = document.getElementById('racesBody');
    if (!body || !data) return;
    body.textContent = '';
    body.appendChild(el('p', 'text-xs text-slate-400', 'Open tournaments from racing companies. Each listing shows the description, entry fee, and prize.'));
    var msg = el('p', 'mt-2 text-sm text-emerald-200', '');
    msg.id = 'racesMsg';
    body.appendChild(msg);
    var any = false;
    (data.companies || []).forEach(function (c) {
      if (c.kind !== 'racing' || !c.tournaments || !c.tournaments.length) return;
      any = true;
      var box = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
      box.appendChild(el('h3', 'text-sm font-semibold text-white', c.name));
      box.appendChild(el('p', 'text-[11px] text-slate-500', c.ownerName));
      c.tournaments.forEach(function (t) {
        var race = el('div', 'mt-3 rounded-xl border border-white/10 p-3');
        race.appendChild(el('p', 'text-sm text-white', t.description || 'No description'));
        race.appendChild(el('p', 'mt-1 text-xs text-slate-300', tournamentLine(t)));
        if (t.started) {
          race.appendChild(el('p', 'mt-2 text-[11px] text-slate-500', 'Entry is closed.'));
        } else if (t.youEntered) {
          race.appendChild(el('p', 'mt-2 text-[11px] text-emerald-300', 'You entered.'));
        } else {
          race.appendChild(
            button('Enter', 'mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
              post('/api/economy/tournament/enter', { companyId: c.id, tournamentId: t.id }, renderRaces);
            })
          );
        }
        box.appendChild(race);
      });
      body.appendChild(box);
    });
    if (!any) body.appendChild(el('p', 'mt-4 text-sm text-slate-400', 'No tournaments are open.'));
  }

  function openRaces() {
    if (!getToken()) {
      window.alert('Sign in from Account first.');
      return;
    }
    var screen = document.getElementById('screenRaces');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    var body = document.getElementById('racesBody');
    if (body) body.textContent = 'Loading…';
    api('/api/economy', { method: 'GET' })
      .then(renderRaces)
      .catch(function (e) {
        if (body) body.textContent = String(e.message || e);
      });
  }

  function closeRaces() {
    var screen = document.getElementById('screenRaces');
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
  }

  var stockRange = '1d';
  var stockId = '';
  var selectedOwnedId = '';
  var ownedQuery = '';
  var STOCK_RANGES = [
    ['1d', '1D'],
    ['1w', '1W'],
    ['1m', '1M'],
    ['1y', '1Y'],
    ['10y', '10Y'],
    ['ytd', 'YTD'],
  ];

  function signedPct(n) {
    var p = Number(n) * 100;
    return (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
  }

  function chartSvg(points) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 320 120');
    svg.setAttribute('class', 'mt-3 w-full');
    var list = points && points.length ? points : [{ p: 0 }, { p: 0 }];
    var min = list[0].p;
    var max = list[0].p;
    list.forEach(function (p) {
      if (p.p < min) min = p.p;
      if (p.p > max) max = p.p;
    });
    var span = max - min || 1;
    var coords = list.map(function (p, i) {
      var x = list.length === 1 ? 160 : (i / (list.length - 1)) * 304 + 8;
      var y = 8 + (1 - (p.p - min) / span) * 104;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', list[list.length - 1].p >= list[0].p ? '#34d399' : '#fb7185');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('points', coords.join(' '));
    svg.appendChild(line);
    return svg;
  }

  function renderQuote(q) {
    var box = document.getElementById('stocksQuote');
    if (!box || !q) return;
    box.textContent = '';
    var title = q.name + (q.ticker ? ' · ' + q.ticker : '');
    box.appendChild(el('h3', 'text-sm font-semibold text-white', title));
    box.appendChild(el('p', 'mt-1 text-[11px] text-slate-500', q.ownerName || ''));
    if (!q.alive) box.appendChild(el('p', 'mt-2 text-sm text-rose-200', 'Closed. Shares are worthless.'));
    else if (!q.isPublic) box.appendChild(el('p', 'mt-2 text-sm text-slate-300', 'Private. ' + money(q.shareExact)));
    else box.appendChild(el('p', 'mt-2 text-sm text-slate-200', money(q.shareExact) + ' · ' + commas(q.listed) + ' listed' + (q.sovereign ? ' of ' + commas(q.shareCount) : '') + ' · you own ' + commas(q.yourShares)));
    var change = el('p', 'mt-1 text-sm font-semibold ' + (q.pct >= 0 ? 'text-emerald-300' : 'text-rose-300'), signedPct(q.pct));
    box.appendChild(change);
    if (q.sinceListing) box.appendChild(el('p', 'text-[11px] text-slate-500', 'This range is longer than the listing. The change is from the first recorded price.'));
    box.appendChild(chartSvg(q.points || []));
    var ranges = el('div', 'mt-3 flex flex-wrap gap-2');
    STOCK_RANGES.forEach(function (pair) {
      var on = pair[0] === (q.range || stockRange);
      ranges.appendChild(
        button(pair[1], on ? 'rounded-lg bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white' : 'rounded-lg border border-white/15 px-2 py-1 text-[11px] font-semibold text-slate-200', function () {
          loadQuote(q.id, pair[0]);
        })
      );
    });
    box.appendChild(ranges);
    if (q.alive && q.isPublic) {
      if (q.yourShort > 0) box.appendChild(el('p', 'mt-1 text-[11px] text-amber-200', 'You are short ' + commas(q.yourShort) + ' shares.'));
      var qty = field('Shares', 1);
      var limit = field('Limit price, blank for a market order', '', 'number');
      limit.input.step = '0.01';
      limit.input.min = '0.01';
      limit.input.placeholder = 'Market';
      box.appendChild(qty.wrap);
      box.appendChild(limit.wrap);
      function send(side) {
        var body = { companyId: q.id, side: side, qty: Number(qty.input.value) };
        if (String(limit.input.value).trim() !== '') body.limit = Number(limit.input.value);
        post('/api/economy/shares/trade', body, function () {
          loadQuote(q.id, stockRange);
        }, 'stocksMsg');
      }
      var row = el('div', 'mt-2 flex flex-wrap gap-2');
      if (q.listed > 0 && !q.viewerIsOwner) {
        row.appendChild(button('Buy', 'rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () { send('buy'); }));
      }
      if (q.yourShares > 0 && !q.viewerIsOwner) {
        row.appendChild(button('Sell', 'rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white', function () { send('sell'); }));
      }
      if (!q.viewerIsOwner) {
        row.appendChild(button('Short', 'rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-semibold text-amber-100', function () { send('short'); }));
      }
      if (q.yourShort > 0) {
        row.appendChild(button('Cover', 'rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200', function () { send('cover'); }));
      }
      box.appendChild(row);
      box.appendChild(el('p', 'mt-2 text-[11px] text-slate-500', 'Prices move every 6 hours. A limit order waits until the price reaches it. You can rest 3 per stock. A profitable week pays 2% of company cash, split by the shares you own, and always leaves at least 1 coin of that profit in the company. Shorts owe the same amount per share.'));
      (q.orders || []).forEach(function (order) {
        var line = el('div', 'mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-300');
        line.appendChild(el('span', '', order.side + ' ' + commas(order.qty) + ' at ' + money(order.limit)));
        line.appendChild(button('Cancel', 'rounded border border-white/15 px-2 py-0.5 text-[10px] text-slate-200', function () {
          post('/api/economy/shares/cancel', { companyId: q.id, orderId: order.id }, function () {
            loadQuote(q.id, stockRange);
          }, 'stocksMsg');
        }));
        box.appendChild(line);
      });
    }
  }

  function loadQuote(id, range) {
    stockId = id;
    stockRange = range || stockRange;
    var box = document.getElementById('stocksQuote');
    if (box) box.textContent = 'Loading…';
    return api('/api/economy/stocks?id=' + encodeURIComponent(id) + '&range=' + encodeURIComponent(stockRange)).then(renderQuote);
  }

  function renderStockMatches(data) {
    var list = document.getElementById('stocksResults');
    if (!list) return;
    list.textContent = '';
    var matches = (data && data.matches) || [];
    if (!matches.length) {
      list.appendChild(el('p', 'mt-3 text-sm text-slate-400', 'No company matches that name or ticker.'));
      return;
    }
    matches.forEach(function (c) {
      var row = button(
        c.name + (c.ticker ? ' · ' + c.ticker : '') + ' · ' + (c.alive ? c.sharePrice + ' coins' : 'worthless') + (c.alive && !c.isPublic ? ' · private' : ''),
        'mt-2 block w-full rounded-xl border border-white/10 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800',
        function () {
          loadQuote(c.id, stockRange);
        }
      );
      list.appendChild(row);
    });
  }

  function openStocks() {
    if (!getToken()) {
      window.alert('Sign in from Account first.');
      return;
    }
    var screen = document.getElementById('screenStocks');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    var body = document.getElementById('stocksBody');
    if (!body) return;
    body.textContent = '';
    body.appendChild(el('p', 'text-xs text-slate-400', 'Search by company name or ticker. Prices move every 6 hours. You can buy, sell, short, or set a limit price.'));
    var stockMsg = el('p', 'mt-2 text-sm text-emerald-200', '');
    stockMsg.id = 'stocksMsg';
    body.appendChild(stockMsg);
    var searchWrap = el('div', 'relative mt-3');
    var search = field('Name or ticker', '', 'text');
    search.input.maxLength = 24;
    search.input.autocomplete = 'off';
    searchWrap.appendChild(search.wrap);
    var suggest = el('div', 'absolute left-0 right-0 top-full z-20 mt-1 hidden max-h-52 overflow-y-auto rounded-xl border border-white/15 bg-slate-900 shadow-xl');
    searchWrap.appendChild(suggest);
    body.appendChild(searchWrap);
    var quote = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4', '');
    quote.id = 'stocksQuote';
    body.appendChild(quote);
    var searchTimer = 0;
    var searchToken = 0;
    function hideSuggest() {
      suggest.classList.add('hidden');
      suggest.textContent = '';
    }
    function showSuggest(matches) {
      suggest.textContent = '';
      if (!matches.length) {
        suggest.classList.remove('hidden');
        suggest.appendChild(el('p', 'px-3 py-2 text-sm text-slate-400', 'No matching company'));
        return;
      }
      suggest.classList.remove('hidden');
      matches.forEach(function (c) {
        suggest.appendChild(
          button(
            c.name + (c.ticker ? ' · ' + c.ticker : '') + ' · ' + (c.alive ? money(c.shareExact) : 'worthless') + (c.alive && !c.isPublic ? ' · private' : ''),
            'block w-full border-b border-white/10 px-3 py-2 text-left text-sm text-slate-200 last:border-b-0 hover:bg-slate-800',
            function () {
              search.input.value = c.ticker || c.name;
              hideSuggest();
              loadQuote(c.id, stockRange);
            }
          )
        );
      });
    }
    function runSuggest() {
      var q = search.input.value.trim();
      searchToken += 1;
      var token = searchToken;
      if (!q) {
        hideSuggest();
        return;
      }
      api('/api/economy/stocks?q=' + encodeURIComponent(q))
        .then(function (data) {
          if (token !== searchToken) return;
          showSuggest((data && data.matches) || []);
        })
        .catch(function () {
          if (token !== searchToken) return;
          hideSuggest();
        });
    }
    search.input.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSuggest, 200);
    });
    search.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') hideSuggest();
    });
  }

  function closeStocks() {
    var screen = document.getElementById('screenStocks');
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
  }

  function bind() {
    var fab = document.getElementById('btnEconomyFab');
    var close = document.getElementById('btnEconomyClose');
    var races = document.getElementById('btnRacesFab');
    var racesClose = document.getElementById('btnRacesClose');
    var stocks = document.getElementById('btnStocksFab');
    var stocksClose = document.getElementById('btnStocksClose');
    if (fab) fab.addEventListener('click', openEconomy);
    if (close) close.addEventListener('click', closeEconomy);
    if (races) races.addEventListener('click', openRaces);
    if (racesClose) racesClose.addEventListener('click', closeRaces);
    if (stocks) stocks.addEventListener('click', openStocks);
    if (stocksClose) stocksClose.addEventListener('click', closeStocks);
    var banks = document.getElementById('btnBanksFab');
    var banksClose = document.getElementById('btnBanksClose');
    var insurers = document.getElementById('btnInsurersFab');
    var insurersClose = document.getElementById('btnInsurersClose');
    var national = document.getElementById('btnNationalFab');
    var nationalClose = document.getElementById('btnNationalClose');
    if (banks) banks.addEventListener('click', function () { openPanel('screenBanks', 'banksBody', renderBanks); });
    if (banksClose) banksClose.addEventListener('click', function () { closePanel('screenBanks'); });
    if (insurers) insurers.addEventListener('click', function () { openPanel('screenInsurers', 'insurersBody', renderInsurers); });
    if (insurersClose) insurersClose.addEventListener('click', function () { closePanel('screenInsurers'); });
    if (national) national.addEventListener('click', function () { openPanel('screenNational', 'nationalBody', renderNational); });
    if (nationalClose) nationalClose.addEventListener('click', function () { closePanel('screenNational'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
