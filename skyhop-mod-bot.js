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
  var wallJumpHeld = false;
  var wallJumpPressAt = 0;
  var wallJumpWaitUntil = 0;
  var airJumpUsed = false;
  var memory = {
    stage0: -1,
    deaths: -1,
    banned: {},
    banOrder: [],
    deathsAt: [],
    fails: {},
    path: null,
    edge: null,
    jumped: false,
    step: 0,
    hops: null,
    wasAir: false,
    builtAt: 0,
    holdUntil: 0,
    stuckAt: 0,
    settleUntil: 0,
    commitDir: 0,
    lastJumpAt: 0,
    lastJumpDir: 0,
    jumpFromX: 0,
    climbBase: 0,
    wallHops: 0,
    lessons: {},
    last: null,
  };
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

  function releaseJump() {
    var wasDown = jumpTimer || wallJumpHeld;
    if (jumpTimer) {
      clearTimeout(jumpTimer);
      jumpTimer = 0;
    }
    wallJumpHeld = false;
    if (wasDown) sendKey(binds().jump, false);
  }

  function releaseAll() {
    var b = binds();
    if (held.left) sendKey(b.left, false);
    if (held.right) sendKey(b.right, false);
    releaseJump();
    held.left = false;
    held.right = false;
  }

  function setHold(action, down) {
    var code = binds()[action];
    if (held[action] === down) return;
    held[action] = down;
    sendKey(code, down);
  }

  function tapJump() {
    if (jumpTimer || wallJumpHeld) return;
    var code = binds().jump;
    sendKey(code, true);
    jumpTimer = setTimeout(function () {
      jumpTimer = 0;
      sendKey(code, false);
    }, 45);
  }

  function holdJump(down) {
    var code = binds().jump;
    if (down) {
      if (jumpTimer) {
        clearTimeout(jumpTimer);
        jumpTimer = 0;
      }
      if (!wallJumpHeld) {
        sendKey(code, true);
        wallJumpHeld = true;
        wallJumpPressAt = performance.now();
      }
      return;
    }
    if (!wallJumpHeld) return;
    sendKey(code, false);
    wallJumpHeld = false;
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
    var probe = {
      x: dir < 0 ? st.x - 28 : st.x + st.w + 6,
      y: st.g < 0 ? foot - reach : foot,
      w: 28,
      h: reach,
    };
    return blocked(solids, probe);
  }

  function wallAhead(solids, st, dir) {
    if (!dir || !solids) return null;
    var box = {
      x: dir < 0 ? st.x - 10 : st.x + st.w,
      y: st.y + 4,
      w: 12,
      h: Math.max(10, (st.h || 40) - 10),
    };
    for (var i = 0; i < solids.length; i++) {
      if (overlap(box, solids[i])) return solids[i];
    }
    return null;
  }

  function wallRise(st, wall) {
    var foot = footY(st);
    if (st.g < 0) return wall.y + wall.h - foot;
    return foot - wall.y;
  }

  function wallSides(phy, stage, tSec, st) {
    var none = { left: false, right: false, rects: [] };
    if (!phy || typeof phy.wallTouching !== 'function' || typeof phy.buildWallJumpRects !== 'function') return none;
    if (!stage.platforms) return none;
    var rects = [];
    try {
      rects = phy.buildWallJumpRects(stage, tSec) || [];
    } catch (err) {
      return none;
    }
    return {
      left: phy.wallTouching(rects, -1, st.x, st.y, st.w, st.h),
      right: phy.wallTouching(rects, 1, st.x, st.y, st.w, st.h),
      rects: rects,
    };
  }

  function faceOnSide(rects, st, dir) {
    var best = null;
    for (var i = 0; i < rects.length; i++) {
      var w = rects[i];
      if (!w) continue;
      var gap = dir > 0 ? w.x - (st.x + st.w) : st.x - (w.x + w.w);
      if (gap < -14 || gap > 14) continue;
      if (st.y + st.h < w.y + 4 || st.y > w.y + w.h - 4) continue;
      if (!best || w.h > best.h) best = w;
    }
    return best;
  }

  function realWall(st, face) {
    if (!face || face.h < 48) return false;
    if (st.g < 0) return face.y + face.h > st.y + st.h * 0.55;
    return face.y < st.y + st.h * 0.35;
  }

  function beginStage(st) {
    memory.stage0 = st.stage0;
    memory.path = null;
    memory.edge = null;
    memory.hops = null;
    memory.step = 0;
    memory.jumped = false;
    memory.wasAir = false;
    memory.holdUntil = 0;
    memory.stuckAt = 0;
    memory.settleUntil = performance.now() + 220;
    memory.commitDir = 0;
    memory.lastJumpDir = 0;
    memory.climbBase = 0;
    wallJumpWaitUntil = 0;
    releaseAll();
    setNote('New stage. Planning from this layout.');
  }

  function ensureClimb(st, dir, wall) {
    var key = (memory.edge && memory.edge.key) || memory.stage0 + ':wall:' + Math.round(wall.x) + ',' + Math.round(wall.y);
    var top = st.g < 0 ? wall.y + wall.h : wall.y;
    memory.lessons[key] = 'climb';
    memory.edge = {
      kind: 'climb',
      dir: dir,
      takeoff: dir > 0 ? wall.x - 8 : wall.x + wall.w + 8,
      landX: wall.x + wall.w / 2,
      landY: top,
      key: key,
    };
    if (!memory.path || memory.path.length < 2) {
      memory.path = [
        { x0: st.x, x1: st.x + st.w, top: footY(st) },
        { x0: wall.x, x1: wall.x + wall.w, top: top },
      ];
    } else if (memory.path[1]) {
      memory.path[1] = { x0: wall.x, x1: wall.x + wall.w, top: top };
    }
    memory.builtAt = performance.now();
    memory.stuckAt = 0;
    setNote('Wall jumping up the wall.');
  }

  function adoptImproved(st, dir, wall) {
    var tallFace = realWall(st, wall);
    var kind = tallFace ? 'climb' : 'jump';
    var prev = memory.edge && memory.edge.kind;
    if (prev === 'climb') return false;
    if (prev === 'jump' && kind === 'jump') return false;
    if (kind === 'climb') {
      ensureClimb(st, dir, wall);
      return true;
    }
    var key = (memory.edge && memory.edge.key) || memory.stage0 + ':wall:' + Math.round(wall.x) + ',' + Math.round(wall.y);
    memory.lessons[key] = kind;
    var px = st.x + (st.w || 28) / 2;
    memory.edge = {
      kind: kind,
      dir: dir,
      takeoff: px,
      landX: dir > 0 ? wall.x + wall.w + (st.w || 28) : wall.x - (st.w || 28),
      landY: st.g < 0 ? wall.y + wall.h : wall.y,
      key: key,
    };
    memory.jumped = false;
    if (!memory.path || memory.path.length < 2) {
      memory.path = [
        { x0: st.x, x1: st.x + st.w, top: footY(st) },
        { x0: memory.edge.landX - 12, x1: memory.edge.landX + 12, top: memory.edge.landY },
      ];
    }
    memory.builtAt = performance.now();
    memory.stuckAt = 0;
    setNote(kind === 'climb' ? 'That wall is too tall to jump. Climbing it.' : 'Hit a wall. Jumping it instead.');
    return true;
  }

  function reachOf() {
    var C = window.SKYHOP_C || {};
    var grav = C.GRAVITY || 2400;
    var jumpV = Math.abs(C.JUMP_V || 720);
    var run = C.MAX_RUN || 320;
    var mult = C.WALL_JUMP_VY_MULT || 0.88;
    var height = (jumpV * jumpV) / (2 * grav);
    var air = (2 * jumpV) / grav;
    var wallV = jumpV * mult;
    return {
      height: height,
      horiz: run * air * 0.9,
      run: run,
      wallHeight: (wallV * wallV) / (2 * grav),
      wallKick: C.WALL_KICK || 300,
    };
  }

  function footY(st) {
    return st.g < 0 ? st.y : st.y + st.h;
  }

  function nodeKey(n) {
    return Math.round(n.x0 / 8) * 8 + ',' + Math.round(n.top / 8) * 8;
  }

  function edgeKey(stage0, a, b) {
    return stage0 + ':' + nodeKey(a) + '>' + nodeKey(b);
  }

  function setNote(text) {
    if (note) note.textContent = text || '';
  }

  function banEdge(key) {
    if (!key || memory.banned[key]) return;
    memory.banned[key] = true;
    memory.banOrder.push(key);
    if (memory.banOrder.length > 24) {
      var old = memory.banOrder.shift();
      delete memory.banned[old];
    }
  }

  function clearStageBans(stage0) {
    var prefix = stage0 + ':';
    memory.banOrder = memory.banOrder.filter(function (key) {
      if (key.indexOf(prefix) === 0) {
        delete memory.banned[key];
        return false;
      }
      return true;
    });
    memory.deathsAt = memory.deathsAt.filter(function (d) {
      return d.stage0 !== stage0;
    });
    memory.fails = {};
  }

  function nearDeath(stage0, x, y) {
    for (var i = 0; i < memory.deathsAt.length; i++) {
      var d = memory.deathsAt[i];
      if (d.stage0 !== stage0) continue;
      if (Math.abs(d.x - x) < 72 && Math.abs(d.y - y) < 70) return true;
    }
    return false;
  }

  function buildNodes(solids, st, goal) {
    var nodes = [];
    var g = st.g < 0 ? -1 : 1;
    var ph = st.h || 40;
    for (var i = 0; i < solids.length; i++) {
      var s = solids[i];
      if (!s || s.w < 18 || s.h < 8) continue;
      if (g > 0) {
        nodes.push({
          id: nodes.length,
          x0: s.x,
          x1: s.x + s.w,
          top: s.y,
          tall: s.h >= 88,
          goal: false,
        });
      } else {
        nodes.push({
          id: nodes.length,
          x0: s.x,
          x1: s.x + s.w,
          top: s.y + s.h,
          tall: s.h >= 88,
          goal: false,
        });
      }
    }
    if (goal && goal.w > 0) {
      nodes.push({
        id: nodes.length,
        x0: goal.x,
        x1: goal.x + goal.w,
        top: g > 0 ? goal.y + (goal.h || 0) : goal.y,
        tall: false,
        goal: true,
        gh: goal.h || 40,
      });
    }
    return nodes;
  }

  function findStart(nodes, st) {
    var px = st.x + st.w / 2;
    var foot = footY(st);
    var best = -1;
    var bestD = 1e9;
    var g = st.g < 0 ? -1 : 1;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.goal) continue;
      if (px < n.x0 - 10 || px > n.x1 + 10) continue;
      var d = g > 0 ? foot - n.top : n.top - foot;
      if (d < -14) continue;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function arcUnsafe(hazards, x0, y0, x1, y1, ph) {
    for (var i = 1; i <= 4; i++) {
      var t = i / 5;
      var box = {
        x: x0 + (x1 - x0) * t,
        y: y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * 36,
        w: 22,
        h: ph || 40,
      };
      if (blocked(hazards, box)) return true;
    }
    return false;
  }

  function climbSolid(solids, a, b) {
    var high = Math.min(a.top, b.top);
    var low = Math.max(a.top, b.top);
    var mid = (Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2;
    if (!isFinite(mid)) mid = (a.x0 + a.x1 + b.x0 + b.x1) / 4;
    for (var i = 0; i < solids.length; i++) {
      var s = solids[i];
      if (!s || s.h < 88) continue;
      if (s.y > high + 24) continue;
      if (s.y + s.h < low - 12) continue;
      if (s.x - 36 <= mid && s.x + s.w + 36 >= mid) return s;
    }
    return null;
  }

  function linkNodes(nodes, solids, hazards, st, stage0, respectDeaths) {
    var R = reachOf();
    var g = st.g < 0 ? -1 : 1;
    var ph = st.h || 40;
    var edges = [];
    for (var i = 0; i < nodes.length; i++) edges[i] = [];
    for (var a = 0; a < nodes.length; a++) {
      var A = nodes[a];
      if (A.goal) continue;
      for (var b = 0; b < nodes.length; b++) {
        if (a === b) continue;
        var B = nodes[b];
        var key = edgeKey(stage0, A, B);
        var learned = memory.lessons[key];
        if (memory.banned[key] || learned === 'ban') continue;
        var centerA = (A.x0 + A.x1) / 2;
        var centerB = (B.x0 + B.x1) / 2;
        var dx = Math.abs(centerB - centerA);
        var rise = g > 0 ? A.top - B.top : B.top - A.top;
        var overlap = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        var sameFloor = overlap > 8 && Math.abs(A.top - B.top) < 18;
        if (!sameFloor) {
          if (dx > R.horiz + 70 && Math.abs(rise) <= R.height + 24) continue;
          if (Math.abs(rise) > R.wallHeight * 6) continue;
          if (dx > 520) continue;
        }
        var dir = centerB >= centerA ? 1 : -1;
        var gap = dir > 0 ? B.x0 - A.x1 : A.x0 - B.x1;
        var takeoff = dir > 0 ? A.x1 - 10 : A.x0 + 10;
        var landX = Math.max(B.x0 + 8, Math.min(B.x1 - 8, centerB));
        var landY = B.goal ? B.top - (g > 0 ? 8 : -8) : B.top;
        if (respectDeaths && (nearDeath(stage0, takeoff, A.top) || nearDeath(stage0, landX, landY))) continue;
        var kind = '';
        var cost = 0;
        if (B.goal) {
          var bodyTop = g > 0 ? A.top - ph : A.top;
          var bodyBot = bodyTop + ph;
          var goalTop = g > 0 ? B.top - (B.gh || 40) : B.top;
          var goalBot = goalTop + (B.gh || 40);
          var yHit = bodyBot > goalTop - 8 && bodyTop < goalBot + 8;
          if (yHit && gap < R.horiz && gap > -A.x1) {
            kind = Math.abs(rise) > 36 || gap > 16 ? 'jump' : 'walk';
            cost = 20 + Math.abs(centerB - centerA);
          }
        } else if (overlap > 10 && Math.abs(A.top - B.top) < 16) {
          kind = 'walk';
          cost = dx;
        } else if (rise <= R.height + 16 && rise > -720 && gap < R.horiz + 24 && gap > -40) {
          if (gap > 12 || rise > 22) kind = 'jump';
          else if (rise < -28) kind = 'drop';
          else kind = 'walk';
          cost = dx + Math.abs(rise) * 0.35 + (kind === 'jump' ? 18 : kind === 'drop' ? 8 : 0);
        } else if (rise > R.height && rise < R.wallHeight * 6 && gap < 110 && gap > -48) {
          var wall = B.tall ? { x: B.x0, w: B.x1 - B.x0 } : climbSolid(solids, A, B);
          if (wall) {
            kind = 'climb';
            takeoff = dir > 0 ? wall.x - 8 : wall.x + wall.w + 8;
            cost = 70 + rise * 0.6;
          }
        }
        if (!kind) continue;
        if (learned === 'jump' && kind !== 'climb') {
          kind = 'jump';
          cost += 40;
        } else if (learned === 'climb') {
          var taught = climbSolid(solids, A, B) || (B.tall ? { x: B.x0, w: B.x1 - B.x0 } : null);
          if (taught) {
            kind = 'climb';
            takeoff = dir > 0 ? taught.x - 8 : taught.x + taught.w + 8;
            cost = 120 + Math.max(rise, 0) * 2;
          } else {
            kind = 'jump';
            cost += 40;
          }
        }
        if (kind !== 'walk' && arcUnsafe(hazards, takeoff, A.top - ph, landX, landY, ph)) continue;
        edges[a].push({
          to: b,
          kind: kind,
          cost: cost,
          takeoff: takeoff,
          dir: dir,
          key: key,
          landX: landX,
          landY: landY,
        });
      }
    }
    return edges;
  }

  function shortest(nodes, edges, start, goalId) {
    var n = nodes.length;
    var dist = [];
    var prev = [];
    var via = [];
    var used = [];
    var i;
    for (i = 0; i < n; i++) {
      dist[i] = 1e12;
      prev[i] = -1;
      via[i] = null;
      used[i] = false;
    }
    if (start < 0 || goalId < 0) return null;
    var goal = nodes[goalId];
    var gx = (goal.x0 + goal.x1) / 2;
    var gy = goal.top;
    function toward(i) {
      var n = nodes[i];
      var cx = (n.x0 + n.x1) / 2;
      return Math.hypot(cx - gx, (n.top - gy) * 0.5);
    }
    dist[start] = 0;
    for (var k = 0; k < n; k++) {
      var u = -1;
      var best = 1e12;
      for (i = 0; i < n; i++) {
        if (used[i]) continue;
        var score = dist[i] + toward(i);
        if (score < best) {
          best = score;
          u = i;
        }
      }
      if (u < 0 || dist[u] >= 1e12) break;
      used[u] = true;
      if (u === goalId) break;
      var list = edges[u];
      for (var e = 0; e < list.length; e++) {
        var edge = list[e];
        var nd = dist[u] + edge.cost;
        if (nd < dist[edge.to]) {
          dist[edge.to] = nd;
          prev[edge.to] = u;
          via[edge.to] = edge;
        }
      }
    }
    if (dist[goalId] >= 1e12) return null;
    var chain = [];
    var hops = [];
    var cur = goalId;
    var guard = 0;
    while (cur >= 0 && guard++ < n + 2) {
      chain.push(nodes[cur]);
      if (cur === start) break;
      hops.push(via[cur]);
      cur = prev[cur];
    }
    if (cur !== start) return null;
    chain.reverse();
    hops.reverse();
    return { nodes: chain, hops: hops, edge: hops[0] || null };
  }

  function goalDir(st, stage) {
    var goal = stage && stage.goal;
    var px = st.x + st.w / 2;
    if (!goal) return 1;
    var gx = goal.x + (goal.w || 0) / 2;
    if (gx > px + 8) return 1;
    if (gx < px - 8) return -1;
    return memory.commitDir || memory.lastJumpDir || 1;
  }

  function lockPlan(st, stage, plan) {
    if (!plan) return plan;
    var gdir = goalDir(st, stage);
    if (!memory.commitDir && gdir) memory.commitDir = gdir;
    var committed = memory.commitDir || gdir;
    if (plan.wallJump) return plan;
    if (committed && plan.dir && plan.dir !== committed) {
      plan.dir = committed;
      plan.jump = false;
      plan.air = false;
    }
    if (
      plan.jump &&
      memory.lastJumpDir &&
      plan.dir === -memory.lastJumpDir &&
      performance.now() - memory.lastJumpAt < 650
    ) {
      plan.jump = false;
      plan.dir = memory.lastJumpDir;
    }
    return plan;
  }

  function goalIndex(nodes) {
    for (var i = 0; i < nodes.length; i++) if (nodes[i].goal) return i;
    return -1;
  }

  function planRoute(stage, solids, hazards, st, respectDeaths) {
    var nodes = buildNodes(solids, st, stage.goal);
    var start = findStart(nodes, st);
    var goalId = goalIndex(nodes);
    if (start < 0 || goalId < 0) return null;
    if (start === goalId) return { nodes: [nodes[start]], edge: null };
    var edges = linkNodes(nodes, solids, hazards, st, st.stage0, respectDeaths);
    return shortest(nodes, edges, start, goalId);
  }

  function rememberDeath(st) {
    if (memory.edge && memory.edge.key) {
      memory.lessons[memory.edge.key] = 'ban';
      banEdge(memory.edge.key);
    }
    var at = memory.last || { x: st.x, y: st.y };
    memory.deathsAt.push({
      stage0: st.stage0,
      x: at.x + (st.w || 28) / 2,
      y: at.y + (st.h || 40) / 2,
    });
    if (memory.deathsAt.length > 12) memory.deathsAt.shift();
    memory.path = null;
    memory.edge = null;
    memory.hops = null;
    memory.step = 0;
    memory.jumped = false;
    memory.holdUntil = performance.now() + 120;
  }

  function sawDeath(st, stage) {
    if (typeof st.deaths === 'number') {
      var prev = memory.deaths;
      memory.deaths = st.deaths;
      return prev >= 0 && st.deaths > prev;
    }
    if (!memory.last || !stage.spawn) return false;
    var sp = stage.spawn;
    var back = Math.abs(st.x - sp.x) < 42 && Math.abs(footY(st) - sp.y) < 56;
    var far = Math.hypot(st.x - memory.last.x, st.y - memory.last.y) > 170;
    return back && far && st.og;
  }

  function arrivedAt(st, node) {
    if (!node) return false;
    var px = st.x + st.w / 2;
    var foot = footY(st);
    if (px < node.x0 - 14 || px > node.x1 + 14) return false;
    return Math.abs(foot - node.top) < 26;
  }

  function follow(st, route) {
    var next = route.nodes[1];
    var edge = route.edge;
    var px = st.x + st.w / 2;
    if (!next || !edge) {
      var goal = route.nodes[0];
      var tx = goal ? (goal.x0 + goal.x1) / 2 : px;
      return { dir: Math.abs(px - tx) < 8 ? 0 : px < tx ? 1 : -1, jump: false, wallJump: false };
    }
    var hold = performance.now() < memory.holdUntil;
    if (edge.kind === 'climb') {
      var toward = px < edge.takeoff ? 1 : -1;
      var atWall = Math.abs(px - edge.takeoff) < 40;
      return {
        dir: atWall ? edge.dir : toward,
        jump: !hold && st.og && atWall,
        wallJump: !hold && !st.og && atWall,
      };
    }
    if (edge.kind === 'jump') {
      if (!memory.jumped) {
        if (Math.abs(px - edge.takeoff) > 34) {
          return { dir: px < edge.takeoff ? 1 : -1, jump: false, wallJump: false };
        }
        return { dir: edge.dir, jump: !hold && st.og, wallJump: false };
      }
      var lx = edge.landX;
      return { dir: Math.abs(px - lx) < 10 ? 0 : px < lx ? 1 : -1, jump: false, wallJump: false };
    }
    if (edge.kind === 'drop') {
      return { dir: px < edge.takeoff ? 1 : -1, jump: false, wallJump: false };
    }
    var tx = (next.x0 + next.x1) / 2;
    return { dir: Math.abs(px - tx) < 8 ? 0 : px < tx ? 1 : -1, jump: false, wallJump: false };
  }

  function refreshRoute(stage, solids, hazards, st, force) {
    var movers = (stage.movingPlatforms && stage.movingPlatforms.length) || false;
    if (!movers && stage.platforms) {
      for (var i = 0; i < stage.platforms.length; i++) {
        if (stage.platforms[i] && stage.platforms[i].move) movers = true;
      }
    }
    var stale = movers && performance.now() - memory.builtAt > 900;
    if (!force && memory.path && !stale) return;
    var prevKey = memory.edge && memory.edge.key;
    var route = planRoute(stage, solids, hazards, st, true);
    if (!route) route = planRoute(stage, solids, hazards, st, false);
    if (!route) {
      clearStageBans(st.stage0);
      route = planRoute(stage, solids, hazards, st, false);
    }
    if (!route) {
      memory.path = null;
      memory.edge = null;
      return;
    }
    memory.path = route.nodes;
    memory.hops = route.hops || null;
    memory.step = 0;
    memory.edge = (route.hops && route.hops[0]) || route.edge || null;
    memory.builtAt = performance.now();
    if (!memory.edge || memory.edge.key !== prevKey) memory.jumped = false;
    if (!prevKey) setNote('Route ready.');
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
    var tSec = performance.now() * 0.001;
    var solids = phy.buildSolidRects(stage, tSec);
    var hazards = hazardList(stage);
    if (st.stage0 !== memory.stage0) beginStage(st);
    if (!st.og && performance.now() < memory.settleUntil) {
      releaseAll();
      memory.last = { x: st.x, y: st.y, w: st.w, h: st.h };
      return;
    }
    if (st.og) memory.settleUntil = 0;
    var died = sawDeath(st, stage);
    if (died) {
      rememberDeath(st);
      setNote('Died on that route. Trying another way.');
    }
    var landed = memory.wasAir && st.og;
    memory.wasAir = !st.og;
    if (!died && landed && memory.edge && memory.edge.kind === 'climb') {
      var foot = footY(st);
      var below = st.g < 0 ? foot < memory.edge.landY - 12 : foot > memory.edge.landY + 12;
      if (below) memory.jumped = false;
    } else if (!died && landed && memory.jumped && memory.edge && memory.edge.kind !== 'climb') {
      var target = memory.path && memory.path[(memory.step || 0) + 1];
      if (target && !arrivedAt(st, target)) {
        var missed = memory.edge.key;
        if (missed) {
          memory.fails[missed] = (memory.fails[missed] || 0) + 1;
          if (memory.fails[missed] >= 1) {
          banEdge(missed);
          memory.commitDir = goalDir(st, stage) || memory.commitDir;
        }
        }
        memory.jumped = false;
        memory.path = null;
        memory.hops = null;
        setNote('That jump missed. Trying another way.');
      }
    }
    if (landed) airJumpUsed = false;
    var hopIndex = memory.step || 0;
    var landedOn = memory.path && memory.path[hopIndex + 1];
    if (st.og && landedOn && memory.edge && memory.edge.kind !== 'climb' && arrivedAt(st, landedOn)) {
      memory.step = hopIndex + 1;
      memory.jumped = false;
      memory.edge = memory.hops && memory.hops[memory.step] ? memory.hops[memory.step] : null;
      hopIndex = memory.step;
    }
    refreshRoute(stage, solids, hazards, st, died || !memory.path);
    var plan;
    if (memory.path) {
      var at = memory.step || 0;
      plan = follow(st, { nodes: [memory.path[at], memory.path[at + 1]], edge: memory.edge });
      if (memory.edge && memory.edge.kind === 'jump' && memory.jumped && !st.og && stage.doubleJump && !airJumpUsed) {
        var falling = st.g < 0 ? st.vy < -40 : st.vy > 80;
        var short =
          (memory.edge.dir > 0 && st.x + st.w < memory.edge.landX - 24) ||
          (memory.edge.dir < 0 && st.x > memory.edge.landX + 24);
        if (falling && short) plan.air = true;
      }
    } else {
      var px = st.x + st.w / 2;
      var goal = stage.goal;
      var gx = goal ? goal.x + (goal.w || 0) / 2 : px;
      var dir = Math.abs(gx - px) < 10 ? 0 : gx > px ? 1 : -1;
      if (dir && st.og && !groundAhead(solids, st, dir, reachOf().height)) dir = 0;
      plan = { dir: dir, jump: false, wallJump: false };
    }
    var touch = wallSides(phy, stage, tSec, st);
    if (!st.og && plan.dir && ((plan.dir > 0 && touch.right) || (plan.dir < 0 && touch.left))) {
      var face = faceOnSide(touch.rects, st, plan.dir);
      if (realWall(st, face) && wallRise(st, face) > reachOf().height * 0.45) {
        ensureClimb(st, plan.dir, face);
        plan.dir = plan.dir;
        plan.jump = false;
        plan.air = false;
        plan.wallJump = true;
      }
    }
    plan = lockPlan(st, stage, plan);
    setHold('left', plan.dir < 0);
    setHold('right', plan.dir > 0);
    var blocking = st.og && plan.dir ? wallAhead(solids, st, plan.dir) : null;
    var kindNow = memory.edge && memory.edge.kind;
    if (blocking && (!kindNow || kindNow === 'walk' || kindNow === 'drop')) {
      if (adoptImproved(st, plan.dir, blocking) && memory.path) {
        plan = follow(st, { nodes: memory.path, edge: memory.edge });
        setHold('left', plan.dir < 0);
        setHold('right', plan.dir > 0);
      }
    } else if (blocking && kindNow === 'jump' && !memory.jumped) {
      if (Math.abs(st.x + st.w / 2 - memory.edge.takeoff) > 80) {
        memory.edge.takeoff = memory.edge.dir > 0 ? st.x + st.w + 18 : st.x - 18;
      }
      plan = follow(st, { nodes: [memory.path[memory.step || 0], memory.path[(memory.step || 0) + 1]], edge: memory.edge });
      setHold('left', plan.dir < 0);
      setHold('right', plan.dir > 0);
    }
    plan = lockPlan(st, stage, plan);
    setHold('left', plan.dir < 0);
    setHold('right', plan.dir > 0);
    if (st.og && plan.dir && !plan.jump && !plan.wallJump && Math.abs(st.vx) < 14) {
      if (!memory.stuckAt) memory.stuckAt = performance.now();
      else if (performance.now() - memory.stuckAt > 280 && memory.edge && memory.edge.key) {
        var failed = memory.edge.kind;
        if (failed === 'jump') memory.lessons[memory.edge.key] = 'climb';
        else memory.lessons[memory.edge.key] = 'ban';
        banEdge(memory.edge.key);
        memory.path = null;
        memory.edge = null;
        memory.hops = null;
        memory.step = 0;
        memory.jumped = false;
        memory.stuckAt = 0;
        memory.commitDir = memory.commitDir ? -memory.commitDir : goalDir(st, stage);
        memory.lastJumpDir = 0;
        setNote('That try failed. Taking the other way.');
      }
    } else {
      memory.stuckAt = 0;
    }
    if (plan.wallJump) {
      var footNow = footY(st);
      if (!memory.climbBase) memory.climbBase = footNow;
      var climbed = st.g < 0 ? footNow - memory.climbBase : memory.climbBase - footNow;
      if ((memory.wallHops || 0) >= 2 && climbed < 28) {
        plan.wallJump = false;
        plan.jump = false;
        plan.dir = memory.commitDir || plan.dir;
        memory.wallHops = 0;
        memory.climbBase = 0;
        memory.path = null;
        memory.edge = null;
        memory.hops = null;
        memory.step = 0;
        setNote('That wall is not working. Taking another route.');
      }
    }
    if (plan.wallJump) {
      var away = (plan.dir > 0 && st.vx < -120) || (plan.dir < 0 && st.vx > 120);
      var nowMs = performance.now();
      if (nowMs < wallJumpWaitUntil) {
        holdJump(false);
      } else if (!wallJumpHeld) {
        holdJump(true);
        memory.wallHops = (memory.wallHops || 0) + 1;
      } else if (away) {
        holdJump(false);
        wallJumpWaitUntil = nowMs + 230;
      } else if (nowMs - wallJumpPressAt > 110) {
        holdJump(false);
        wallJumpWaitUntil = nowMs + 40;
      }
      memory.last = { x: st.x, y: st.y, w: st.w, h: st.h };
      return;
    }
    holdJump(false);
    if (plan.jump && (!memory.edge || memory.edge.kind !== 'climb')) {
      memory.jumped = true;
      memory.lastJumpAt = performance.now();
      memory.lastJumpDir = plan.dir || memory.commitDir || 0;
      memory.jumpFromX = st.x;
    }
    if (plan.jump) tapJump(); else if (plan.air) {
      airJumpUsed = true;
      tapJump();
    }
    memory.last = { x: st.x, y: st.y, w: st.w, h: st.h };
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
    wallJumpWaitUntil = 0;
    memory.path = null;
    memory.edge = null;
    memory.hops = null;
    memory.step = 0;
    memory.jumped = false;
    memory.wasAir = false;
    memory.stage0 = -1;
    memory.deaths = -1;
    memory.banned = {};
    memory.banOrder = [];
    memory.deathsAt = [];
    memory.fails = {};
    memory.lessons = {};
    memory.stuckAt = 0;
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
