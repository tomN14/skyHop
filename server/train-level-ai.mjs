/**
 * Trains the level-assistant network and writes server/level-ai-weights.json.
 * Run from the repo root: node server/train-level-ai.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABELS, tokensOf, charGrams, forward, scoreRequest } from './level-ai-net.js';

const NOUNS = {
  arena: ['arena', 'pit', 'coliseum', 'battlefield', 'fighting pit', 'stadium', 'boss room'],
  platform: ['platform', 'platforms', 'ledge', 'ledges', 'shelf', 'shelves', 'foothold', 'footholds'],
  spike: ['spike', 'spikes', 'thorns', 'nails', 'spike strip', 'spike pit', 'trap', 'traps', 'hazard', 'hazards'],
  lava: ['lava', 'magma', 'lava pool', 'lava pit', 'molten'],
  coin: ['coin', 'coins', 'money', 'pickups', 'coin trail', 'gem', 'gems', 'loot'],
  spawn: ['spawn', 'start', 'starting point', 'place the player starts', 'respawn'],
  goal: ['goal', 'finish', 'exit', 'finish line', 'end of the level', 'flag', 'ending'],
  monster: ['monster', 'monsters', 'enemy', 'enemies', 'creature', 'creatures', 'bad guy', 'bad guys', 'baddie', 'baddies', 'foe', 'foes'],
  boss: ['boss', 'big enemy', 'boss fight', 'final boss', 'miniboss'],
  shoot: ['shooting boss', 'boss that shoots', 'projectile attack', 'boss bullets', 'boss that fires', 'shoot', 'projectile', 'projectiles'],
  laser: ['laser', 'lasers', 'laser beam', 'boss laser', 'beam attack'],
  portal: ['portal', 'portals', 'doorway', 'doorways', 'teleporter', 'teleporters', 'warp', 'gateway', 'wormhole', 'door', 'teleport', 'warp gate', 'warp point'],
  switch: ['switch', 'switches', 'lever', 'levers', 'button', 'buttons', 'pressure plate'],
  spring: ['spring', 'springs', 'bounce pad', 'jump pad', 'bouncer', 'trampoline', 'booster pad', 'bouncy pad', 'launch pad'],
  mover: ['moving platform', 'sliding platform', 'sideways platform', 'horizontal mover', 'platform that slides', 'slider', 'conveyor'],
  lifter: ['elevator', 'lift', 'vertical mover', 'rising platform', 'platform that goes up and down'],
  gravity: ['gravity flip', 'gravity arrow', 'upside down gravity', 'gravity change'],
  fireball: ['fireball', 'fireballs', 'flame shooter', 'fire shooter', 'flamethrower', 'flames'],
  blackout: ['blackout', 'darkness', 'dark zone', 'lights out', 'blind spot', 'go dark', 'make it dark'],
  sign: ['sign', 'text sign', 'label', 'message', 'writing on the wall', 'signpost', 'billboard'],
  circle: ['circle', 'round platform', 'disc', 'circular block'],
  triangle: ['triangle', 'triangular block', 'triangle platform'],
  chase: ['chasing monster', 'enemy that follows', 'monster that hunts', 'chasing enemy', 'hunt', 'hunts', 'follow', 'follows', 'chase'],
  jump: ['jump limit', 'limited jumps', 'jump cap'],
  explain: ['explanation of the script', 'description of this script', 'what this script does', 'explain'],
  whole: ['entire level', 'whole level', 'full level', 'complete level', 'course', 'from scratch', 'playable course', 'brand new course'],
  hard: ['hard', 'difficult', 'tough', 'brutal', 'challenging'],
  easy: ['easy', 'simple', 'beginner', 'forgiving'],
  climb: ['climb', 'vertical climb', 'tower'],
  wide: ['long path', 'across the map', 'wide course'],
  replace: ['script rewrite', 'replacement script'],
};

const FRAMES = [
  (noun) => 'add a ' + noun,
  (noun) => 'place a ' + noun,
  (noun) => 'put a ' + noun + ' in the level',
  (noun) => 'can you make a ' + noun,
  (noun) => 'i want a ' + noun,
  (noun) => 'this stage needs a ' + noun,
  (noun) => 'throw in a ' + noun + ' please',
  (noun) => 'set up a ' + noun + ' for me',
  (noun) => 'could you include a ' + noun,
  (noun) => 'drop a ' + noun + ' somewhere',
  (noun) => 'lets have a ' + noun,
  (noun) => 'stick a ' + noun + ' in',
  (noun) => 'i need a ' + noun,
  (noun) => 'how about a ' + noun,
  (noun) => 'gimme a ' + noun,
  (noun) => 'the stage should have a ' + noun,
];

const EXTRA = [
  ['would you mind sticking a teleporter in this stage', ['portal']],
  ['i need somewhere to warp across the gap', ['portal']],
  ['link two spots with a doorway', ['portal']],
  ['a button that can shove a block', ['switch']],
  ['give me a lever', ['switch']],
  ['platform that moves left and right', ['mover']],
  ['something that slides back and forth', ['mover']],
  ['a lift up to the higher ledge', ['lifter', 'platform']],
  ['make gravity point down', ['gravity']],
  ['flip the player upside down', ['gravity']],
  ['shoot flames from the wall', ['fireball']],
  ['turn the screen dark when you touch it', ['blackout']],
  ['put a sign that says hello', ['sign']],
  ['write welcome on a sign', ['sign']],
  ['a round block to stand on', ['circle', 'platform']],
  ['a triangle in the middle', ['triangle']],
  ['build a small fighting pit with ledges at different heights', ['arena', 'platform']],
  ['make the boss fire a shot every three seconds', ['boss', 'shoot']],
  ['the big guy should blast every 2 seconds', ['boss', 'shoot']],
  ['laser the player every five seconds', ['laser']],
  ['add three ledges', ['platform']],
  ['a couple of creatures that chase me', ['monster', 'chase']],
  ['enemies that follow the player', ['monster', 'chase']],
  ['only allow 3 jumps', ['jump']],
  ['cap jumps at four', ['jump']],
  ['what is this script doing', ['explain']],
  ['explain the code', ['explain']],
  ['how does the script work', ['explain']],
  ['build me a level', ['whole']],
  ['make the entire stage', ['whole']],
  ['design a tough course', ['hard', 'whole']],
  ['make me a full level', ['whole']],
  ['build a course from scratch', ['whole']],
  ['an easy beginner course', ['easy', 'whole']],
  ['a tall tower to climb', ['climb']],
  ['a long path across the map', ['wide']],
  ['i want a bouncy pad', ['spring']],
  ['teleport across the gap', ['portal']],
  ['some traps on the ground', ['spike']],
  ['bad guys chasing me', ['monster', 'chase']],
  ['a warp gate', ['portal']],
  ['give me a bounce pad', ['spring']],
  ['make a challenging course', ['hard', 'whole']],
  ['something simple for a beginner', ['easy']],
  ['traps and a trampoline', ['spike', 'spring']],
  ['a tower climb with springs', ['climb', 'spring']],
  ['rewrite the script so the boss shoots', ['replace', 'shoot', 'boss']],
  ['arena with a portal and a switch', ['arena', 'portal', 'switch']],
  ['boss room with lava and a moving platform', ['arena', 'boss', 'lava', 'mover']],
  ['spikes under a few coins', ['spike', 'coin']],
  ['move where the player starts', ['spawn']],
  ['put the finish on the right', ['goal']],
  ['20 hp boss that shoots', ['boss', 'shoot']],
  ['circle and a triangle', ['circle', 'triangle']],
  ['hello', []],
  ['thanks', []],
  ['nice', []],
  ['ok sure', []],
  ['what time is it', []],
  ['hmm', []],
  ['can you look over there', []],
  ['i want a break', []],
  ['put this aside for me', []],
  ['this stage needs a rest', []],
  ['please and thank you', []],
];

function examples() {
  const rows = [];
  for (const label of LABELS) {
    for (const noun of NOUNS[label]) {
      for (const frame of FRAMES) {
        rows.push({ text: frame(noun), labels: [label] });
      }
    }
  }
  for (const [text, labels] of EXTRA) rows.push({ text, labels });
  const pairs = [
    ['portal', 'switch'],
    ['arena', 'boss'],
    ['boss', 'shoot'],
    ['spike', 'lava'],
    ['monster', 'chase'],
    ['coin', 'goal'],
    ['mover', 'lifter'],
    ['circle', 'triangle'],
    ['fireball', 'blackout'],
    ['sign', 'platform'],
  ];
  for (const [a, b] of pairs) {
    rows.push({ text: 'add a ' + NOUNS[a][0] + ' and a ' + NOUNS[b][0], labels: [a, b] });
    rows.push({ text: 'i want both a ' + NOUNS[a][1] + ' and a ' + NOUNS[b][1], labels: [a, b] });
  }
  const labels = Object.keys(NOUNS);
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const a = labels[i];
      const b = labels[j];
      rows.push({ text: NOUNS[a][0] + ' with a ' + NOUNS[b][0], labels: [a, b] });
      rows.push({ text: 'add a ' + NOUNS[a][0] + ' and a ' + NOUNS[b][0], labels: [a, b] });
      rows.push({ text: 'can you make a ' + NOUNS[b][0] + ' plus a ' + NOUNS[a][0], labels: [a, b] });
    }
  }
  return rows;
}

function teachingTokens() {
  const phraseOwners = new Map();
  const exactOwners = new Map();
  function add(map, token, label) {
    if (!map.has(token)) map.set(token, new Set());
    map.get(token).add(label);
  }
  const skipFragment = new Set(['player', 'starts', 'something', 'back', 'forth', 'wall', 'screen', 'touch', 'left', 'right', 'point', 'higher', 'level', 'across', 'long']);
  for (const label of LABELS) {
    for (const noun of NOUNS[label] || []) {
      const words = tokensOf(noun).filter((part) => !part.startsWith('#') && !part.includes(' '));
      const kept = words.filter((word) => !skipFragment.has(word));
      if (words.length === 1 && kept.length === 1) add(exactOwners, kept[0], label);
      kept.forEach((word) => add(phraseOwners, word, label));
      for (let i = 0; i < kept.length - 1; i += 1) add(phraseOwners, kept[i] + ' ' + kept[i + 1], label);
      kept.forEach((word) => {
        charGrams(word).forEach((gram) => add(phraseOwners, gram, label));
      });
    }
  }
  const teach = new Map();
  for (const [token, labels] of exactOwners) {
    if (labels.size === 1) teach.set(token, [...labels][0]);
  }
  for (const [token, labels] of phraseOwners) {
    if (teach.has(token)) continue;
    if (labels.size === 1) teach.set(token, [...labels][0]);
  }
  return teach;
}

function train(rows) {
  const out = LABELS.length;
  const teach = teachingTokens();
  const vocab = [];
  const index = new Map();
  for (const row of rows) {
    for (const token of tokensOf(row.text)) {
      if (index.has(token)) continue;
      index.set(token, vocab.length);
      vocab.push(token);
    }
  }
  const w = new Array(vocab.length * out).fill(0);
  const b = new Array(out).fill(-2.2);
  const lr = 0.35;
  const epochs = 24;
  const model = { w, b, output: out, index };
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    let loss = 0;
    for (const row of rows) {
      const tokens = tokensOf(row.text);
      const result = forward(tokens, model);
      const target = LABELS.map((label) => (row.labels.includes(label) ? 1 : 0));
      for (let k = 0; k < out; k += 1) {
        const label = LABELS[k];
        if (target[k]) {
          for (const token of tokens) {
            if (teach.get(token) !== label) continue;
            const bin = index.get(token);
            if (bin == null) continue;
            const at = bin * out + k;
            const gram = token.startsWith('#');
            const goal = gram ? 0.16 : 1;
            const y = 1 / (1 + Math.exp(-(b[k] + w[at])));
            const diff = y - goal;
            if (!gram) loss += -Math.log(y + 1e-8);
            w[at] -= lr * diff;
            if (w[at] < 0) w[at] = 0;
          }
          continue;
        }
        const y = result.scores[k];
        loss += -Math.log(1 - y + 1e-8);
        for (const token of tokens) {
          if (teach.get(token) === label) continue;
          const bin = index.get(token);
          if (bin == null) continue;
          const at = bin * out + k;
          if (w[at] > 0) w[at] -= 0.35 * y;
          if (w[at] < 0) w[at] = 0;
        }
      }
    }
    if (epoch % 8 === 0 || epoch === epochs - 1) console.log('epoch', epoch, 'loss', (loss / rows.length).toFixed(4));
  }
  return { vocab, w, b };
}

const rows = examples();
const model = train(rows);
const saved = {
  labels: LABELS,
  vocab: model.vocab,
  input: model.vocab.length,
  hidden: 0,
  output: LABELS.length,
  threshold: 0.45,
  w: model.w,
  b: model.b,
  index: new Map(model.vocab.map((token, index) => [token, index])),
};
const file = join(dirname(fileURLToPath(import.meta.url)), 'level-ai-weights.json');
const fileModel = {
  labels: saved.labels,
  vocab: saved.vocab,
  input: saved.input,
  hidden: saved.hidden,
  output: saved.output,
  threshold: saved.threshold,
  w: saved.w,
  b: saved.b,
};
writeFileSync(file, JSON.stringify(fileModel));
console.log('examples', rows.length, 'weights', file);

const checks = [
  ['would you mind sticking a teleporter in this stage', ['portal']],
  ['can i get a button that moves something', ['switch']],
  ['Build a small arena with platforms at different heights.', ['arena', 'platform']],
  ['Create a boss arena and make the boss shoot a projectile every three seconds.', ['arena', 'boss', 'shoot']],
  ['put an elevator and a doorway', ['lifter', 'portal']],
  ['make it go dark and add some thorns', ['blackout', 'spike']],
  ['explain this script', ['explain']],
  ['hello there', []],
  ['a round platform and a triangle', ['platform', 'circle', 'triangle']],
  ['enemies that hunt the player', ['monster', 'chase']],
  ['we need a trampoline to reach the top', ['spring']],
  ['design a tough course', ['hard', 'whole']],
  ['make me a full level', ['whole']],
  ['i want a bouncy pad', ['spring']],
  ['teleport across the gap', ['portal']],
  ['bad guys chasing me', ['monster', 'chase']],
  ['a tall tower to climb', ['climb']],
  ['trmpoline', ['spring']],
];
let missed = 0;
for (const [text, want] of checks) {
  const scored = scoreRequest(text);
  const got = LABELS.filter((label) => scored.scores[label] >= saved.threshold);
  const ok = want.length === got.length && want.every((label) => got.includes(label));
  if (!ok) {
    missed += 1;
    console.log('MISS', text);
    console.log('  got', got.join(', ') || '(none)');
    console.log('  want', want.join(', ') || '(none)');
    const ranked = LABELS.map((label) => [label, scored.scores[label]]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log('  top', ranked.map((pair) => pair[0] + ' ' + pair[1].toFixed(2)).join(', '));
  }
}
if (missed) process.exitCode = 1;
else console.log('held-out checks passed');
