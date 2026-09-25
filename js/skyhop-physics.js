(function () {
  const P = {
    rectsOverlap(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    },

    /** False when a toggle has removed the object. Invisible objects stay solid. */
    isPresent(obj) {
      if (!obj || !obj.affectByToggle) return true;
      return !obj.toggleOff;
    },

    circleRectOverlap(cx, cy, r, rx, ry, rw, rh) {
      const nx = Math.max(rx, Math.min(cx, rx + rw));
      const ny = Math.max(ry, Math.min(cy, ry + rh));
      const dx = cx - nx;
      const dy = cy - ny;
      return dx * dx + dy * dy < r * r;
    },

    resolveMovingRect(p, tSec) {
      const m = p.move;
      if (!m) return { x: p.x, y: p.y, w: p.w, h: p.h };
      const off = Math.sin(tSec * m.omega + (m.phase || 0)) * m.amp;
      if (m.axis === 'y') return { x: p.x, y: p.y + off, w: p.w, h: p.h };
      return { x: p.x + off, y: p.y, w: p.w, h: p.h };
    },

    rectsMatch(a, b) {
      return (
        Math.abs(a.x - b.x) < 0.5 &&
        Math.abs(a.y - b.y) < 0.5 &&
        Math.abs(a.w - b.w) < 0.5 &&
        Math.abs(a.h - b.h) < 0.5
      );
    },

    isRidingTopOfYMoverRect(player, r, slackX, slackYTop, slackYBelow) {
      const pw = player.w;
      const ph = player.h;
      const feet = player.y + ph;
      const midx = player.x + pw / 2;
      const sx = slackX != null ? slackX : 14;
      const syT = slackYTop != null ? slackYTop : 18;
      const syB = slackYBelow != null ? slackYBelow : 44;
      return (
        midx >= r.x - sx &&
        midx <= r.x + r.w + sx &&
        feet >= r.y - syT &&
        feet <= r.y + syB
      );
    },

    /** Y-movers the player is standing on — skip their sides for horizontal resolve (prevents being shoved off). */
    buildSolidRectsForXResolve(stage, tSec, player) {
      const all = P.buildSolidRects(stage, tSec);
      const skip = [];
      const list = [];
      for (const p of stage.platforms || []) {
        if (P.isPresent(p) && p.move && p.move.axis === 'y') list.push(p);
      }
      for (const p of stage.movingPlatforms || []) {
        if (P.isPresent(p) && p.move && p.move.axis === 'y') list.push(p);
      }
      for (const p of list) {
        const r = P.resolveMovingRect(p, tSec);
        if (P.isRidingTopOfYMoverRect(player, r)) skip.push(r);
      }
      if (!skip.length) return all;
      return all.filter((r) => !skip.some((s) => P.rectsMatch(r, s)));
    },

    buildSolidRects(stage, tSec) {
      const out = [];
      for (const p of stage.platforms || []) {
        if (!P.isPresent(p)) continue;
        out.push(P.resolveMovingRect(p, tSec));
      }
      const mp = stage.movingPlatforms;
      if (mp) {
        for (const p of mp) {
          if (!P.isPresent(p)) continue;
          out.push(P.resolveMovingRect(p, tSec));
        }
      }
      return out;
    },

    /** Solids the epic boss collides with (omit `bossPassThrough` platforms: side beams, etc.). */
    buildBossSolidRects(stage, tSec) {
      const out = [];
      for (const p of stage.platforms || []) {
        if (!P.isPresent(p) || p.bossPassThrough) continue;
        out.push(P.resolveMovingRect(p, tSec));
      }
      const mp = stage.movingPlatforms;
      if (mp) {
        for (const p of mp) {
          if (!P.isPresent(p) || p.bossPassThrough) continue;
          out.push(P.resolveMovingRect(p, tSec));
        }
      }
      return out;
    },

    /** Surfaces that allow wall-jumps / air-jump wall checks (excludes `noWallJump` platforms). */
    buildWallJumpRects(stage, tSec) {
      const out = [];
      for (const p of stage.platforms) {
        if (!P.isPresent(p) || p.noWallJump) continue;
        out.push(P.resolveMovingRect(p, tSec));
      }
      const mp = stage.movingPlatforms;
      if (mp) {
        for (const p of mp) {
          if (!P.isPresent(p) || p.noWallJump) continue;
          out.push(P.resolveMovingRect(p, tSec));
        }
      }
      return out;
    },

    solidCollide(rects, px, py, pw, ph) {
      const test = { x: px, y: py, w: pw, h: ph };
      for (const s of rects) {
        if (P.rectsOverlap(test, s)) return s;
      }
      return null;
    },

    wallTouching(rects, dir, playerX, playerY, pw, ph) {
      const pad = 4;
      const inset = 6;
      let probe;
      if (dir < 0) {
        probe = { x: playerX - pad, y: playerY + inset, w: pad, h: ph - inset * 2 };
      } else {
        probe = { x: playerX + pw, y: playerY + inset, w: pad, h: ph - inset * 2 };
      }
      for (const s of rects) {
        if (P.rectsOverlap(probe, s)) return true;
      }
      return false;
    },

    /** Sum carry from all movers the player is standing on (feet on top surface). */
    movingPlatformCarry(stage, tSec, dt, playerX, playerY, pw, ph) {
      const t0 = Math.max(0, tSec - dt);
      let dx = 0;
      let dy = 0;
      const feet = playerY + ph;
      const midx = playerX + pw / 2;
      const list = [];
      for (const p of stage.platforms) {
        if (p.move && P.isPresent(p)) list.push(p);
      }
      for (const p of stage.movingPlatforms || []) {
        if (P.isPresent(p)) list.push(p);
      }
      for (const p of list) {
        const r0 = P.resolveMovingRect(p, t0);
        const r1 = P.resolveMovingRect(p, tSec);
        const yMover = p.move && p.move.axis === 'y';
        const ySlackTop = yMover ? 18 : 3;
        const ySlackBelow = yMover ? 6 : 14;
        const xPad = yMover ? 14 : 4;
        const onR0 =
          midx >= r0.x - xPad &&
          midx <= r0.x + r0.w + xPad &&
          feet >= r0.y - ySlackTop &&
          feet <= r0.y + ySlackBelow;
        const onR1 =
          yMover &&
          midx >= r1.x - xPad &&
          midx <= r1.x + r1.w + xPad &&
          feet >= r1.y - ySlackTop &&
          feet <= r1.y + ySlackBelow;
        if (onR0 || onR1) {
          dx += r1.x - r0.x;
          dy += r1.y - r0.y;
        }
      }
      return { dx, dy };
    },

    /**
     * After physics, lock the player to a y-mover: snap feet to the moving top and clamp X
     * inside the platform so input / friction can’t walk you off the edge, and x-resolves can’t
     * spill you over the short ledge.
     */
    snapRiderToYMoverTopIfClose(stage, tSec, player, gravityDir) {
      const gDir = gravityDir != null && gravityDir < 0 ? -1 : 1;
      if (player.vy * gDir < -28) return;
      const pw = player.w;
      const ph = player.h;
      const edge = 2;
      const tryRider = (p) => {
        if (!P.isPresent(p) || !p.move || p.move.axis !== 'y') return false;
        const r1 = P.resolveMovingRect(p, tSec);
        if (!P.isRidingTopOfYMoverRect(player, r1, 14, 16, 8)) return false;
        player.y = r1.y - ph - 0.01;
        const xMin = r1.x + edge;
        const xMax = r1.x + r1.w - pw - edge;
        if (xMax > xMin) {
          if (player.x < xMin) player.x = xMin;
          else if (player.x > xMax) player.x = xMax;
        }
        if (player.vy * gDir >= -8) player.vy = 0;
        player.onGround = true;
        return true;
      };
      for (const p of stage.platforms || []) {
        if (tryRider(p)) return;
      }
      for (const p of stage.movingPlatforms || []) {
        if (tryRider(p)) return;
      }
    },

    /** Ray vs axis-aligned rect: returns distance to first hit or null. Origin ox,oy direction dx,dy (normalized). */
    raySolidHit(ox, oy, rdx, rdy, maxDist, solidRects) {
      let best = maxDist;
      let hit = false;
      for (const r of solidRects) {
        const invX = rdx !== 0 ? 1 / rdx : Infinity;
        const invY = rdy !== 0 ? 1 / rdy : Infinity;
        let t1 = (r.x - ox) * invX;
        let t2 = (r.x + r.w - ox) * invX;
        let t3 = (r.y - oy) * invY;
        let t4 = (r.y + r.h - oy) * invY;
        const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
        const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
        if (tmax < 0 || tmin > tmax) continue;
        const t = tmin >= 0 ? tmin : tmax;
        if (t >= 0 && t < best) {
          best = t;
          hit = true;
        }
      }
      return hit ? best : null;
    },
  };

  window.SKYHOP_PHYSICS = P;
})();
