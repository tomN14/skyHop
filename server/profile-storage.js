/**
 * Profile avatars in Supabase Storage bucket skyhop-profiles/{userId}/avatar.*
 */

export const PROFILE_BUCKET = 'skyhop-profiles';
export const MAX_AVATAR_BYTES = 512 * 1024;
export const ALLOWED_AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export function avatarObjectPath(userId, ext) {
  const id = String(userId);
  const e = String(ext || 'webp').replace(/^\./, '').toLowerCase();
  const safe = e === 'jpg' ? 'jpeg' : e;
  if (!['png', 'jpeg', 'webp', 'gif'].includes(safe)) throw new Error('Unsupported image type');
  return `${id}/avatar.${safe === 'jpeg' ? 'jpg' : safe}`;
}

export function publicAvatarUrl(supabaseUrl, storagePath) {
  const base = String(supabaseUrl || '').replace(/\/$/, '');
  if (!base || !storagePath) return null;
  const enc = storagePath
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/');
  return `${base}/storage/v1/object/public/${PROFILE_BUCKET}/${enc}`;
}

export function extFromContentType(ct) {
  const t = String(ct || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  return null;
}

export function sniffImageExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x52) return 'webp';
  return null;
}

export async function uploadProfileAvatar(sb, userId, buffer, contentType) {
  const ext = extFromContentType(contentType) || sniffImageExt(buffer);
  if (!ext) throw new Error('File must be PNG, JPEG, WebP, or GIF.');
  if (!ALLOWED_AVATAR_TYPES.has(`image/${ext === 'jpg' ? 'jpeg' : ext}`)) {
    throw new Error('File must be PNG, JPEG, WebP, or GIF.');
  }
  if (buffer.length > MAX_AVATAR_BYTES) throw new Error('Avatar must be 512 KB or smaller.');
  const path = avatarObjectPath(userId, ext);
  const { error } = await sb.storage.from(PROFILE_BUCKET).upload(path, buffer, {
    contentType: contentType || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function createSignedAvatarUpload(sb, userId, ext = 'webp') {
  const path = avatarObjectPath(userId, ext);
  const { data, error } = await sb.storage.from(PROFILE_BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(error.message);
  return { path, signedUrl: data.signedUrl, token: data.token };
}

export async function removeUserProfileStorage(sb, userId) {
  const prefix = `${userId}/`;
  const { data: listed } = await sb.storage.from(PROFILE_BUCKET).list(String(userId), { limit: 20 });
  if (!listed || !listed.length) return;
  const paths = listed.map((o) => `${prefix}${o.name}`);
  await sb.storage.from(PROFILE_BUCKET).remove(paths);
}
