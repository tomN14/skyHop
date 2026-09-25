/**
 * Full-screen paginated coin shop (skins) + owner add-item.
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

  function apiOrigin() {
    if (typeof window.SkyHopApiOrigin === 'function') return window.SkyHopApiOrigin();
    return '';
  }

  function shopTierFromPrice(price) {
    var p = Math.floor(Number(price) || 0);
    if (p >= 500000) return { id: 'mythic', label: 'Mythic' };
    if (p >= 100000) return { id: 'legendary', label: 'Legendary' };
    if (p >= 10000) return { id: 'epic', label: 'Epic' };
    if (p >= 4500) return { id: 'rare', label: 'Rare' };
    if (p >= 2000) return { id: 'insane', label: 'Insane' };
    if (p >= 1000) return { id: 'uncommon', label: 'Uncommon' };
    return { id: 'common', label: 'Common' };
  }

  function tierBadgeClass(tier) {
    switch (tier) {
      case 'mythic':
        return 'border-fuchsia-400/80 text-fuchsia-100 bg-fuchsia-950/60';
      case 'legendary':
        return 'border-amber-400/80 text-amber-100 bg-amber-950/50';
      case 'epic':
        return 'border-violet-400/80 text-violet-100 bg-violet-950/60';
      case 'rare':
        return 'border-sky-400/80 text-sky-100 bg-sky-950/60';
      case 'insane':
        return 'border-orange-400/80 text-orange-100 bg-orange-950/60';
      case 'uncommon':
        return 'border-emerald-400/80 text-emerald-100 bg-emerald-950/60';
      default:
        return 'border-slate-400/70 text-slate-200 bg-slate-800/70';
    }
  }

  function skinDisplayName(raw) {
    return String(raw || '').replace(/\.(png|jpe?g|webp|gif)$/i, '');
  }

  function skinImageUrl(tex) {
    if (!tex) return '';
    if (String(tex).indexOf('shop-') === 0) {
      return apiOrigin() + '/api/shop/skins/' + encodeURIComponent(tex);
    }
    return 'textures/' + encodeURIComponent(tex);
  }

  function itemImageUrl(it) {
    if (!it) return '';
    if (it.imageUrl) {
      if (/^https?:/i.test(it.imageUrl)) return it.imageUrl;
      if (it.imageUrl.indexOf('/api/') === 0) return apiOrigin() + it.imageUrl;
      return it.imageUrl;
    }
    return skinImageUrl(it.texture);
  }

  window.SkyHopSkinImageUrl = skinImageUrl;
  window.SkyHopShopTierFromPrice = shopTierFromPrice;

  function ownedSet() {
    var me = window.__skyhopLastMe;
    return new Set((me && me.unlockedTextures) || []);
  }

  function isOwner() {
    var me = window.__skyhopLastMe;
    return !!(me && me.role === 'owner');
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
        'flex min-h-[11.5rem] flex-col items-center justify-start rounded-2xl border border-white/10 bg-slate-900/60 p-3 sm:min-h-[12.5rem]';
      var it = itemAt(shopPage, slot);
      if (!it) {
        cell.classList.add('border-dashed', 'opacity-60');
        var emptyLabel = document.createElement('p');
        emptyLabel.className = 'mt-auto text-center text-[11px] font-medium uppercase tracking-wide text-slate-500';
        emptyLabel.textContent = 'Empty slot';
        cell.appendChild(emptyLabel);
        grid.appendChild(cell);
        continue;
      }
      var img = document.createElement('img');
      img.src = itemImageUrl(it);
      img.alt = it.label || it.texture;
      img.className = 'h-24 w-24 object-contain sm:h-28 sm:w-28';
      img.loading = 'lazy';
      var tierId = it.tier || shopTierFromPrice(it.price).id;
      var tierLabel = it.tierLabel || shopTierFromPrice(it.price).label;
      var tier = document.createElement('p');
      tier.className =
        'mt-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
        tierBadgeClass(tierId);
      tier.textContent = tierLabel;
      var label = document.createElement('p');
      label.className = 'mt-1 text-center text-xs font-medium text-slate-300';
      label.textContent = skinDisplayName(it.label || it.texture);
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
        (function (item, isOwned) {
          btn.addEventListener('click', function () {
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
          });
        })(it, has);
      }
      cell.appendChild(img);
      cell.appendChild(tier);
      cell.appendChild(label);
      if (it.creator) {
        var by = document.createElement('p');
        by.className = 'text-center text-[10px] text-slate-500';
        by.textContent = 'by ' + it.creator;
        cell.appendChild(by);
      }
      if (!has) {
        var price = document.createElement('p');
        price.className = 'mt-0.5 text-[11px] text-amber-200/90';
        price.textContent = String(it.price) + ' coins';
        cell.appendChild(price);
        if (it.sellPrice > 0) {
          var sellHint = document.createElement('p');
          sellHint.className = 'text-[10px] text-slate-500';
          sellHint.textContent = 'Sells for ' + String(it.sellPrice);
          cell.appendChild(sellHint);
        }
      }
      cell.appendChild(btn);
      if (isOwner()) {
        var tools = document.createElement('div');
        tools.className = 'mt-2 flex w-full max-w-[8rem] gap-1';
        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'flex-1 rounded-lg border border-white/15 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/5';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', function () {
          openOwnerAddShop();
        });
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'flex-1 rounded-lg border border-rose-500/40 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-950/40';
        removeBtn.textContent = 'Remove';
        (function (item) {
          removeBtn.addEventListener('click', function () {
            showConfirm('Take ' + (item.label || item.texture) + ' off the shop?', function () {
              return api('/api/owner/shop/items/hide', {
                method: 'POST',
                body: JSON.stringify({ id: item.id }),
              }).then(function () {
                return loadShopCatalog();
              });
            });
          });
        })(it);
        tools.appendChild(editBtn);
        tools.appendChild(removeBtn);
        cell.appendChild(tools);
      }
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

  function closeOwnerAddShop() {
    var screen = document.getElementById('screenOwnerAddShop');
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
    var err = document.getElementById('ownerShopErr');
    if (err) {
      err.textContent = '';
      err.classList.add('hidden');
    }
  }

  function openShop() {
    closeOwnerAddShop();
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

  function openOwnerAddShop() {
    if (!isOwner()) return;
    closeShop();
    var screen = document.getElementById('screenOwnerAddShop');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    updateOwnerTierPreview();
    void loadOwnerShopManage();
  }

  function setOwnerManageErr(t) {
    var err = document.getElementById('ownerShopManageErr');
    if (!err) return;
    err.textContent = t || '';
    err.classList.toggle('hidden', !t);
  }

  function ownerField(labelText, value) {
    var wrap = document.createElement('label');
    wrap.className = 'block text-[11px] text-slate-500';
    wrap.textContent = labelText;
    var input = document.createElement('input');
    input.className = 'mt-0.5 block w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-white';
    if (labelText === 'Name' || labelText === 'Creator') {
      input.type = 'text';
      input.maxLength = labelText === 'Creator' ? 40 : 80;
      input.value = value || '';
    } else {
      input.type = 'number';
      input.min = labelText === 'Sell' ? '0' : '50';
      input.max = '1000000';
      input.value = value != null ? String(value) : '';
    }
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  function renderOwnerManage(data) {
    var listed = document.getElementById('ownerShopManageList');
    var hidden = document.getElementById('ownerShopHiddenList');
    if (!listed || !hidden) return;
    listed.innerHTML = '';
    hidden.innerHTML = '';
    var items = (data && data.items) || [];
    var hiddenItems = (data && data.hiddenItems) || [];
    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'text-xs text-slate-500';
      empty.textContent = 'Nothing in the shop yet.';
      listed.appendChild(empty);
    }
    items.forEach(function (it) {
      listed.appendChild(ownerManageRow(it, false));
    });
    if (!hiddenItems.length) {
      var none = document.createElement('li');
      none.className = 'text-xs text-slate-500';
      none.textContent = 'None.';
      hidden.appendChild(none);
    }
    hiddenItems.forEach(function (it) {
      hidden.appendChild(ownerManageRow(it, true));
    });
  }

  function ownerManageRow(it, isHidden) {
    var li = document.createElement('li');
    li.className = 'rounded-xl border border-white/10 bg-slate-900/60 p-3';
    var top = document.createElement('div');
    top.className = 'flex items-center gap-3';
    var img = document.createElement('img');
    img.src = itemImageUrl(it);
    img.alt = '';
    img.className = 'h-12 w-12 shrink-0 rounded-lg object-contain';
    var meta = document.createElement('div');
    meta.className = 'min-w-0';
    var tier = document.createElement('p');
    tier.className = 'text-[11px] font-semibold uppercase tracking-wide text-amber-200';
    tier.textContent = it.tierLabel || shopTierFromPrice(it.price).label;
    var idLine = document.createElement('p');
    idLine.className = 'truncate text-[11px] text-slate-500';
    idLine.textContent = it.texture || it.id;
    meta.appendChild(tier);
    meta.appendChild(idLine);
    top.appendChild(img);
    top.appendChild(meta);
    li.appendChild(top);
    if (!isHidden) {
      var name = ownerField('Name', it.label || '');
      var creator = ownerField('Creator', it.creator || '');
      var buy = ownerField('Buy', it.price);
      var sell = ownerField('Sell', it.sellPrice);
      name.wrap.className += ' mt-2';
      creator.wrap.className += ' mt-2';
      li.appendChild(name.wrap);
      li.appendChild(creator.wrap);
      var prices = document.createElement('div');
      prices.className = 'mt-2 grid grid-cols-2 gap-2';
      prices.appendChild(buy.wrap);
      prices.appendChild(sell.wrap);
      buy.input.addEventListener('input', function () {
        var t = shopTierFromPrice(buy.input.value);
        tier.textContent = buy.input.value === '' ? '—' : t.label;
      });
      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500';
      save.textContent = 'Save';
      save.addEventListener('click', function () {
        setOwnerManageErr('');
        save.disabled = true;
        api('/api/owner/shop/items/update', {
          method: 'POST',
          body: JSON.stringify({
            id: it.id,
            label: name.input.value,
            creator: creator.input.value,
            price: Number(buy.input.value),
            sellPrice: Number(sell.input.value),
          }),
        })
          .then(function () {
            return loadOwnerShopManage();
          })
          .catch(function (e) {
            setOwnerManageErr(String(e.message || e));
          })
          .then(function () {
            save.disabled = false;
          });
      });
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mt-2 ml-2 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-950/40';
      remove.textContent = 'Remove from shop';
      remove.addEventListener('click', function () {
        setOwnerManageErr('');
        remove.disabled = true;
        api('/api/owner/shop/items/hide', {
          method: 'POST',
          body: JSON.stringify({ id: it.id }),
        })
          .then(function () {
            return loadOwnerShopManage();
          })
          .catch(function (e) {
            setOwnerManageErr(String(e.message || e));
            remove.disabled = false;
          });
      });
      var actions = document.createElement('div');
      actions.appendChild(save);
      actions.appendChild(remove);
      li.appendChild(prices);
      li.appendChild(actions);
    } else {
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'mt-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5';
      back.textContent = 'Put back on shop';
      back.addEventListener('click', function () {
        setOwnerManageErr('');
        back.disabled = true;
        api('/api/owner/shop/items/restore', {
          method: 'POST',
          body: JSON.stringify({ id: it.id }),
        })
          .then(function () {
            return loadOwnerShopManage();
          })
          .catch(function (e) {
            setOwnerManageErr(String(e.message || e));
            back.disabled = false;
          });
      });
      var kept = document.createElement('p');
      kept.className = 'mt-2 text-xs text-slate-400';
      kept.textContent = (it.label || it.texture) + ' · buy ' + String(it.price) + ' · sell ' + String(it.sellPrice);
      li.appendChild(kept);
      li.appendChild(back);
    }
    return li;
  }

  async function loadOwnerShopManage() {
    setOwnerManageErr('');
    var data = await api('/api/owner/shop/items', { method: 'GET' });
    renderOwnerManage(data);
  }

  function updateOwnerTierPreview() {
    var priceEl = document.getElementById('ownerShopPrice');
    var preview = document.getElementById('ownerShopTierPreview');
    if (!preview) return;
    var raw = priceEl && priceEl.value;
    if (raw === '' || raw == null) {
      preview.textContent = '—';
      preview.className = 'font-semibold text-amber-200';
      return;
    }
    var t = shopTierFromPrice(raw);
    preview.textContent = t.label;
    preview.className = 'font-semibold';
  }

  function setOwnerShopErr(t) {
    var err = document.getElementById('ownerShopErr');
    if (!err) return;
    err.textContent = t || '';
    err.classList.toggle('hidden', !t);
  }

  async function submitOwnerShopItem() {
    setOwnerShopErr('');
    if (!isOwner()) {
      setOwnerShopErr('Owner only.');
      return;
    }
    var fileEl = document.getElementById('ownerShopImage');
    var labelEl = document.getElementById('ownerShopLabel');
    var creatorEl = document.getElementById('ownerShopCreator');
    var priceEl = document.getElementById('ownerShopPrice');
    var sellEl = document.getElementById('ownerShopSell');
    var btn = document.getElementById('ownerShopSubmit');
    var file = fileEl && fileEl.files && fileEl.files[0];
    if (!file) {
      setOwnerShopErr('Choose an image.');
      return;
    }
    if (file.size > 1536 * 1024) {
      setOwnerShopErr('Image must be 1.5 MB or smaller.');
      return;
    }
    var tok = getToken();
    if (!tok) {
      setOwnerShopErr('Sign in as owner.');
      return;
    }
    if (btn) btn.disabled = true;
    try {
      var res = await fetch(apiOrigin() + '/api/owner/shop/items', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + tok,
          'Content-Type': file.type || 'application/octet-stream',
          'X-Shop-Label': encodeURIComponent(String((labelEl && labelEl.value) || 'Shop item').slice(0, 80)),
          'X-Shop-Creator': encodeURIComponent(String((creatorEl && creatorEl.value) || '').slice(0, 40)),
          'X-Shop-Price': String((priceEl && priceEl.value) || ''),
          'X-Shop-Sell-Price': String((sellEl && sellEl.value) || ''),
        },
        body: file,
      });
      var text = await res.text();
      var data = null;
      try {
        if (text) data = JSON.parse(text);
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new Error((data && data.error) || text || 'Upload failed');
      }
      var item = data && data.item;
      if (fileEl) fileEl.value = '';
      if (labelEl) labelEl.value = '';
      if (creatorEl) creatorEl.value = '';
      if (priceEl) priceEl.value = '';
      if (sellEl) sellEl.value = '';
      updateOwnerTierPreview();
      closeOwnerAddShop();
      var screen = document.getElementById('screenCoinShop');
      if (screen) {
        screen.classList.remove('hidden');
        screen.classList.add('flex');
      }
      shopPage = item && item.page != null ? Number(item.page) : 1;
      await loadShopCatalog();
    } catch (e) {
      setOwnerShopErr(String(e.message || e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function syncOwnerAddShopFab() {
    var fab = document.getElementById('btnOwnerAddShopFab');
    var show = isOwner();
    if (fab) {
      fab.classList.toggle('hidden', !show);
      if (show) fab.style.display = 'flex';
      else fab.style.display = '';
    }
    if (!show) closeOwnerAddShop();
  }

  function bind() {
    var fab = document.getElementById('btnCoinShopFab');
    var close = document.getElementById('btnCoinShopClose');
    var prev = document.getElementById('shopBtnPrev');
    var next = document.getElementById('shopBtnNext');
    var yes = document.getElementById('shopConfirmYes');
    var no = document.getElementById('shopConfirmNo');
    var ownerFab = document.getElementById('btnOwnerAddShopFab');
    var ownerClose = document.getElementById('btnOwnerAddShopClose');
    var ownerSubmit = document.getElementById('ownerShopSubmit');
    var ownerPrice = document.getElementById('ownerShopPrice');

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
    if (ownerFab) ownerFab.addEventListener('click', openOwnerAddShop);
    if (ownerClose) ownerClose.addEventListener('click', closeOwnerAddShop);
    if (ownerSubmit) ownerSubmit.addEventListener('click', function () {
      void submitOwnerShopItem();
    });
    if (ownerPrice) {
      ownerPrice.addEventListener('input', updateOwnerTierPreview);
      ownerPrice.addEventListener('change', updateOwnerTierPreview);
    }
    syncOwnerAddShopFab();
    window.addEventListener('skyhop-auth-changed', syncOwnerAddShopFab);
  }

  window.SkyHopOpenCoinShop = openShop;
  window.SkyHopSyncOwnerAddShopFab = syncOwnerAddShopFab;
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
