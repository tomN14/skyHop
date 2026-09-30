/**
 * Play-assist mod. Turn it on during a run and it walks, jumps, and heads for the goal
 * using the live stage and the keys you actually have bound.
 * Anticheat on: solo runs shut the assist off. Races and collabs keep reporting the
 * synthetic keys so the server can remove you. Anticheat off: it plays.
 */
(function () {
  if (window.__SKYHOP_MOD_BOT__) return;
  window.__SKYHOP_MOD_BOT__ = true;

  var enabled = false;
  var timer = 0;
  var held = { left: false, right: false };
  var jumpTimer = 0;
  var airJumpUsed = false;
  var stuckSince = 0;
  var panel = null;
  var btn = null;
  var note = null;

  function play() {
    var S = window.SKYHOP;
    if (!S || typeof S.getPlayState !== 'function') return null;
    return S.getPlayState();
  }

  function anticheatOn() {
    var ac = window.SkyHopRunAnticheat;
    if (!ac || typeof ac.isRunOn !== 'function') return false;
    return ac.isRunOn() !== false;
  }

  function binds() {
    var kb = window.SkyHopKeybinds;
    if (kb && typeof kb.getBinds === 'function') return kb.getBinds();
    return { left: 'ArrowLeft', right: 'ArrowRight', jump: 'Space' };
  }

  function keyName(code) {
    if (code === 'Space') return ' ';
    if (code && code.indexOf('Key') === 0 && code.length === 4) return code.slice(3).toLowerCase();
    if (code && code.indexOf('Digit') === 0) return code.slice(5);
    return code || '';
  }

  function sendKey(code, down) {
    if (!code) return;
    try {
      window.dispatchEvent(
        new KeyboardEvent(down ? 'keydown' : 'keyup', {
          code: code,
          key: keyName(code),
          bubbles: true,
          cancelable: true,
        })
      );
    } catch (err) {
      /* */
    }
  }

  function releaseAll() {
    var b = binds();
    if (held.left) sendKey(b.left, false);
    if (held.right) sendKey(b.right, false);
    if (jumpTimer) sendKey(b.jump, false);
    held.left = false;
    held.right = false;
    jumpTimer = 0;
  }

  function setHold(action, down) {
    var code = binds()[action];
    if (held[action] === down) return;
    held[action] = down;
    sendKey(code, down);
  }

  function tapJump() {
    if (jumpTimer) return;
    var code = binds().jump;
    sendKey(code, true);
    jumpTimer = setTimeout(function () {
      jumpTimer = 0;
      sendKey(code, false);
    }, 45);
  }

  function stages() {
    if (window.SKYHOP_ACTIVE_STAGES && window.SKYHOP_ACTIVE_STAGES.length) return window.SKYHOP_ACTIVE_STAGES;
    if (window.SKYHOP_STAGES && window.SKYHOP_STAGES.length) return window.SKYHOP_STAGES;
    return [];
  }

  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function hazardList(stage) {
    var out = [];
    var groups = [stage.spikes, stage.lava];
    for (var g = 0; g < groups.length; g++) {
      var list = groups[g];
      if (!list) continue;
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (r && r.w > 0 && r.h > 0) out.push(r);
      }
    }
    return out;
  }

  function blocked(rects, box) {
    for (var i = 0; i < rects.length; i++) {
      if (overlap(box, rects[i])) return true;
    }
    return false;
  }

  function groundAhead(solids, st, dir, reach) {
    var foot = st.g < 0 ? st.y : st.y + st.h;
    var step = dir < 0 ? -1 : 1;
    var x = st.x + (dir > 0 ? st.w : 0) + step * 6;
    var probe = { x: x, y: st.g < 0 ? foot - reach : foot, w: Math.max(8, Math.abs(step) * 28), h: reach };
    if (dir < 0) probe.x = st.x - 28;
    return blocked(solids, probe);
  }

  function decide(st, stage, solids) {
    var goal = stage.goal;
    var px = st.x + st.w / 2;
    var gx = goal ? goal.x + (goal.w || 0) / 2 : px + 200;
    var dir = 0;
    if (gx > px + 10) dir = 1;
    else if (gx < px - 10) dir = -1;

    var C = window.SKYHOP_C || {};
    var jumpReach = 96;
    var ahead = {
      x: dir < 0 ? st.x - 22 : st.x + st.w,
      y: st.y + 4,
      w: 22,
      h: Math.max(8, st.h - 8),
    };
    var wall = dir !== 0 && blocked(solids, ahead);
    var gap = dir !== 0 && st.og && !groundAhead(solids, st, dir, jumpReach);
    var hurt = blocked(hazardList(stage), ahead);
    var goalAbove = false;
    if (goal) {
      var gy = goal.y + (goal.h || 0) / 2;
      var py = st.y + st.h / 2;
      goalAbove = st.g < 0 ? gy > py + 36 : gy < py - 36;
    }
    var falling = st.g < 0 ? st.vy < -40 : st.vy > 40;
    var needAir = !st.og && falling && (gap || hurt || goalAbove) && stage.doubleJump && !airJumpUsed;
    var needJump = st.og && (wall || gap || hurt || goalAbove);

    if (Math.abs(st.vx) < 12 && dir !== 0 && st.og) {
      if (!stuckSince) stuckSince = performance.now();
      else if (performance.now() - stuckSince > 280) needJump = true;
    } else {
      stuckSince = 0;
    }
    if (st.og) airJumpUsed = false;

    return { dir: dir, jump: needJump || needAir, air: needAir, maxRun: C.MAX_RUN || 320 };
  }

  function showPanel(on) {
    if (!panel) return;
    panel.style.display = on ? 'flex' : 'none';
  }

  function tick() {
    var st = play();
    var inRun = st && (st.mode === 'playing' || st.mode === 'paused');
    showPanel(!!inRun);
    if (!enabled) return;
    if (!st || st.mode !== 'playing') {
      releaseAll();
      return;
    }
    if (anticheatOn() && !st.live) {
      shutOff('Anticheat is on, so the assist stopped.');
      return;
    }
    var list = stages();
    var stage = list[st.stage0];
    var phy = window.SKYHOP_PHYSICS;
    if (!stage || !phy || typeof phy.buildSolidRects !== 'function') {
      releaseAll();
      return;
    }
    var solids = phy.buildSolidRects(stage, performance.now() * 0.001);
    var plan = decide(st, stage, solids);
    setHold('left', plan.dir < 0);
    setHold('right', plan.dir > 0);
    if (plan.jump) {
      if (plan.air) airJumpUsed = true;
      tapJump();
    }
  }

  function shutOff(message) {
    enabled = false;
    releaseAll();
    if (btn) {
      btn.textContent = 'Bot OFF';
      btn.setAttribute('aria-pressed', 'false');
    }
    if (note) note.textContent = message || '';
  }

  function turnOn() {
    var st = play();
    if (!st || (st.mode !== 'playing' && st.mode !== 'paused')) return;
    enabled = true;
    airJumpUsed = false;
    stuckSince = 0;
    if (btn) {
      btn.textContent = 'Bot ON';
      btn.setAttribute('aria-pressed', 'true');
    }
    if (note) {
      note.textContent = anticheatOn()
        ? st.live
          ? 'Anticheat is on. Online sessions will remove scripted play.'
          : 'Anticheat is on, so this will not move you.'
        : 'Playing toward the goal.';
    }
    if (anticheatOn() && !st.live) {
      shutOff('Anticheat is on, so the assist stopped.');
    }
  }

  function turnOff() {
    var st = play();
    var was = enabled;
    shutOff('Off.');
    if (was && st && st.mode === 'playing' && window.SKYHOP && typeof window.SKYHOP.dieFromScript === 'function') {
      window.SKYHOP.dieFromScript();
    }
  }

  function mount() {
    panel = document.createElement('div');
    panel.setAttribute('data-skyhop-mod-ui', '1');
    panel.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:9999;display:none;flex-direction:column;gap:6px;' +
      'padding:10px 12px;border-radius:12px;background:rgba(15,23,42,0.92);' +
      'border:1px solid rgba(125,211,252,0.45);color:#e2e8f0;font:13px/1.3 system-ui,sans-serif;';
    var title = document.createElement('div');
    title.textContent = 'Play assist';
    title.style.fontWeight = '700';
    btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Bot OFF';
    btn.setAttribute('aria-pressed', 'false');
    btn.style.cssText =
      'border:0;border-radius:8px;padding:6px 10px;cursor:pointer;background:#0e7490;color:white;font-weight:700;';
    note = document.createElement('div');
    note.style.cssText = 'max-width:220px;color:#94a3b8;font-size:12px;';
    btn.addEventListener('click', function () {
      if (enabled) turnOff();
      else turnOn();
    });
    panel.appendChild(title);
    panel.appendChild(btn);
    panel.appendChild(note);
    document.body.appendChild(panel);
    timer = setInterval(tick, 50);
  }

  window.addEventListener('skyhop-scripted-input', function () {
    if (!enabled) return;
    var st = play();
    if (st && st.live) return;
    shutOff('Anticheat blocked scripted input.');
  });

  function teardown() {
    enabled = false;
    releaseAll();
    if (timer) clearInterval(timer);
    timer = 0;
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    window.__SKYHOP_MOD_BOT__ = false;
  }

  var modId = window.__skyhopInjectedModId;
  if (modId && typeof window.SkyHopRegisterModTeardown === 'function') {
    window.SkyHopRegisterModTeardown(modId, teardown);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
