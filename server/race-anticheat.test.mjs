import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateProgress } from './race-anticheat.js';

const room = { startAt: 1000, maxStage0: 49 };

test('legit next-stage spawn is not a teleport or skip', () => {
  const prev = {
    stage: 0,
    stageAt: 1000,
    lastAt: 10900,
    x: 1280,
    y: 280,
    deaths: 1,
    suspicion: 0,
    progressHits: 80,
  };
  const ev = evaluateProgress(
    room,
    prev,
    { stage0: 1, timeMs: 9900, x: 80, y: 520, deaths: 1 },
    11000
  );
  assert.equal(ev.ok, true);
  assert.equal(ev.kick, null);
  assert.equal(ev.stage, 1);
  assert.ok(!ev.flags.includes('teleport'));
  assert.ok(!ev.flags.includes('stage_skip'));
});

test('death respawn on the same stage is not a teleport', () => {
  const prev = {
    stage: 0,
    stageAt: 1000,
    lastAt: 5000,
    x: 1400,
    y: 760,
    deaths: 0,
    suspicion: 0,
    progressHits: 20,
  };
  const ev = evaluateProgress(
    room,
    prev,
    { stage0: 0, timeMs: 4100, x: 80, y: 520, deaths: 1 },
    5100
  );
  assert.equal(ev.ok, true);
  assert.ok(!ev.flags.includes('teleport'));
});

test('same-stage teleport still kicks', () => {
  const prev = {
    stage: 0,
    stageAt: 1000,
    lastAt: 1100,
    x: 80,
    y: 520,
    deaths: 0,
    suspicion: 0,
    progressHits: 5,
  };
  const ev = evaluateProgress(
    room,
    prev,
    { stage0: 0, timeMs: 200, x: 4200, y: 520, deaths: 0 },
    1200
  );
  assert.equal(ev.ok, false);
  assert.ok(ev.flags.includes('teleport'));
});

test('skipping many stages in one packet still kicks', () => {
  const prev = {
    stage: 0,
    stageAt: 1000,
    lastAt: 1100,
    x: 80,
    y: 520,
    deaths: 0,
    suspicion: 0,
    progressHits: 2,
  };
  const ev = evaluateProgress(
    room,
    prev,
    { stage0: 49, timeMs: 200, x: 80, y: 520, deaths: 0 },
    1200
  );
  assert.equal(ev.ok, false);
  assert.ok(ev.flags.includes('stage_skip'));
});
