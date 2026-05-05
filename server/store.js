import './env.js';
import { createFileStore } from './store-file.js';
import { createSupabaseStore } from './store-supabase.js';

function pick() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createSupabaseStore();
  }
  return createFileStore();
}

/** @type {ReturnType<typeof createFileStore>} */
export const store = pick();
