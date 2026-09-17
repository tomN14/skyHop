/**
 * Owner notification email (account deletion confirm). Uses Resend HTTP API if configured.
 */

export async function sendOwnerMail({ to, subject, html, text }) {
  const apiKey = process.env.SKYHOP_RESEND_API_KEY || process.env.RESEND_API_KEY;
  const from = process.env.SKYHOP_MAIL_FROM || 'Sky Hop <onboarding@resend.dev>';
  if (!to) throw new Error('No owner email configured (SKYHOP_OWNER_EMAIL).');

  if (apiKey) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.error('[Sky Hop mail] Resend HTTP', r.status, body.slice(0, 400));
      throw new Error('Email send failed: ' + body.slice(0, 300));
    }
    return { ok: true, via: 'resend' };
  }

  console.warn('[Sky Hop mail] No SKYHOP_RESEND_API_KEY — deletion link logged below.');
  console.warn('[Sky Hop mail]', subject);
  console.warn(text);
  return { ok: true, via: 'log' };
}
