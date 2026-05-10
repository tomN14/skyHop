/** @typedef {{ runCount: number, totalDeaths: number, minDeaths: number|null, maxDeaths: number|null, bestTimeMs: number|null, avgTimeMs: number|null, avgDeaths: number|null }} Agg */

/** Coins granted per newly unlocked achievement on run submit. */
export const ACHIEVEMENT_COIN_REWARD = 40;

export const ACHIEVEMENT_DEFS = [
  { id: 'first_clear', title: 'Sky conquered', desc: 'Finish all 50 stages once and submit the run.' },
  { id: 'zero_death', title: 'Untouchable', desc: 'Complete a run with 0 deaths.' },
  { id: 'speed_45', title: 'Swift climber', desc: 'Best run under 45 minutes.' },
  { id: 'speed_20', title: 'Speed demon', desc: 'Best run under 20 minutes.' },
  { id: 'ten_runs', title: 'Veteran', desc: 'Submit 10 completed runs.' },
  { id: 'fifty_runs', title: 'Obsessed', desc: 'Submit 50 completed runs.' },
  { id: 'deaths_100', title: 'Learning curve', desc: '100 total deaths across all runs.' },
  { id: 'deaths_1000', title: 'Pin cushion', desc: '1,000 total deaths across all runs.' },
  { id: 'bloodbath', title: 'One brutal run', desc: 'A single run with at least 80 deaths.' },
  { id: 'marathon_slow', title: 'Slow and steady', desc: 'A run longer than 3 hours.' },
];

/**
 * @param {string} id
 * @param {Agg} agg
 * @param {Array<{ deaths: number, timeMs: number }>} runs
 */
function condition(id, agg, runs) {
  switch (id) {
    case 'first_clear':
      return agg.runCount >= 1;
    case 'zero_death':
      return runs.some((r) => r.deaths === 0);
    case 'speed_45':
      return agg.bestTimeMs != null && agg.bestTimeMs <= 45 * 60 * 1000;
    case 'speed_20':
      return agg.bestTimeMs != null && agg.bestTimeMs <= 20 * 60 * 1000;
    case 'ten_runs':
      return agg.runCount >= 10;
    case 'fifty_runs':
      return agg.runCount >= 50;
    case 'deaths_100':
      return agg.totalDeaths >= 100;
    case 'deaths_1000':
      return agg.totalDeaths >= 1000;
    case 'bloodbath':
      return runs.some((r) => r.deaths >= 80);
    case 'marathon_slow':
      return runs.some((r) => r.timeMs >= 3 * 60 * 60 * 1000);
    default:
      return false;
  }
}

export function aggregateRuns(runs) {
  if (!runs.length) {
    return {
      runCount: 0,
      totalDeaths: 0,
      minDeaths: null,
      maxDeaths: null,
      bestTimeMs: null,
      avgTimeMs: null,
      avgDeaths: null,
    };
  }
  let totalDeaths = 0;
  let minDeaths = Infinity;
  let maxDeaths = 0;
  let bestTimeMs = Infinity;
  let totalTime = 0;
  for (const r of runs) {
    totalDeaths += r.deaths;
    minDeaths = Math.min(minDeaths, r.deaths);
    maxDeaths = Math.max(maxDeaths, r.deaths);
    bestTimeMs = Math.min(bestTimeMs, r.timeMs);
    totalTime += r.timeMs;
  }
  return {
    runCount: runs.length,
    totalDeaths,
    minDeaths: minDeaths === Infinity ? null : minDeaths,
    maxDeaths,
    bestTimeMs: bestTimeMs === Infinity ? null : bestTimeMs,
    avgTimeMs: totalTime / runs.length,
    avgDeaths: totalDeaths / runs.length,
  };
}

/**
 * @param {Array<{ deaths: number, timeMs: number }>} runs
 * @param {string[]} unlockedIds achievement ids already saved
 * @returns {typeof ACHIEVEMENT_DEFS}
 */
export function computeNewUnlocks(runs, unlockedIds) {
  const agg = aggregateRuns(runs);
  const have = new Set(unlockedIds);
  const newOnes = [];
  for (const def of ACHIEVEMENT_DEFS) {
    if (have.has(def.id)) continue;
    if (condition(def.id, agg, runs)) newOnes.push(def);
  }
  return newOnes;
}
