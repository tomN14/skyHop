/**
 * Full-screen paginated coin shop (skins).
 */
(function () {
  var shopPage = 1;
  var shopPages = 3;
  var slotsPerPage = 6;
  var shopItems = [];
  var pendingAction = null;

  function getToken() {
    try {
      return localStorage.getItem('SKYHOP_AUTH_TOKEN') || '';
    } catch {
      return '';
    }
  }

  function api(path, opts) {
    if (typeof window.SkyHopApiRequest !== 'function') {
      return Promise.reject(new Error('API not ready'));
    }
    return window.SkyHopApiRequest(path, opts || {});
  }

  function ownedSet() {
    var me = window.__skyhopLastMe;
    return new Set((me && me.unlockedTextures) || []);
  }

  function updateCoinDisplay() {
    var el = document.getElementById('shopCoinBalance');
    var me = window.__skyhopLastMe;
    if (!el) return;
    if (me && me.coinsInfinite) el.textContent = '∞';
    else el.textContent = String(me && me.coins != null ? me.coins : 0);
  }

  function itemAt(page, slot) {
    for (var i = 0; i < shopItems.length; i++) {
      var it = shopItems[i];
      if (Number(it.page) === page && Number(it.slot) === slot) return it;
    }
    return null;
  }

  function showConfirm(text, onYes) {
    var ov = document.getElementById('shopConfirmOverlay');
    var tx = document.getElementById('shopConfirmText');
    var yes = document.getElementById('shopConfirmYes');
    var no = document.getElementById('shopConfirmNo');
    if (!ov || !tx || !yes || !no) return;
    tx.textContent = text;
    pendingAction = onYes;
    ov.classList.remove('hidden');
    ov.classList.add('flex');
  }

  function hideConfirm() {
    var ov = document.getElementById('shopConfirmOverlay');
    if (ov) {
      ov.classList.add('hidden');
      ov.classList.remove('flex');
    }
    pendingAction = null;
  }

  function syncAccountCoins(coins, coinsInfinite, unlockedTextures) {
    if (window.__skyhopLastMe) {
      if (coins != null) window.__skyhopLastMe.coins = coins;
      if (coinsInfinite != null) window.__skyhopLastMe.coinsInfinite = !!coinsInfinite;
      if (unlockedTextures) window.__skyhopLastMe.unlockedTextures = unlockedTextures;
    }
    var elc = document.getElementById('accStatCoins');
    if (elc && window.__skyhopLastMe) {
      elc.textContent = window.__skyhopLastMe.coinsInfinite ? '∞' : String(window.__skyhopLastMe.coins);
    }
  }

  function renderGrid() {
    var grid = document.getElementById('shopGrid');
    var pageNum = document.getElementById('shopPageNum');
    var pageTotal = document.getElementById('shopPageTotal');
    var guestHint = document.getElementById('shopGuestHint');
    if (!grid) return;
    if (pageNum) pageNum.textContent = String(shopPage);
    if (pageTotal) pageTotal.textContent = String(shopPages);
    if (guestHint) guestHint.classList.toggle('hidden', !!getToken());
    updateCoinDisplay();
    grid.innerHTML = '';
    var owned = ownedSet();
    var tok = getToken();

    for (var slot = 0; slot < slotsPerPage; slot++) {
      var cell = document.createElement('div');
      cell.className =
        'flex min-h-[10rem] flex-col items-center justify-start rounded-2xl border border-white/10 bg-slate-900/60 p-3 sm:min-h-[11rem]';
      var it = itemAt(shopPage, slot);
      if (!it) {
        cell.classList.add('opacity-40');
        grid.appendChild(cell);
        continue;
      }
      var img = document.createElement('img');
      img.src = 'textures/' + encodeURIComponent(it.texture);
      img.alt = it.label || it.texture;
      img.className = 'h-24 w-24 object-contain sm:h-28 sm:w-28';
      img.loading = 'lazy';
      var label = document.createElement('p');
      label.className = 'mt-2 text-center text-xs font-medium text-slate-300';
      label.textContent = it.label || it.texture;
      var has = owned.has(it.texture);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'mt-2 w-full max-w-[8rem] rounded-xl px-3 py-2 text-sm font-semibold ' +
        (has
          ? 'border border-amber-500/40 bg-amber-950/50 text-amber-100 hover:bg-amber-900/50'
          : 'bg-emerald-600 text-white hover:bg-emerald-500');
      btn.textContent = has ? 'Sell' : 'Buy';
      if (!tok) {
        btn.disabled = true;
        btn.className += ' opacity-50 cursor-not-allowed';
      } else {
        btn.addEventListener('click', function (item, isOwned) {
          return function () {
            if (isOwned) {
              showConfirm(
                'Confirm selling ' + (item.label || item.texture) + ' for ' + String(item.sellPrice) + ' coins?',
                function () {
                  return api('/api/shop/sell', {
                    method: 'POST',
                    headers: {
                      Authorization: 'Bearer ' + getToken(),
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ itemId: item.id }),
                  }).then(function (out) {
                    syncAccountCoins(out.coins, out.coinsInfinite, out.unlockedTextures);
                    if (typeof window.refreshSkinUiFromMe === 'function') {
                      window.refreshSkinUiFromMe(window.__skyhopLastMe);
                    }
                    renderGrid();
                  });
                }
              );
            } else {
              showConfirm(
                'Confirm buying ' + (item.label || item.texture) + '?\n\nFor ' + String(item.price) + ' coins',
                function () {
                  return api('/api/shop/buy', {
                    method: 'POST',
                    headers: {
                      Authorization: 'Bearer ' + getToken(),
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ itemId: item.id }),
                  }).then(function (out) {
                    syncAccountCoins(out.coins, out.coinsInfinite, out.unlockedTextures);
                    if (typeof window.refreshSkinUiFromMe === 'function') {
                      window.refreshSkinUiFromMe(window.__skyhopLastMe);
                    }
                    renderGrid();
                  });
                }
              );
            }
          };
        })(it, has);
      }
      cell.appendChild(img);
      cell.appendChild(label);
      if (!has) {
        var price = document.createElement('p');
        price.className = 'mt-0.5 text-[11px] text-amber-200/90';
        price.textContent = String(it.price) + ' coins';
        cell.appendChild(price);
      }
      cell.appendChild(btn);
      grid.appendChild(cell);
    }
  }

  async function loadShopCatalog() {
    var data = await api('/api/shop/items', { method: 'GET' });
    shopItems = data.items || [];
    shopPages = data.pages != null ? Number(data.pages) : 3;
    slotsPerPage = data.slotsPerPage != null ? Number(data.slotsPerPage) : 6;
    if (shopPage > shopPages) shopPage = 1;
    renderGrid();
  }

  function openShop() {
    var screen = document.getElementById('screenCoinShop');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    shopPage = 1;
    void loadShopCatalog().catch(function (e) {
      var grid = document.getElementById('shopGrid');
      if (grid) grid.innerHTML = '<p class="col-span-2 text-center text-rose-300">' + String(e.message || e) + '</p>';
    });
  }

  function closeShop() {
    var screen = document.getElementById('screenCoinShop');
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
    hideConfirm();
  }

  function bind() {
    var fab = document.getElementById('btnCoinShopFab');
    var close = document.getElementById('btnCoinShopClose');
    var prev = document.getElementById('shopBtnPrev');
    var next = document.getElementById('shopBtnNext');
    var yes = document.getElementById('shopConfirmYes');
    var no = document.getElementById('shopConfirmNo');

    if (fab) {
      fab.classList.remove('hidden');
      fab.addEventListener('click', openShop);
    }
    if (close) close.addEventListener('click', closeShop);
    if (prev) {
      prev.addEventListener('click', function () {
        shopPage -= 1;
        if (shopPage < 1) shopPage = shopPages;
        renderGrid();
      });
    }
    if (next) {
      next.addEventListener('click', function () {
        shopPage += 1;
        if (shopPage > shopPages) shopPage = 1;
        renderGrid();
      });
    }
    if (no) no.addEventListener('click', hideConfirm);
    if (yes) {
      yes.addEventListener('click', function () {
        var fn = pendingAction;
        if (!fn) {
          hideConfirm();
          return;
        }
        hideConfirm();
        void fn().catch(function (e) {
          window.alert(String(e.message || e));
        });
      });
    }
  }

  window.SkyHopOpenCoinShop = openShop;
  window.SkyHopRefreshCoinShop = function () {
    if (document.getElementById('screenCoinShop') && !document.getElementById('screenCoinShop').classList.contains('hidden')) {
      void loadShopCatalog();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
