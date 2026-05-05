/** Shared tuning; movement scaled by `SKYHOP_SENSITIVITY` from localStorage in game. */
(function () {
  window.SKYHOP_C = {
    GRAVITY: 2400,
    MOVE_ACCEL: 5200,
    MAX_RUN: 320,
    AIR_CONTROL: 0.45,
    JUMP_V: -720,
    SPRING_VY: -1080,
    GROUND_DECEL: 5200,
    GROUND_V_STOP: 8,
    COYOTE_MS: 100,
    JUMP_BUFFER_MS: 120,
    SPIKE_HIT_INSET_X: 5,
    SPIKE_HIT_INSET_TOP: 8,
    SPIKE_HIT_INSET_BOTTOM: 2,
    SPIKE_HIT_MIN_W: 4,
    SPIKE_HIT_MIN_H: 4,
    FIREBALL_RADIUS: 10,
    WALL_KICK: 300,
    WALL_JUMP_VY_MULT: 0.88,
    LAVA_VISUAL_BLOCK_PX: 24,
    STATIC_UNDERHANG_MAX_PLATFORM_H: 32,
    STATIC_UNDERHANG_W: 32,
    GRAPPLE_RANGE: 420,
    /** Release Shift after aim: one-shot speed toward the hook, scaled by distance. */
    GRAPPLE_ZIP_BASE: 400,
    GRAPPLE_ZIP_PER_DIST: 1.15,
    GRAPPLE_ZIP_MAX: 1680,
    /** After release, horizontal speed cap is raised this long so the zip isn’t instantly clamped. */
    GRAPPLE_ZIP_MOMENTUM_MS: 300,
    GRAPPLE_ZIP_VY_MULT: 0.42,
    GRAPPLE_RELEASE_KEY: 'Shift',
    SPRING_SPIKE_IFRAME_MS: 220,
    BOSS_STOMP_IFRAME_MS: 350,
    BOSS_PLAYER_HP: 2,
    BOSS_PLAYER_HIT_IFRAME_MS: 1200,
    /** Fall / launch off the world vertically → respawn (no vertical clamp; horizontal still clamped). */
    VOID_KILL_Y_TOP: 100,
    VOID_KILL_Y_BOTTOM: 72,
  };
})();
