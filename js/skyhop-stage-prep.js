(function () {
  const C = window.SKYHOP_C;
  const LAVA_SHRINK = C.LAVA_VISUAL_BLOCK_PX * 2;

  function staticUnderhangSupportBottomY(stage) {
    const lava = stage.lava;
    if (lava && lava.length) {
      let y = Infinity;
      for (const L of lava) y = Math.min(y, L.y);
      return y;
    }
    return stage.worldH;
  }

  function appendStaticUnderhangSupports(stage) {
    if (stage.underhangDisabled) return;
    const bottomY = staticUnderhangSupportBottomY(stage);
    const base = stage.platforms.slice();
    const UW = C.STATIC_UNDERHANG_W;
    const maxPh = C.STATIC_UNDERHANG_MAX_PLATFORM_H;
    const uyMin = stage.underhangPlatformYMin;
    const uyMax = stage.underhangPlatformYMax;
    const uxMax = stage.underhangPlatformXMax;
    const uxMin = stage.underhangPlatformXMin;
    for (const p of base) {
      if (p.move) continue;
      if (p.h > maxPh) continue;
      if (p.w < 36) continue;
      if (uyMin != null && p.y < uyMin) continue;
      if (uyMax != null && p.y > uyMax) continue;
      if (uxMin != null && p.x < uxMin) continue;
      if (uxMax != null && p.x > uxMax) continue;
      const top = p.y + p.h;
      const h = bottomY - top;
      if (h < 4) continue;
      if (p.w >= UW * 2) {
        stage.platforms.push({ x: p.x, y: top, w: UW, h });
        stage.platforms.push({ x: p.x + p.w - UW, y: top, w: UW, h });
      } else {
        const cw = Math.min(UW, Math.max(20, p.w - 8));
        stage.platforms.push({ x: p.x + (p.w - cw) / 2, y: top, w: cw, h });
      }
    }
  }

  function shrinkLavaPitHeights(stages) {
    if (!stages) return;
    const minH = 16;
    for (const s of stages) {
      const lava = s.lava;
      if (!lava || !lava.length) continue;
      for (const L of lava) {
        const dh = Math.min(LAVA_SHRINK, Math.max(0, L.h - minH));
        L.y += dh;
        L.h -= dh;
      }
    }
  }

  const prepared = new WeakSet();
  function prepStageList(stages) {
    if (!stages || !stages.length) return;
    if (prepared.has(stages)) return;
    shrinkLavaPitHeights(stages);
    for (const s of stages) appendStaticUnderhangSupports(s);
    prepared.add(stages);
  }

  window.SKYHOP_PREP_STAGE_LIST = prepStageList;

  window.SKYHOP_PREP_STAGES = function () {
    const STAGES = window.SKYHOP_STAGES;
    if (!STAGES || !STAGES.length) return;
    prepStageList(STAGES);
  };
})();
