/**
 * World 2 — harder campaign (moving platforms theme). Loaded after stage prep.
 */
(function () {
  const LZ = window.SKYHOP_LZ || { y: 765, h: 135 };
  const raw = [
    {
      worldW: 2200,
      worldH: 820,
      spawn: { x: 60, y: 520 },
      goal: { x: 1980, y: 280, w: 72, h: 96 },
      theme: 'world2',
      platforms: [
        { x: 0, y: 680, w: 260, h: 200 },
        { x: 380, y: 680, w: 180, h: 200 },
      ],
      movingPlatforms: [
        { x: 620, y: 560, w: 140, h: 22, move: { axis: 'x', amp: 220, omega: 1.35, phase: 0 } },
        { x: 980, y: 480, w: 120, h: 20, move: { axis: 'y', amp: 160, omega: 1.55, phase: 0.4 } },
        { x: 1280, y: 400, w: 130, h: 22, move: { axis: 'x', amp: 280, omega: 1.2, phase: 1.1 } },
        { x: 1620, y: 520, w: 110, h: 20, move: { axis: 'y', amp: 140, omega: 1.7, phase: 0.2 } },
        { x: 1780, y: 360, w: 160, h: 24, move: { axis: 'x', amp: 120, omega: 2.1, phase: 0.8 } },
      ],
      spikes: [
        { x: 300, y: 660, w: 80, h: 20 },
        { x: 850, y: 660, w: 120, h: 20 },
        { x: 1500, y: 660, w: 100, h: 20 },
      ],
      fireballEmitters: [
        { from: 'left', pos: 420, speed: 320, jitter: 0.35 },
        { from: 'right', pos: 520, speed: 300, jitter: 0.4 },
      ],
      lava: [{ x: 0, y: LZ.y, w: 2200, h: LZ.h }],
      doubleJump: true,
    },
  ];
  if (typeof window.SKYHOP_PREP_STAGE_LIST === 'function') {
    window.SKYHOP_PREP_STAGE_LIST(raw);
  }
  window.SKYHOP_WORLD2_STAGES = raw;
})();
