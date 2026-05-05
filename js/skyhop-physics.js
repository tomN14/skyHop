(function () {
  const P = {
    rectsOverlap(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
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

    buildSolidRects(stage, tSec) {
      const out = [];
      for (const p of stage.platforms) {
        out.push(P.resolveMovingRect(p, tSec));
      }
      const mp = stage.movingPlatforms;
      if (mp) {
        for (const p of mp) {
          out.push(P.resolveMovingRect(p, tSec));
        }
      }
      return out;
    },

    /** Solids the epic boss collides with (omit `bossPassThrough` platforms: side beams, etc.). */
    buildBossSolidRects(stage, tSec) {
      const out = [];
      for (const p of stage.platforms) {
        if (p.bossPassThrough) continue;
        out.push(P.resolveMovingRect(p, tSec));
      }
      const mp = stage.movingPlatforms;
      if (mp) {
        for (const p of mp) {
          if (p.bossPassThrough) continue;
          out.push(P.resolveMovingRect(p, tSec));
        }
      }
      return out;
    },

    /** Surfaces that allow wall-jumps / air-jump wall checks (excludes `noWallJump` platforms). */
    buildWallJumpRects(stage, tSec) {
      const out = [];
      for (const p of stage.platforms) {
        if (p.noWallJump) continue;
        out.push(P.resolveMovingRect(p, tSec));
      }
      const mp = stage.movingPlatforms;
      if (mp) {
        for (const p of mp) {
          if (p.noWallJump) continue;
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
        if (p.move) list.push(p);
      }
      for (const p of stage.movingPlatforms || []) {
        list.push(p);
      }
      for (const p of list) {
        const r0 = P.resolveMovingRect(p, t0);
        const r1 = P.resolveMovingRect(p, tSec);
        const yMover = p.move && p.move.axis === 'y';
        const ySlackTop = yMover ? 12 : 3;
        const ySlackIn = yMover ? 36 : 14;
        const xPad = yMover ? 10 : 4;
        const onTop =
          midx >= r0.x - xPad &&
          midx <= r0.x + r0.w + xPad &&
          feet >= r0.y - ySlackTop &&
          feet <= r0.y + ySlackIn;
        if (onTop) {
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
    snapRiderToYMoverTopIfClose(stage, tSec, player) {
      const pw = player.w;
      const ph = player.h;
      const feet = player.y + ph;
      const midx = player.x + pw / 2;
      const edge = 2;
      const tryRider = (p) => {
        if (!p.move || p.move.axis !== 'y') return false;
        const r1 = P.resolveMovingRect(p, tSec);
        const onTop =
          midx >= r1.x - 12 &&
          midx <= r1.x + r1.w + 12 &&
          feet >= r1.y - 16 &&
          feet <= r1.y + 40;
        if (!onTop) return false;
        player.y = r1.y - ph - 0.01;
        const xMin = r1.x + edge;
        const xMax = r1.x + r1.w - pw - edge;
        if (xMax > xMin) {
          if (player.x < xMin) player.x = xMin;
          else if (player.x > xMax) player.x = xMax;
        }
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
