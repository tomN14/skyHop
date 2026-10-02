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

  function setMsg(text, bad) {
    var msg = document.getElementById('economyMsg');
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'mt-2 text-sm ' + (bad ? 'text-rose-300' : 'text-emerald-200');
  }

  function post(path, body, draw) {
    setMsg('');
    var note = '';
    var failed = false;
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
      .then(function (data) {
        if (data && data.message) note = data.message;
        if (data && data.ok === false) failed = true;
        if (data && data.banned) {
          setMsg(note || 'Banned.', true);
          return null;
        }
        return data && data.view ? data.view : data;
      })
      .then(function (view) {
        if (view) (draw || render)(view);
        if (note && !draw) setMsg(note, failed);
        if (note && draw) setRaceMsg(note, failed);
      })
      .catch(function (e) {
        if (draw) setRaceMsg(String(e.message || e), true);
        else setMsg(String(e.message || e), true);
      });
  }

  function pct(n) {
    return (Number(n) * 100).toFixed(2) + '%';
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
        'Registering costs ' +
          rules.registerCost +
          ' coins. Each week the server takes ' +
          pct(rules.taxRate) +
          ' of wallet coins and company cash for the Sky Hop National Bank. Savings pay ' +
          pct(rules.nationalSave) +
          '. Loans cost ' +
          pct(rules.nationalLoan) +
          '. Overhead is ' +
          rules.overhead +
          ' coins. A company whose week is under ' +
          rules.bankruptAt +
          ' coins is closed and its stock goes to zero. Share prices move with the S&P 500 plus a small random swing. A failed heist is a 1-day ban.'
      )
    );
    var msg = el('p', 'mt-2 text-sm text-emerald-200', '');
    msg.id = 'economyMsg';
    body.appendChild(msg);

    var mine = data.yourCompany;
    var card = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    card.appendChild(el('h3', 'text-sm font-semibold text-white', mine ? 'Your company: ' + mine.name : 'Start a company'));
    if (!mine) {
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
    } else {
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
            (mine.isPublic ? 'public' : 'private')
        )
      );
      var price = field('Share price', mine.sharePrice);
      var listed = field('Shares listed for sale', mine.listed);
      card.appendChild(price.wrap);
      card.appendChild(listed.wrap);
      var row = el('div', 'mt-2 flex flex-wrap gap-2');
      row.appendChild(
        button('Save shares', 'rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
          post('/api/economy/company', { sharePrice: Number(price.input.value), listed: Number(listed.input.value) });
        })
      );
      row.appendChild(
        button(mine.isPublic ? 'Go private' : 'Go public', 'rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200', function () {
          post('/api/economy/company', { isPublic: !mine.isPublic });
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
            post('/api/economy/company', { interestRate: Number(saveRate.input.value), loanRate: Number(loanRate.input.value) });
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
            post('/api/economy/company', { premium: Number(premium.input.value), coverage: Number(coverage.input.value) });
          })
        );
      }
      if (mine.kind === 'racing') {
        var fee = field('Entry fee', 25);
        var prize = field('Prize', 100);
        var desc = field('Description', '', 'text');
        desc.input.maxLength = 200;
        desc.input.placeholder = 'What this race is';
        card.appendChild(fee.wrap);
        card.appendChild(prize.wrap);
        card.appendChild(desc.wrap);
        card.appendChild(
          button('Open tournament', 'mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
            post('/api/economy/company', {
              openTournament: true,
              fee: Number(fee.input.value),
              prize: Number(prize.input.value),
              description: desc.input.value,
            });
          })
        );
        (mine.tournaments || []).forEach(function (t) {
          var race = el('div', 'mt-3 rounded-xl border border-white/10 p-3');
          race.appendChild(el('p', 'text-xs font-semibold text-white', t.description || 'Untitled tournament'));
          race.appendChild(el('p', 'mt-1 text-[11px] text-slate-400', 'Entry ' + t.fee + ' · prize ' + t.prize + ' · ' + t.entrants + ' entered'));
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
              post('/api/economy/company', { closeTournament: true, tournamentId: t.id });
            })
          );
          race.appendChild(raceRow);
          card.appendChild(race);
        });
      }
      var borrowAmt = field('Borrow for the company', 1000);
      card.appendChild(borrowAmt.wrap);
      card.appendChild(
        button('Take a National Bank loan', 'mt-2 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-100', function () {
          post('/api/economy/borrow', { lender: 'national', amount: Number(borrowAmt.input.value), forCompany: true });
        })
      );
    }
    body.appendChild(card);

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
          '. This bank cannot go bankrupt. A successful heist returns 75% of the loss from the tax pool.'
      )
    );
    var natAmt = field('Amount', 100);
    nat.appendChild(natAmt.wrap);
    var natRow = el('div', 'mt-2 flex flex-wrap gap-2');
    natRow.appendChild(button('Deposit', 'rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
      post('/api/economy/deposit', { bankId: 'national', amount: Number(natAmt.input.value) });
    }));
    natRow.appendChild(button('Withdraw', 'rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200', function () {
      post('/api/economy/withdraw', { bankId: 'national', amount: Number(natAmt.input.value) });
    }));
    natRow.appendChild(button('Borrow personally', 'rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-100', function () {
      post('/api/economy/borrow', { lender: 'national', amount: Number(natAmt.input.value), forCompany: false });
    }));
    natRow.appendChild(
      button('Heist the National Bank', 'rounded-lg border border-rose-500/50 px-3 py-1.5 text-xs font-semibold text-rose-200', function () {
        if (!window.confirm('A failed heist bans you for 1 day. The chance of success is 0.016%.')) return;
        post('/api/economy/heist', { bankId: 'national' });
      })
    );
    nat.appendChild(natRow);
    body.appendChild(nat);

    if (data.loans && data.loans.length) {
      var loans = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
      loans.appendChild(el('h3', 'text-sm font-semibold text-white', 'Your loans'));
      data.loans.forEach(function (loan) {
        var line = el('div', 'mt-2 flex flex-wrap items-center gap-2');
        line.appendChild(el('p', 'text-xs text-slate-300', loan.lender + ' · ' + loan.principal + ' at ' + pct(loan.rate)));
        var repayAmt = field('Repay', loan.principal);
        line.appendChild(repayAmt.wrap);
        line.appendChild(
          button('Repay', 'rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200', function () {
            post('/api/economy/repay', { loanId: loan.id, amount: Number(repayAmt.input.value) });
          })
        );
        loans.appendChild(line);
      });
      body.appendChild(loans);
    }

    var market = el('section', 'mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4');
    market.appendChild(el('h3', 'text-sm font-semibold text-white', 'Companies'));
    market.appendChild(el('p', 'mt-1 text-[11px] text-slate-500', 'Index move this week: ' + pct(data.indexChange || 0)));
    (data.companies || []).forEach(function (c) {
      if (mine && c.id === mine.id) return;
      var box = el('div', 'mt-3 rounded-xl border border-white/10 p-3');
      box.appendChild(el('p', 'text-sm font-semibold text-white', c.name));
      box.appendChild(
        el(
          'p',
          'text-[11px] text-slate-400',
          c.kind +
            ' · ' +
            c.ownerName +
            ' · ' +
            (c.isPublic ? c.sharePrice + ' coins · ' + c.listed + ' listed · you own ' + c.yourShares : 'private')
        )
      );
      if (c.isPublic && c.listed > 0) {
        var qty = field('Shares to buy', 1);
        box.appendChild(qty.wrap);
        box.appendChild(
          button('Buy', 'mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
            post('/api/economy/shares/buy', { companyId: c.id, qty: Number(qty.input.value) });
          })
        );
      }
      if (c.kind === 'bank') {
        var amt = field('Bank amount', 100);
        box.appendChild(amt.wrap);
        var bankRow = el('div', 'mt-2 flex flex-wrap gap-2');
        bankRow.appendChild(button('Deposit', 'rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
          post('/api/economy/deposit', { bankId: c.id, amount: Number(amt.input.value) });
        }));
        bankRow.appendChild(button('Withdraw', 'rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200', function () {
          post('/api/economy/withdraw', { bankId: c.id, amount: Number(amt.input.value) });
        }));
        bankRow.appendChild(button('Borrow', 'rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-100', function () {
          post('/api/economy/borrow', { lender: c.id, amount: Number(amt.input.value), forCompany: false });
        }));
        bankRow.appendChild(
          button('Heist', 'rounded-lg border border-rose-500/50 px-3 py-1.5 text-xs font-semibold text-rose-200', function () {
            if (!window.confirm('A failed heist bans you for 1 day. The chance of success is 0.04%.')) return;
            post('/api/economy/heist', { bankId: c.id });
          })
        );
        box.appendChild(bankRow);
        box.appendChild(el('p', 'mt-1 text-[11px] text-slate-500', 'Your deposit here: ' + (c.yourDeposit || 0)));
      }
      if (c.kind === 'insurance') {
        box.appendChild(
          el('p', 'mt-1 text-[11px] text-slate-400', 'Premium ' + c.premium + ' · coverage ' + c.coverage + (c.insured ? ' · you are covered' : ''))
        );
        box.appendChild(
          button(c.insured ? 'Renew policy' : 'Buy policy', 'mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
            post('/api/economy/policy', { companyId: c.id });
          })
        );
      }
      if (c.kind === 'racing' && c.tournaments && c.tournaments.length) {
        c.tournaments.forEach(function (t) {
          var race = el('div', 'mt-2 rounded-lg border border-white/10 p-2');
          race.appendChild(el('p', 'text-xs text-white', t.description || 'Untitled tournament'));
          race.appendChild(el('p', 'mt-1 text-[11px] text-slate-400', 'Entry ' + t.fee + ' · prize ' + t.prize + ' · ' + t.entrants + ' entered'));
          if (!t.youEntered) {
            race.appendChild(
              button('Enter', 'mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white', function () {
                post('/api/economy/tournament/enter', { companyId: c.id, tournamentId: t.id });
              })
            );
          } else {
            race.appendChild(el('p', 'mt-1 text-[11px] text-emerald-300', 'You entered.'));
          }
          box.appendChild(race);
        });
      }
      market.appendChild(box);
    });
    body.appendChild(market);
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

  function setRaceMsg(text, bad) {
    var msg = document.getElementById('racesMsg');
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'mt-2 text-sm ' + (bad ? 'text-rose-300' : 'text-emerald-200');
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
        race.appendChild(el('p', 'mt-1 text-xs text-slate-300', 'Entry fee ' + t.fee + ' coins · prize ' + t.prize + ' coins · ' + t.entrants + ' entered'));
        if (t.youEntered) {
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

  function bind() {
    var fab = document.getElementById('btnEconomyFab');
    var close = document.getElementById('btnEconomyClose');
    var races = document.getElementById('btnRacesFab');
    var racesClose = document.getElementById('btnRacesClose');
    if (fab) fab.addEventListener('click', openEconomy);
    if (close) close.addEventListener('click', closeEconomy);
    if (races) races.addEventListener('click', openRaces);
    if (racesClose) racesClose.addEventListener('click', closeRaces);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
