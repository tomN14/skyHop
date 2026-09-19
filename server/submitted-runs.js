import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { effectiveRole } from './moderation.js';
import { store } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, 'data', 'submitted_runs_index.json');

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
  const recordingId = String(payload.recordingId || '').trim();
  const inputLogId = String(payload.inputLogId || '').trim();
  const difficulty = String(payload.difficulty || 'normal').toLowerCase();
  if (!['easy', 'normal', 'hard'].includes(difficulty)) throw new Error('Invalid difficulty');
  const timeMs = Math.floor(Number(payload.timeMs));
  const deaths = Math.floor(Number(payload.deaths));
  if (!Number.isFinite(timeMs) || timeMs < 1000) throw new Error('Invalid time');
  if (!Number.isFinite(deaths) || deaths < 0) throw new Error('Invalid deaths');
  await assertUserOwnsRecording(userId, recordingId);
  await assertUserOwnsInputLog(userId, inputLogId);
  const note = String(payload.playerNote || '').trim().slice(0, 500);
  const id = crypto.randomUUID();
  const createdAt = Date.now();

  if (useSupabase()) {
    const sb = sbClient();
    const { error } = await sb.from('skyhop_submitted_runs').insert({
      id,
      user_id: userId,
      recording_id: recordingId,
      input_log_id: inputLogId,
      status: 'unreviewed',
      difficulty,
      time_ms: timeMs,
      deaths,
      player_note: note || null,
      created_at: createdAt,
    });
    if (error) throw new Error(error.message);
    return { id, status: 'unreviewed' };
  }

  const db = fileLoad();
  db.items.push({
    id,
    user_id: userId,
    recording_id: recordingId,
    input_log_id: inputLogId,
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
  });
  fileSave(db);
  return { id, status: 'unreviewed' };
}

async function usernameFor(userId) {
  const u = await store.findUserById(userId);
  return u ? u.username : 'unknown';
}

function mapRow(r, username, extra) {
  return {
    id: r.id,
    userId: Number(r.user_id),
    username: username || 'unknown',
    recordingId: r.recording_id,
    inputLogId: r.input_log_id,
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

const RUN_SELECT_COLS =
  'id, user_id, recording_id, input_log_id, status, difficulty, time_ms, deaths, player_note, reviewed_by, reviewed_at, decline_reason, status_locked, created_at';

export async function submittedRunsStaffList({ username, status }) {
  const st = String(status || 'unreviewed').toLowerCase();
  if (!['unreviewed', 'approved', 'declined', 'all'].includes(st)) throw new Error('Invalid status filter');
  const uname = String(username || '').trim().toLowerCase();

  if (useSupabase()) {
    const sb = sbClient();
    let q = sb
      .from('skyhop_submitted_runs')
      .select(RUN_SELECT_COLS)
      .order('created_at', { ascending: false })
      .limit(100);
    if (st !== 'all') q = q.eq('status', st);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    let rows = data || [];
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
    if (status === 'approved' && !wasApproved && typeof store.addRun === 'function') {
      await store.addRun(row.user_id, row.time_ms, row.deaths, 'campaign', row.difficulty);
    }
    return { ok: true, status };
  }

  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error: e1 } = await sb
      .from('skyhop_submitted_runs')
      .select('id, user_id, difficulty, time_ms, deaths, status, status_locked')
      .eq('id', submissionId)
      .maybeSingle();
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
    if (status === 'approved' && !wasApproved && typeof store.addRun === 'function') {
      await store.addRun(row.user_id, row.time_ms, row.deaths, 'campaign', row.difficulty);
    }
    return { ok: true, status };
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
    const sb = sbClient();
    const { data, error } = await sb
      .from('skyhop_submitted_runs')
      .select(RUN_SELECT_COLS)
      .eq('status', 'approved')
      .not('reviewed_by', 'is', null)
      .order('reviewed_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const out = [];
    for (const r of data || []) {
      const reviewer = r.reviewed_by != null ? await store.findUserById(r.reviewed_by) : null;
      const revRole = reviewer ? effectiveRole(reviewer) : 'player';
      if (revRole !== 'moderator' && revRole !== 'owner') continue;
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
    if (revRole !== 'moderator' && revRole !== 'owner') continue;
    out.push(
      mapRow(r, await usernameFor(r.user_id), {
        reviewedByUsername: reviewer ? reviewer.username : 'unknown',
        reviewedByRole: revRole,
      })
    );
  }
  return out;
}
