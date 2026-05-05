/**
 * Level data for Sky Hop (loaded before main game script).
 *
 * DEBUG: To play only stages 6–15 (skip 1–5), set this BEFORE loading stages.js, e.g. in index.html:
 *   <script>window.SKYHOP_ONLY_EXT = true;</script>
 * DEBUG: To start at a given stage when clicking Play (1-based, matches HUD), BEFORE game.js:
 *   <script>window.SKYHOP_DEBUG_START_STAGE = 8;</script>
 * Static thin platforms get support columns automatically in game.js (moving platforms are skipped).
 * Optional underhang Y/X min/max limit which ledges get beams; underhangDisabled skips all beams for a stage.
 *
 * @type {Array<{
 *   worldW: number,
 *   worldH: number,
 *   spawn: { x: number, y: number },
 *   goal: { x: number, y: number, w: number, h: number },
 *   platforms: Array<{ x: number, y: number, w: number, h: number, move?: { axis: 'x'|'y', amp: number, omega: number, phase?: number } }>,
 *   movingPlatforms?: Array<{ x: number, y: number, w: number, h: number, move: { axis: 'x'|'y', amp: number, omega: number, phase?: number } }>,
 *   spikes: Array<{ x: number, y: number, w: number, h: number }>,
 *   springs?: Array<{ x: number, y: number, w: number, h: number, vy?: number, gravityScale?: number }>,
 *   fireballEmitters?: Array<{ from: 'left'|'right'|'top'|'bottom', pos: number, speed: number, jitter?: number }>,
 *   lasers?: Array<{ x: number, y: number, w: number, h: number }>,
 *   lava?: Array<{ x: number, y: number, w: number, h: number }>, // height shortened at runtime in game.js
 *   laserDecor?: Array<{ y: number, h: number }>,
 *   doubleJump?: boolean,
 *   underhangPlatformYMin?: number,
 *   underhangPlatformYMax?: number,
 *   underhangPlatformXMin?: number,
 *   underhangPlatformXMax?: number,
 *   underhangDisabled?: boolean,
 * }>}
 */

/** Lava pit vertical band — kept low so jump arcs clear (tweak y/h together; y+h ≈ worldH). */
const LZ = { y: 765, h: 135 };
window.SKYHOP_LZ = LZ;

const SKYHOP_STAGES_FIRST_FIVE = [
  // 1 — tutorial: generous floors, no spikes
  {
    worldW: 1400,
    worldH: 720,
    spawn: { x: 80, y: 520 },
    goal: { x: 1220, y: 480, w: 72, h: 96 },
    platforms: [
      { x: 0, y: 640, w: 1400, h: 200 },
      { x: 320, y: 520, w: 220, h: 24 },
      { x: 620, y: 440, w: 200, h: 24 },
      { x: 900, y: 520, w: 260, h: 24 },
    ],
    spikes: [],
  },
  // 2 — wider gaps, still forgiving
  {
    worldW: 1600,
    worldH: 760,
    spawn: { x: 60, y: 520 },
    goal: { x: 1480, y: 380, w: 64, h: 88 },
    platforms: [
      { x: 0, y: 660, w: 320, h: 200 },
      { x: 420, y: 660, w: 200, h: 200 },
      { x: 720, y: 560, w: 140, h: 24 },
      { x: 960, y: 480, w: 120, h: 24 },
      { x: 1180, y: 580, w: 160, h: 24 },
      { x: 1380, y: 660, w: 220, h: 200 },
    ],
    spikes: [],
  },
  // 3 — spikes; springs
  {
    worldW: 1820,
    worldH: 800,
    spawn: { x: 50, y: 680 },
    goal: { x: 1620, y: 228, w: 64, h: 88 },
    platforms: [
      { x: 0, y: 680, w: 280, h: 200 },
      { x: 380, y: 680, w: 160, h: 200 },
      { x: 598, y: 598, w: 115, h: 22 },
      { x: 758, y: 520, w: 105, h: 20 },
      { x: 915, y: 448, w: 100, h: 20 },
      { x: 1068, y: 382, w: 100, h: 20 },
      { x: 1218, y: 322, w: 110, h: 20 },
      { x: 1368, y: 272, w: 130, h: 20 },
    ],
    spikes: [
      { x: 380, y: 648, w: 72, h: 32 },
      { x: 805, y: 488, w: 48, h: 32 },
      { x: 1068, y: 350, w: 38, h: 32 },
    ],
    springs: [
      { x: 762, y: 496, w: 44, h: 24 },
      { x: 942, y: 424, w: 56, h: 24, vy: -1320, gravityScale: 1.05 },
    ],
  },
  // 4 — climb + fireballs + lethal lasers
  {
    worldW: 2000,
    worldH: 880,
    spawn: { x: 50, y: 780 },
    goal: { x: 1860, y: 248, w: 56, h: 72 },
    platforms: [
      { x: 0, y: 780, w: 280, h: 200 },
      { x: 310, y: 706, w: 74, h: 18 },
      { x: 425, y: 640, w: 70, h: 18 },
      { x: 535, y: 580, w: 68, h: 18 },
      { x: 645, y: 528, w: 64, h: 18 },
      { x: 750, y: 482, w: 62, h: 18 },
      { x: 860, y: 442, w: 58, h: 18 },
      { x: 965, y: 408, w: 56, h: 18 },
      { x: 1070, y: 378, w: 54, h: 18 },
      { x: 1175, y: 352, w: 54, h: 18 },
      { x: 1280, y: 330, w: 56, h: 18 },
      { x: 1388, y: 312, w: 58, h: 18 },
      { x: 1485, y: 304, w: 58, h: 18 },
      { x: 1575, y: 296, w: 62, h: 18 },
      { x: 1668, y: 288, w: 300, h: 18 },
      { x: 1780, y: 780, w: 220, h: 200 },
    ],
    spikes: [
      { x: 288, y: 748, w: 36, h: 32 },
      { x: 900, y: 410, w: 32, h: 32 },
    ],
    fireballEmitters: [
      { from: 'left', pos: 520, speed: 220 },
      { from: 'right', pos: 400, speed: 250 },
      { from: 'top', pos: 720, speed: 190 },
      { from: 'bottom', pos: 1100, speed: 210 },
    ],
  },
  // 5 — lava + decor lasers
  {
    worldW: 2220,
    worldH: 900,
    spawn: { x: 55, y: 800 },
    goal: { x: 2020, y: 345, w: 58, h: 72 },
    platforms: [
      { x: 0, y: 800, w: 310, h: 200 },
      { x: 410, y: 732, w: 125, h: 22 },
      { x: 565, y: 665, w: 115, h: 22 },
      { x: 718, y: 605, w: 108, h: 22 },
      { x: 868, y: 552, w: 102, h: 22 },
      { x: 1010, y: 505, w: 98, h: 22 },
      { x: 1145, y: 465, w: 95, h: 22 },
      { x: 1275, y: 432, w: 92, h: 22 },
      { x: 1395, y: 405, w: 825, h: 22 },
    ],
    spikes: [],
    lava: [
      { x: 312, y: LZ.y, w: 96, h: LZ.h },
      { x: 532, y: LZ.y, w: 36, h: LZ.h },
      { x: 678, y: LZ.y, w: 44, h: LZ.h },
      { x: 824, y: LZ.y, w: 48, h: LZ.h },
      { x: 968, y: LZ.y, w: 46, h: LZ.h },
      { x: 1106, y: LZ.y, w: 43, h: LZ.h },
      { x: 1238, y: LZ.y, w: 41, h: LZ.h },
      { x: 1369, y: LZ.y, w: 30, h: LZ.h },
    ],
    laserDecor: [
      { y: 2, h: 14 },
      { y: 20, h: 8 },
      { y: 32, h: 12 },
      { y: 48, h: 6 },
    ],
  },
];

/*
 * --- Backup: original stages 1–5 are in SKYHOP_STAGES_FIRST_FIVE above (same data). ---
 * If you break the extended block, restore with:
 *   window.SKYHOP_STAGES = SKYHOP_STAGES_FIRST_FIVE.concat(SKYHOP_STAGES_EXT);
 */

const SKYHOP_STAGES_EXT = [
  // 6 — climb + tall wall finale (wall-jump up to goal ledge); no mover / no spikes on route
  {
    worldW: 2100,
    worldH: 900,
    spawn: { x: 45, y: 800 },
    goal: { x: 1880, y: 248, w: 58, h: 72 },
    platforms: [
      { x: 0, y: 800, w: 300, h: 200 },
      { x: 400, y: 728, w: 120, h: 22 },
      { x: 558, y: 660, w: 110, h: 22 },
      { x: 708, y: 598, w: 105, h: 22 },
      { x: 858, y: 542, w: 100, h: 22 },
      { x: 1005, y: 492, w: 96, h: 22 },
      { x: 1120, y: 450, w: 108, h: 22 },
      { x: 1275, y: 472, w: 100, h: 22 },
      { x: 1395, y: 240, w: 52, h: 560 },
      { x: 1485, y: 288, w: 580, h: 22 },
    ],
    spikes: [],
    lava: [
      { x: 302, y: LZ.y, w: 94, h: LZ.h },
      { x: 518, y: LZ.y, w: 42, h: LZ.h },
      { x: 668, y: LZ.y, w: 44, h: LZ.h },
      { x: 813, y: LZ.y, w: 49, h: LZ.h },
      { x: 958, y: LZ.y, w: 51, h: LZ.h },
      { x: 1101, y: LZ.y, w: 21, h: LZ.h },
      { x: 1228, y: LZ.y, w: 49, h: LZ.h },
      { x: 1375, y: LZ.y, w: 22, h: LZ.h },
    ],
    laserDecor: [{ y: 4, h: 12 }, { y: 22, h: 8 }],
    fireballEmitters: [
      { from: 'left', pos: 540, speed: 210 },
      { from: 'right', pos: 380, speed: 235 },
      { from: 'top', pos: 900, speed: 175 },
    ],
  },
  // 7 — vertical wall jumps + lava (tight gaps for wall-kick range)
  {
    worldW: 1600,
    worldH: 900,
    spawn: { x: 60, y: 800 },
    goal: { x: 1380, y: 268, w: 56, h: 70 },
    platforms: [
      { x: 0, y: 800, w: 220, h: 200 },
      { x: 320, y: 800, w: 36, h: 320 },
      { x: 358, y: 800, w: 86, h: 200 },
      { x: 448, y: 632, w: 110, h: 22 },
      { x: 628, y: 800, w: 36, h: 280 },
      { x: 798, y: 548, w: 100, h: 22 },
      { x: 968, y: 800, w: 36, h: 240 },
      { x: 1140, y: 480, w: 440, h: 22 },
    ],
    spikes: [],
    lava: [
      { x: 222, y: 789, w: 94, h: 111 },
      { x: 560, y: 789, w: 64, h: 111 },
      { x: 666, y: 789, w: 128, h: 111 },
      { x: 1006, y: 789, w: 130, h: 111 },
    ],
    laserDecor: [{ y: 2, h: 14 }, { y: 26, h: 6 }],
    fireballEmitters: [
      { from: 'bottom', pos: 400, speed: 165 },
      { from: 'left', pos: 300, speed: 200 },
    ],
  },
  // 8 — two movers + partial spikes (double jump on this stage)
  {
    worldW: 2280,
    worldH: 900,
    doubleJump: true,
    spawn: { x: 40, y: 800 },
    goal: { x: 2080, y: 338, w: 58, h: 72 },
    platforms: [
      { x: 0, y: 800, w: 290, h: 200 },
      { x: 388, y: 722, w: 118, h: 22 },
      { x: 538, y: 652, w: 112, h: 22 },
      { x: 688, y: 588, w: 108, h: 22 },
      { x: 838, y: 530, w: 104, h: 22 },
      { x: 985, y: 478, w: 100, h: 22 },
      { x: 1128, y: 432, w: 96, h: 22 },
      { x: 1268, y: 392, w: 94, h: 22 },
      { x: 1405, y: 358, w: 820, h: 22 },
    ],
    movingPlatforms: [
      { x: 700, y: 500, w: 82, h: 18, move: { axis: 'x', amp: 65, omega: 1.15, phase: 1 } },
      { x: 1150, y: 360, w: 78, h: 18, move: { axis: 'y', amp: 40, omega: 0.85, phase: 2 } },
    ],
    spikes: [
      { x: 538, y: 620, w: 40, h: 32 },
      { x: 985, y: 446, w: 36, h: 32 },
    ],
    lava: [
      { x: 292, y: LZ.y, w: 92, h: LZ.h },
      { x: 504, y: LZ.y, w: 38, h: LZ.h },
      { x: 648, y: LZ.y, w: 44, h: LZ.h },
      { x: 794, y: LZ.y, w: 48, h: LZ.h },
      { x: 938, y: LZ.y, w: 51, h: LZ.h },
      { x: 1080, y: LZ.y, w: 52, h: LZ.h },
      { x: 1220, y: LZ.y, w: 52, h: LZ.h },
      { x: 1360, y: LZ.y, w: 49, h: LZ.h },
    ],
    fireballEmitters: [
      { from: 'right', pos: 520, speed: 245 },
      { from: 'top', pos: 600, speed: 185 },
      { from: 'left', pos: 650, speed: 220 },
    ],
    laserDecor: [{ y: 6, h: 10 }, { y: 36, h: 8 }],
  },
  // 9 — gentle climb + 1 vertical mover
  {
    worldW: 2100,
    worldH: 880,
    spawn: { x: 50, y: 778 },
    goal: { x: 1920, y: 312, w: 56, h: 72 },
    platforms: [
      { x: 0, y: 780, w: 270, h: 200 },
      { x: 318, y: 708, w: 72, h: 20 },
      { x: 438, y: 642, w: 70, h: 20 },
      { x: 548, y: 582, w: 68, h: 20 },
      { x: 652, y: 528, w: 66, h: 20 },
      { x: 752, y: 480, w: 64, h: 20 },
      { x: 848, y: 438, w: 62, h: 20 },
      { x: 940, y: 402, w: 60, h: 20 },
      { x: 1028, y: 372, w: 58, h: 20 },
      { x: 1112, y: 348, w: 56, h: 20 },
      { x: 1192, y: 328, w: 850, h: 20 },
    ],
    movingPlatforms: [
      { x: 900, y: 520, w: 80, h: 18, move: { axis: 'y', amp: 55, omega: 0.95, phase: 0.5 } },
    ],
    spikes: [{ x: 548, y: 550, w: 34, h: 32 }],
    lava: [
      { x: 272, y: 748, w: 44, h: 132 },
      { x: 408, y: 748, w: 32, h: 132 },
      { x: 518, y: 748, w: 32, h: 132 },
      { x: 620, y: 748, w: 34, h: 132 },
      { x: 718, y: 748, w: 36, h: 132 },
      { x: 812, y: 748, w: 38, h: 132 },
      { x: 902, y: 748, w: 40, h: 132 },
      { x: 988, y: 748, w: 42, h: 132 },
      { x: 1070, y: 748, w: 44, h: 132 },
    ],
    fireballEmitters: [
      { from: 'left', pos: 480, speed: 215 },
      { from: 'bottom', pos: 800, speed: 195 },
    ],
    laserDecor: [{ y: 3, h: 12 }],
  },
  // 10 — wide mover + spring
  {
    worldW: 2200,
    worldH: 900,
    spawn: { x: 50, y: 800 },
    goal: { x: 1980, y: 328, w: 58, h: 72 },
    platforms: [
      { x: 0, y: 800, w: 300, h: 200 },
      { x: 408, y: 728, w: 122, h: 22 },
      { x: 568, y: 658, w: 115, h: 22 },
      { x: 723, y: 595, w: 110, h: 22 },
      { x: 873, y: 538, w: 106, h: 22 },
      { x: 1018, y: 488, w: 102, h: 22 },
      { x: 1158, y: 444, w: 98, h: 22 },
      { x: 1293, y: 406, w: 96, h: 22 },
      { x: 1423, y: 374, w: 720, h: 22 },
    ],
    movingPlatforms: [
      { x: 600, y: 560, w: 100, h: 20, move: { axis: 'x', amp: 95, omega: 0.75, phase: 0 } },
    ],
    springs: [{ x: 1018, y: 464, w: 44, h: 24 }],
    spikes: [{ x: 723, y: 563, w: 42, h: 32 }],
    lava: [
      { x: 302, y: LZ.y, w: 102, h: LZ.h },
      { x: 528, y: LZ.y, w: 42, h: LZ.h },
      { x: 683, y: LZ.y, w: 44, h: LZ.h },
      { x: 833, y: LZ.y, w: 44, h: LZ.h },
      { x: 978, y: LZ.y, w: 44, h: LZ.h },
      { x: 1118, y: LZ.y, w: 44, h: LZ.h },
      { x: 1253, y: LZ.y, w: 44, h: LZ.h },
      { x: 1388, y: LZ.y, w: 39, h: LZ.h },
    ],
    fireballEmitters: [
      { from: 'right', pos: 450, speed: 230 },
      { from: 'top', pos: 1100, speed: 190 },
      { from: 'left', pos: 580, speed: 205 },
    ],
    laserDecor: [{ y: 2, h: 11 }, { y: 40, h: 7 }],
  },
  // 11 — shaft walls + lava
  {
    worldW: 1700,
    worldH: 920,
    spawn: { x: 70, y: 820 },
    goal: { x: 1480, y: 460, w: 56, h: 70 },
    platforms: [
      { x: 0, y: 820, w: 200, h: 200 },
      { x: 280, y: 820, w: 40, h: 300 },
      { x: 480, y: 680, w: 110, h: 22 },
      { x: 640, y: 820, w: 40, h: 260 },
      { x: 820, y: 600, w: 105, h: 22 },
      { x: 980, y: 820, w: 40, h: 220 },
      { x: 1140, y: 530, w: 520, h: 22 },
    ],
    spikes: [],
    lava: [
      { x: 200, y: 780, w: 78, h: 140 },
      { x: 400, y: 780, w: 78, h: 140 },
      { x: 600, y: 780, w: 42, h: 140 },
      { x: 780, y: 780, w: 42, h: 140 },
      { x: 940, y: 780, w: 42, h: 140 },
    ],
    fireballEmitters: [
      { from: 'bottom', pos: 500, speed: 175 },
      { from: 'right', pos: 350, speed: 210 },
    ],
    laserDecor: [{ y: 4, h: 13 }],
  },
  // 12 — climb east, then upper route back west; goal on the left
  {
    worldW: 2260,
    worldH: 900,
    underhangPlatformYMin: 332,
    underhangPlatformYMax: 740,
    underhangPlatformXMin: 40,
    underhangPlatformXMax: 1580,
    spawn: { x: 72, y: 800 },
    goal: { x: 118, y: 308, w: 58, h: 72 },
    platforms: [
      { x: 0, y: 800, w: 300, h: 200 },
      { x: 358, y: 728, w: 118, h: 22 },
      { x: 508, y: 658, w: 112, h: 22 },
      { x: 658, y: 588, w: 108, h: 22 },
      { x: 808, y: 530, w: 104, h: 22 },
      { x: 952, y: 478, w: 100, h: 22 },
      { x: 1095, y: 432, w: 96, h: 22 },
      { x: 1232, y: 392, w: 94, h: 22 },
      { x: 1362, y: 358, w: 92, h: 22 },
      { x: 1485, y: 330, w: 90, h: 22 },
      { x: 1625, y: 308, w: 88, h: 22 },
      { x: 1760, y: 292, w: 210, h: 22 },
      { x: 1545, y: 278, w: 105, h: 22 },
      { x: 1320, y: 268, w: 110, h: 22 },
      { x: 1095, y: 262, w: 110, h: 22 },
      { x: 870, y: 268, w: 110, h: 22 },
      { x: 645, y: 282, w: 115, h: 22 },
      { x: 415, y: 300, w: 120, h: 22 },
      { x: 28, y: 362, w: 290, h: 22 },
    ],
    movingPlatforms: [
      { x: 950, y: 275, w: 72, h: 18, move: { axis: 'x', amp: 60, omega: 1.35, phase: 0.5 } },
    ],
    spikes: [
      { x: 808, y: 498, w: 38, h: 32 },
      { x: 1362, y: 326, w: 36, h: 32 },
    ],
    lava: [
      { x: 302, y: LZ.y, w: 52, h: LZ.h },
      { x: 490, y: LZ.y, w: 42, h: LZ.h },
      { x: 638, y: LZ.y, w: 42, h: LZ.h },
      { x: 788, y: LZ.y, w: 42, h: LZ.h },
      { x: 932, y: LZ.y, w: 44, h: LZ.h },
      { x: 1075, y: LZ.y, w: 42, h: LZ.h },
      { x: 1210, y: LZ.y, w: 40, h: LZ.h },
      { x: 1342, y: LZ.y, w: 40, h: LZ.h },
      { x: 1470, y: LZ.y, w: 40, h: LZ.h },
      { x: 1595, y: LZ.y, w: 38, h: LZ.h },
      { x: 1720, y: LZ.y, w: 45, h: LZ.h },
    ],
    fireballEmitters: [
      { from: 'left', pos: 500, speed: 240 },
      { from: 'top', pos: 800, speed: 200 },
      { from: 'right', pos: 620, speed: 225 },
    ],
    laserDecor: [{ y: 8, h: 10 }, { y: 44, h: 6 }],
  },
  // 13 — start on the right; ledges lead west to a left-side goal
  {
    worldW: 2240,
    worldH: 900,
    spawn: { x: 2090, y: 800 },
    goal: { x: 88, y: 236, w: 58, h: 72 },
    platforms: [
      { x: 1855, y: 800, w: 385, h: 200 },
      { x: 1668, y: 726, w: 120, h: 22 },
      { x: 1478, y: 654, w: 116, h: 22 },
      { x: 1290, y: 590, w: 112, h: 22 },
      { x: 1105, y: 532, w: 108, h: 22 },
      { x: 922, y: 478, w: 104, h: 22 },
      { x: 742, y: 428, w: 100, h: 22 },
      { x: 562, y: 382, w: 96, h: 22 },
      { x: 385, y: 342, w: 94, h: 22 },
      { x: 20, y: 308, w: 330, h: 22 },
    ],
    movingPlatforms: [
      { x: 1180, y: 420, w: 86, h: 20, move: { axis: 'y', amp: 48, omega: 1.05, phase: 1.2 } },
      { x: 1520, y: 590, w: 84, h: 20, move: { axis: 'x', amp: 65, omega: 0.88, phase: 0.2 } },
    ],
    spikes: [{ x: 1478, y: 622, w: 40, h: 32 }],
    lava: [
      { x: 1795, y: LZ.y, w: 55, h: LZ.h },
      { x: 1602, y: LZ.y, w: 62, h: LZ.h },
      { x: 1412, y: LZ.y, w: 60, h: LZ.h },
      { x: 1225, y: LZ.y, w: 58, h: LZ.h },
      { x: 1042, y: LZ.y, w: 56, h: LZ.h },
      { x: 862, y: LZ.y, w: 54, h: LZ.h },
      { x: 682, y: LZ.y, w: 52, h: LZ.h },
      { x: 505, y: LZ.y, w: 50, h: LZ.h },
    ],
    fireballEmitters: [
      { from: 'bottom', pos: 900, speed: 188 },
      { from: 'right', pos: 420, speed: 218 },
    ],
    laserDecor: [{ y: 2, h: 12 }, { y: 30, h: 8 }],
  },
  // 14 — long climb east, then westbound skyway; goal left of map center
  {
    worldW: 2360,
    worldH: 900,
    underhangDisabled: true,
    spawn: { x: 58, y: 800 },
    goal: { x: 388, y: 278, w: 58, h: 72 },
    platforms: [
      { x: 0, y: 800, w: 320, h: 200 },
      { x: 398, y: 726, w: 122, h: 22 },
      { x: 558, y: 654, w: 118, h: 22 },
      { x: 712, y: 590, w: 114, h: 22 },
      { x: 862, y: 532, w: 110, h: 22 },
      { x: 1008, y: 480, w: 106, h: 22 },
      { x: 1150, y: 434, w: 102, h: 22 },
      { x: 1288, y: 394, w: 100, h: 22 },
      { x: 1420, y: 360, w: 98, h: 22 },
      { x: 1548, y: 332, w: 96, h: 22 },
      { x: 1672, y: 310, w: 94, h: 22 },
      { x: 1792, y: 292, w: 92, h: 22 },
      { x: 1920, y: 280, w: 200, h: 22 },
      { x: 1705, y: 268, w: 108, h: 22 },
      { x: 1485, y: 258, w: 112, h: 22 },
      { x: 1260, y: 252, w: 112, h: 22 },
      { x: 1035, y: 258, w: 112, h: 22 },
      { x: 810, y: 268, w: 118, h: 22 },
      { x: 575, y: 282, w: 125, h: 22 },
      { x: 318, y: 332, w: 220, h: 22 },
    ],
    movingPlatforms: [
      { x: 1080, y: 245, w: 90, h: 20, move: { axis: 'x', amp: 85, omega: 0.82, phase: 0.6 } },
    ],
    spikes: [{ x: 1008, y: 448, w: 40, h: 32 }],
    lava: [
      { x: 322, y: LZ.y, w: 72, h: LZ.h },
      { x: 514, y: LZ.y, w: 40, h: LZ.h },
      { x: 666, y: LZ.y, w: 42, h: LZ.h },
      { x: 816, y: LZ.y, w: 42, h: LZ.h },
      { x: 964, y: LZ.y, w: 40, h: LZ.h },
      { x: 1110, y: LZ.y, w: 38, h: LZ.h },
      { x: 1252, y: LZ.y, w: 38, h: LZ.h },
      { x: 1390, y: LZ.y, w: 36, h: LZ.h },
      { x: 1524, y: LZ.y, w: 36, h: LZ.h },
      { x: 1654, y: LZ.y, w: 34, h: LZ.h },
      { x: 1780, y: LZ.y, w: 34, h: LZ.h },
    ],
    laserDecor: [
      { y: 2, h: 10 },
      { y: 18, h: 8 },
      { y: 34, h: 10 },
      { y: 50, h: 6 },
    ],
    fireballEmitters: [
      { from: 'right', pos: 480, speed: 235 },
      { from: 'top', pos: 700, speed: 195 },
      { from: 'left', pos: 1200, speed: 225 },
    ],
  },
  // 15 — finale: reach the east tower, then return west to the goal balcony
  {
    worldW: 2380,
    worldH: 920,
    underhangDisabled: true,
    spawn: { x: 62, y: 818 },
    goal: { x: 168, y: 268, w: 60, h: 74 },
    platforms: [
      { x: 0, y: 820, w: 300, h: 200 },
      { x: 388, y: 748, w: 118, h: 22 },
      { x: 536, y: 678, w: 114, h: 22 },
      { x: 676, y: 614, w: 110, h: 22 },
      { x: 816, y: 556, w: 106, h: 22 },
      { x: 368, y: 520, w: 32, h: 260 },
      { x: 956, y: 504, w: 102, h: 22 },
      { x: 1091, y: 458, w: 98, h: 22 },
      { x: 1221, y: 418, w: 96, h: 22 },
      { x: 1346, y: 384, w: 94, h: 22 },
      { x: 1468, y: 356, w: 92, h: 22 },
      { x: 1585, y: 332, w: 90, h: 22 },
      { x: 1700, y: 312, w: 88, h: 22 },
      { x: 1820, y: 298, w: 200, h: 22 },
      { x: 1605, y: 286, w: 105, h: 22 },
      { x: 1385, y: 276, w: 110, h: 22 },
      { x: 1160, y: 270, w: 110, h: 22 },
      { x: 935, y: 276, w: 110, h: 22 },
      { x: 710, y: 288, w: 115, h: 22 },
      { x: 475, y: 298, w: 120, h: 22 },
      { x: 95, y: 328, w: 280, h: 22 },
    ],
    movingPlatforms: [
      { x: 740, y: 410, w: 92, h: 20, move: { axis: 'x', amp: 80, omega: 1.0, phase: 0.3 } },
      { x: 1520, y: 265, w: 80, h: 18, move: { axis: 'y', amp: 35, omega: 1.1, phase: 2 } },
    ],
    spikes: [{ x: 956, y: 472, w: 38, h: 32 }],
    lava: [
      { x: 302, y: 778, w: 80, h: 142 },
      { x: 506, y: 778, w: 34, h: 142 },
      { x: 650, y: 778, w: 30, h: 142 },
      { x: 788, y: 778, w: 32, h: 142 },
      { x: 924, y: 778, w: 36, h: 142 },
      { x: 1058, y: 778, w: 37, h: 142 },
      { x: 1188, y: 778, w: 37, h: 142 },
      { x: 1315, y: 778, w: 35, h: 142 },
      { x: 1440, y: 778, w: 35, h: 142 },
      { x: 1562, y: 778, w: 33, h: 142 },
      { x: 1682, y: 778, w: 33, h: 142 },
    ],
    laserDecor: [{ y: 3, h: 14 }, { y: 24, h: 8 }, { y: 42, h: 10 }],
    fireballEmitters: [
      { from: 'left', pos: 550, speed: 228 },
      { from: 'right', pos: 400, speed: 242 },
      { from: 'bottom', pos: 1000, speed: 198 },
      { from: 'top', pos: 800, speed: 188 },
    ],
  },
];

if (typeof window.SKYHOP_ONLY_EXT === 'undefined') {
  window.SKYHOP_ONLY_EXT = false;
}

/** Call again after `SKYHOP_STAGES_EXT2` is set (see stages-extra.js). */
function rebuildSkyhopStages() {
  const ext2 = window.SKYHOP_STAGES_EXT2 || [];
  const ext3 = window.SKYHOP_STAGES_EXT3 || [];
  window.SKYHOP_STAGES = window.SKYHOP_ONLY_EXT
    ? SKYHOP_STAGES_EXT.concat(ext2, ext3)
    : SKYHOP_STAGES_FIRST_FIVE.concat(SKYHOP_STAGES_EXT, ext2, ext3);
}
window.SKYHOP_REBUILD_STAGES = rebuildSkyhopStages;
rebuildSkyhopStages();
