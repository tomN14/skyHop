import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { effectiveRole, isStaffRole } from './moderation.js';
import { store } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, 'data', 'submitted_runs_index.json');

export const SUBMIT_RUN_COINS = 50;
export const ACCEPT_RUN_COINS = 50;
export const TOP10_RANK_UNIT_COINS = 50;

export function top10RankBonus(rank) {
  const r = Math.floor(Number(rank));
  if (!Number.isFinite(r) || r < 1 || r > 10) return 0;
  return (11 - r) * TOP10_RANK_UNIT_COINS;
}

async function creditPlayerCoins(userId, amount) {
  const amt = Math.floor(Number(amount) || 0);
  if (amt <= 0) return 0;
  const u = await store.findUserById(userId);
  if (!u) return 0;
  if (effectiveRole(u) === 'owner') return 0;
  if (typeof store.incrementUserCoins !== 'function') return 0;
  await store.incrementUserCoins(userId, amt);
  return amt;
}

function coinFieldPaid(v) {
  return v != null && v !== '';
}

async function persistSubmissionCoinFields(id, patch) {
  if (useSupabase()) {
    const sb = sbClient();
    const { error } = await sb.from('skyhop_submitted_runs').update(patch).eq('id', id);
    if (error && /submit_coins|accept_coins|rank_coins|lb_rank|column/i.test(String(error.message || ''))) {
      return;
    }
    if (error) throw new Error(error.message);
  }
}

async function grantAcceptAndRankCoins(row) {
  let coinsAwarded = 0;
  const uid = Number(row.user_id);
  if (!coinFieldPaid(row.accept_coins)) {
    const paid = await creditPlayerCoins(uid, ACCEPT_RUN_COINS);
    row.accept_coins = paid;
    coinsAwarded += paid;
  }
  if (!coinFieldPaid(row.rank_coins)) {
    let bonus = 0;
    let rank = null;
    if (typeof store.campaignTimeRankTop10 === 'function' && row._addedRunId != null) {
      rank = await store.campaignTimeRankTop10(row._addedRunId, row.difficulty);
    } else if (typeof store.listOwnerCampaignLeaderboardEntries === 'function') {
      const top = await store.listOwnerCampaignLeaderboardEntries(row.difficulty, 10);
      const idx = (top || []).findIndex(
        (r) => Number(r.userId) === Number(row.user_id) && Number(r.timeMs) === Number(row.time_ms)
      );
      rank = idx >= 0 ? idx + 1 : null;
    }
    bonus = top10RankBonus(rank);
    const paid = bonus > 0 ? await creditPlayerCoins(uid, bonus) : 0;
    row.rank_coins = paid;
    row.lb_rank = rank;
    coinsAwarded += paid;
  }
  try {
    await persistSubmissionCoinFields(row.id, {
      accept_coins: row.accept_coins,
      rank_coins: row.rank_coins,
      lb_rank: row.lb_rank != null ? row.lb_rank : null,
    });
  } catch {
    /* flags are best-effort */
  }
  return coinsAwarded;
}

function useSupabase() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let _sb = null;
function sbClient() {
  if (!_sb && useSupabase()) {
    _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket },
    });
  }
  return _sb;
}

function fileLoad() {
  const dir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(INDEX_PATH)) {
    const empty = { items: [] };
    fs.writeFileSync(INDEX_PATH, JSON.stringify(empty), 'utf8');
    return empty;
  }
  try {
    const j = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (!Array.isArray(j.items)) j.items = [];
    return j;
  } catch {
    return { items: [] };
  }
}

function fileSave(db) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(db), 'utf8');
}

async function assertUserOwnsRecording(userId, recordingId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb
      .from('skyhop_recordings')
      .select('id, user_id')
      .eq('id', recordingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || Number(data.user_id) !== Number(userId)) throw new Error('Recording not found');
    return;
  }
  const { recordingsListForUser } = await import('./recordings.js');
  const list = await recordingsListForUser(userId);
  if (!list.some((r) => r.id === recordingId)) throw new Error('Recording not found');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MEDIA_PER_RUN = 20;

function normalizeIdList(rawList, fallback, label) {
  const src =
    Array.isArray(rawList) && rawList.length
      ? rawList
      : fallback != null && String(fallback).trim()
        ? [fallback]
        : [];
  const out = [];
  const seen = new Set();
  for (const x of src) {
    const id = String(x || '').trim();
    if (!id || seen.has(id)) continue;
    if (!UUID_RE.test(id)) throw new Error('Invalid ' + label + ' id');
    seen.add(id);
    out.push(id);
  }
  if (!out.length) throw new Error('Pick at least one ' + label);
  if (out.length > MAX_MEDIA_PER_RUN) throw new Error('Too many ' + label + 's (max ' + MAX_MEDIA_PER_RUN + ')');
  return out;
}

function asIdList(value, fallback) {
  if (Array.isArray(value) && value.length) return value.map(String);
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length) return parsed.map(String);
    } catch {
      /* ignore */
    }
  }
  if (fallback != null && String(fallback).trim()) return [String(fallback)];
  return [];
}

async function assertUserOwnsInputLog(userId, inputLogId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb
      .from('skyhop_input_logs')
      .select('id, user_id')
      .eq('id', inputLogId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || Number(data.user_id) !== Number(userId)) throw new Error('Input log not found');
    return;
  }
  const { inputLogsListForUser } = await import('./input-logs.js');
  const list = await inputLogsListForUser(userId);
  if (!list.some((r) => r.id === inputLogId)) throw new Error('Input log not found');
}

export async function submittedRunCreate(userId, payload) {
  const recordingIds = normalizeIdList(payload.recordingIds, payload.recordingId, 'recording');
  const inputLogIds = normalizeIdList(payload.inputLogIds, payload.inputLogId, 'input log');
  const recordingId = recordingIds[0];
  const inputLogId = inputLogIds[0];
  const difficulty = String(payload.difficulty || 'normal').toLowerCase();
  if (!['easy', 'normal', 'hard'].includes(difficulty)) throw new Error('Invalid difficulty');
  const timeMs = Math.floor(Number(payload.timeMs));
  const deaths = Math.floor(Number(payload.deaths));
  if (!Number.isFinite(timeMs) || timeMs < 1000) throw new Error('Invalid time');
  if (!Number.isFinite(deaths) || deaths < 0) throw new Error('Invalid deaths');
  const { recordingsMetaForUser } = await import('./recordings.js');
  const { inputLogsMetaForUser } = await import('./input-logs.js');
  for (const id of recordingIds) {
    await assertUserOwnsRecording(userId, id);
    const recMeta = await recordingsMetaForUser(userId, id);
    if (recMeta && recMeta.anticheatOn === false) {
      throw new Error('You may not submit this run as anti-cheat was off.');
    }
  }
  for (const id of inputLogIds) {
    await assertUserOwnsInputLog(userId, id);
    const logMeta = await inputLogsMetaForUser(userId, id);
    if (logMeta && logMeta.anticheatOn === false) {
      throw new Error('You may not submit this run as anti-cheat was off.');
    }
  }
  const note = String(payload.playerNote || '').trim().slice(0, 500);
  const id = crypto.randomUUID();
  const createdAt = Date.now();

  if (useSupabase()) {
    const sb = sbClient();
    const row = {
      id,
      user_id: userId,
      recording_id: recordingId,
      input_log_id: inputLogId,
      recording_ids: recordingIds,
      input_log_ids: inputLogIds,
      status: 'unreviewed',
      difficulty,
      time_ms: timeMs,
      deaths,
      player_note: note || null,
      created_at: createdAt,
    };
    const { error } = await sb.from('skyhop_submitted_runs').insert(row);
    if (error) {
      const msg = String(error.message || '');
      const missingMedia = /recording_ids|input_log_ids/i.test(msg);
      if (missingMedia && (recordingIds.length > 1 || inputLogIds.length > 1)) {
        throw new Error(
          'Multiple recordings need a database update. Ask the site owner to run extend_v22_submitted_run_media_lists.sql.'
        );
      }
      if (missingMedia) {
        delete row.recording_ids;
        delete row.input_log_ids;
      }
      if (missingMedia) {
        const retry = await sb.from('skyhop_submitted_runs').insert(row);
        if (retry.error) throw new Error(retry.error.message);
      } else {
        throw new Error(error.message);
      }
    }
    const submitCoins = await creditPlayerCoins(userId, SUBMIT_RUN_COINS);
    try {
      await persistSubmissionCoinFields(id, { submit_coins: submitCoins });
    } catch {
      /* flags are best-effort */
    }
    return { id, status: 'unreviewed', coinsAwarded: submitCoins };
  }

  const db = fileLoad();
  db.items.push({
    id,
    user_id: userId,
    recording_id: recordingId,
    input_log_id: inputLogId,
    recording_ids: recordingIds,
    input_log_ids: inputLogIds,
    status: 'unreviewed',
    difficulty,
    time_ms: timeMs,
    deaths,
    player_note: note || null,
    reviewed_by: null,
    reviewed_at: null,
    decline_reason: null,
    status_locked: false,
    created_at: createdAt,
    submit_coins: 0,
    accept_coins: null,
    rank_coins: null,
    lb_rank: null,
  });
  fileSave(db);
  const submitCoins = await creditPlayerCoins(userId, SUBMIT_RUN_COINS);
  const saved = db.items.find((r) => r.id === id);
  if (saved) saved.submit_coins = submitCoins;
  fileSave(db);
  return { id, status: 'unreviewed', coinsAwarded: submitCoins };
}

async function usernameFor(userId) {
  const u = await store.findUserById(userId);
  return u ? u.username : 'unknown';
}

function mapRow(r, username, extra) {
  const recordingIds = asIdList(r.recording_ids, r.recording_id);
  const inputLogIds = asIdList(r.input_log_ids, r.input_log_id);
  return {
    id: r.id,
    userId: Number(r.user_id),
    username: username || 'unknown',
    recordingId: recordingIds[0] || r.recording_id,
    inputLogId: inputLogIds[0] || r.input_log_id,
    recordingIds,
    inputLogIds,
    status: r.status,
    difficulty: r.difficulty,
    timeMs: Number(r.time_ms),
    deaths: Number(r.deaths),
    playerNote: r.player_note || null,
    reviewedBy: r.reviewed_by != null ? Number(r.reviewed_by) : null,
    reviewedAt: r.reviewed_at != null ? Number(r.reviewed_at) : null,
    declineReason: r.decline_reason || null,
    statusLocked: !!r.status_locked,
    createdAt: Number(r.created_at),
    ...(extra || {}),
  };
}

const RUN_SELECT_BASE =
  'id, user_id, recording_id, input_log_id, status, difficulty, time_ms, deaths, player_note, reviewed_by, reviewed_at, decline_reason, status_locked, created_at';
const RUN_SELECT_COLS = RUN_SELECT_BASE + ', recording_ids, input_log_ids';

async function selectSubmittedRows(build) {
  const sb = sbClient();
  let q = build(sb, RUN_SELECT_COLS);
  let { data, error } = await q;
  if (error && /recording_ids|input_log_ids|column/i.test(String(error.message || ''))) {
    q = build(sb, RUN_SELECT_BASE);
    ({ data, error } = await q);
  }
  if (error) throw new Error(error.message);
  return data || [];
}

export async function submittedRunsStaffList({ username, status }) {
  const st = String(status || 'unreviewed').toLowerCase();
  if (!['unreviewed', 'approved', 'declined', 'all'].includes(st)) throw new Error('Invalid status filter');
  const uname = String(username || '').trim().toLowerCase();

  if (useSupabase()) {
    let rows = await selectSubmittedRows((sb, cols) => {
      let q = sb.from('skyhop_submitted_runs').select(cols).order('created_at', { ascending: false }).limit(100);
      if (st !== 'all') q = q.eq('status', st);
      return q;
    });
    if (uname) {
      const filtered = [];
      for (const r of rows) {
        const u = await store.findUserById(r.user_id);
        if (u && String(u.username || '').toLowerCase() === uname) filtered.push(r);
      }
      rows = filtered;
    }
    const out = [];
    for (const r of rows) {
      out.push(mapRow(r, await usernameFor(r.user_id)));
    }
    return out;
  }

  const db = fileLoad();
  let rows = db.items.slice();
  if (st !== 'all') rows = rows.filter((r) => r.status === st);
  if (uname) {
    const filtered = [];
    for (const r of rows) {
      const u = await store.findUserById(r.user_id);
      if (u && String(u.username || '').toLowerCase() === uname) filtered.push(r);
    }
    rows = filtered;
  }
  rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const out = [];
  for (const r of rows.slice(0, 100)) {
    out.push(mapRow(r, await usernameFor(r.user_id)));
  }
  return out;
}

export async function submittedRunStaffReview(staffUserId, staffRole, submissionId, newStatus, declineReason) {
  const status = String(newStatus || '').toLowerCase();
  if (!['approved', 'declined', 'unreviewed'].includes(status)) throw new Error('Invalid status');
  const role = String(staffRole || 'player').toLowerCase();
  const isOwner = role === 'owner';
  const reason = String(declineReason || '').trim().slice(0, 1000);
  if (status === 'declined' && !reason) throw new Error('Reason for Denial is required.');
  const now = Date.now();

  async function applyReview(row) {
    if (row.status_locked && !isOwner) {
      throw new Error('This run’s status is locked by the site owner.');
    }
    const wasApproved = row.status === 'approved';
    row.status = status;
    row.reviewed_by = staffUserId;
    row.reviewed_at = now;
    if (status === 'declined') row.decline_reason = reason;
    else row.decline_reason = null;
    let coinsAwarded = 0;
    if (status === 'approved' && !wasApproved && typeof store.addRun === 'function') {
      const added = await store.addRun(row.user_id, row.time_ms, row.deaths, 'campaign', row.difficulty);
      row._addedRunId = added && added.id;
      coinsAwarded = await grantAcceptAndRankCoins(row);
    }
    return { ok: true, status, coinsAwarded };
  }

  if (useSupabase()) {
    const sb = sbClient();
    let row;
    let e1;
    ({ data: row, error: e1 } = await sb
      .from('skyhop_submitted_runs')
      .select('id, user_id, difficulty, time_ms, deaths, status, status_locked, accept_coins, rank_coins, lb_rank')
      .eq('id', submissionId)
      .maybeSingle());
    if (e1 && /accept_coins|rank_coins|lb_rank|column/i.test(String(e1.message || ''))) {
      ({ data: row, error: e1 } = await sb
        .from('skyhop_submitted_runs')
        .select('id, user_id, difficulty, time_ms, deaths, status, status_locked')
        .eq('id', submissionId)
        .maybeSingle());
    }
    if (e1) throw new Error(e1.message);
    if (!row) throw new Error('Not found');
    if (row.status_locked && !isOwner) throw new Error('This run’s status is locked by the site owner.');
    const wasApproved = row.status === 'approved';
    const patch = {
      status,
      reviewed_by: staffUserId,
      reviewed_at: now,
      decline_reason: status === 'declined' ? reason : null,
    };
    const { error: e2 } = await sb.from('skyhop_submitted_runs').update(patch).eq('id', submissionId);
    if (e2) throw new Error(e2.message);
    let coinsAwarded = 0;
    if (status === 'approved' && !wasApproved && typeof store.addRun === 'function') {
      const added = await store.addRun(row.user_id, row.time_ms, row.deaths, 'campaign', row.difficulty);
      row._addedRunId = added && added.id;
      coinsAwarded = await grantAcceptAndRankCoins(row);
    }
    return { ok: true, status, coinsAwarded };
  }

  const db = fileLoad();
  const row = db.items.find((r) => r.id === submissionId);
  if (!row) throw new Error('Not found');
  if (row.status_locked == null) row.status_locked = false;
  if (row.decline_reason == null) row.decline_reason = null;
  const out = await applyReview(row);
  fileSave(db);
  return out;
}

export async function submittedRunOwnerLockStatus(submissionId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error: e1 } = await sb
      .from('skyhop_submitted_runs')
      .select('id, status')
      .eq('id', submissionId)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!row) throw new Error('Not found');
    if (row.status !== 'approved' && row.status !== 'declined') {
      throw new Error('Only approved or declined runs can be locked.');
    }
    const { error: e2 } = await sb.from('skyhop_submitted_runs').update({ status_locked: true }).eq('id', submissionId);
    if (e2) throw new Error(e2.message);
    return { ok: true, statusLocked: true };
  }
  const db = fileLoad();
  const row = db.items.find((r) => r.id === submissionId);
  if (!row) throw new Error('Not found');
  if (row.status !== 'approved' && row.status !== 'declined') {
    throw new Error('Only approved or declined runs can be locked.');
  }
  row.status_locked = true;
  fileSave(db);
  return { ok: true, statusLocked: true };
}

/** Approved submitted runs that staff have reviewed (owner oversight queue). */
export async function submittedRunsOwnerModApprovedList() {
  if (useSupabase()) {
    const data = await selectSubmittedRows((sb, cols) =>
      sb
        .from('skyhop_submitted_runs')
        .select(cols)
        .eq('status', 'approved')
        .not('reviewed_by', 'is', null)
        .order('reviewed_at', { ascending: false })
        .limit(100)
    );
    const out = [];
    for (const r of data) {
      const reviewer = r.reviewed_by != null ? await store.findUserById(r.reviewed_by) : null;
      const revRole = reviewer ? effectiveRole(reviewer) : 'player';
      if (!isStaffRole(revRole)) continue;
      out.push(
        mapRow(r, await usernameFor(r.user_id), {
          reviewedByUsername: reviewer ? reviewer.username : 'unknown',
          reviewedByRole: revRole,
        })
      );
    }
    return out;
  }
  const db = fileLoad();
  const rows = db.items
    .filter((r) => r.status === 'approved' && r.reviewed_by != null)
    .sort((a, b) => (b.reviewed_at || 0) - (a.reviewed_at || 0))
    .slice(0, 100);
  const out = [];
  for (const r of rows) {
    const reviewer = await store.findUserById(r.reviewed_by);
    const revRole = reviewer ? effectiveRole(reviewer) : 'player';
    if (!isStaffRole(revRole)) continue;
    out.push(
      mapRow(r, await usernameFor(r.user_id), {
        reviewedByUsername: reviewer ? reviewer.username : 'unknown',
        reviewedByRole: revRole,
      })
    );
  }
  return out;
}
