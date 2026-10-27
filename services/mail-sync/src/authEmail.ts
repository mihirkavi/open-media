/**
 * Open Media's own sign-in emails.
 *
 * Supabase Auth calls this hook (POST /auth/hooks/send-email, a Standard Webhooks request signed
 * with SEND_EMAIL_HOOK_SECRET) instead of sending its plain default emails. The Worker renders an
 * Open Media email, with a one-tap button and the code, and sends it from security@openmedia.site
 * through Cloudflare Email Sending (the EMAIL binding). Nothing is stored; the code only travels in
 * the email itself.
 */

export interface AuthEmailEnv {
  SUPABASE_URL: string;
  SEND_EMAIL_HOOK_SECRET?: string;
  AUTH_EMAIL_FROM?: string;
  EMAIL?: { send(message: { from: string | { email: string; name: string }; to: string; subject: string; html: string; text: string; headers?: Record<string, string> }): Promise<{ messageId?: string }> };
}

type Action = 'magiclink' | 'signup' | 'recovery' | 'invite' | 'email_change' | 'reauthentication' | 'email';

export interface HookPayload {
  user: { email: string; new_email?: string };
  email_data: { token: string; token_hash: string; redirect_to: string; email_action_type: Action; site_url?: string; token_new?: string; token_hash_new?: string };
}

export interface AuthEmail { to: string; subject: string; html: string; text: string }

const brand = { site: 'https://openmedia.site', logo: 'https://openmedia.site/brand/logo-light.png', logoDark: 'https://openmedia.site/brand/logo-dark.png' };

// ─── Standard Webhooks signature ─────────────────────────────────────────────

const encoder = new TextEncoder();

/** Checks webhook-id, webhook-timestamp and webhook-signature against the "v1,whsec_…" secret. */
export async function verifyHookSignature(headers: Headers, body: string, secret: string, now = Date.now()): Promise<boolean> {
  const id = headers.get('webhook-id'); const timestamp = headers.get('webhook-timestamp'); const signatures = headers.get('webhook-signature');
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 5 * 60) return false;
  const key = Uint8Array.from(atob(secret.replace(/^v1,/, '').replace(/^whsec_/, '')), (char) => char.charCodeAt(0));
  const hmac = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', hmac, encoder.encode(`${id}.${timestamp}.${body}`)))));
  return signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value || value.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < value.length; index += 1) difference |= value.charCodeAt(index) ^ expected.charCodeAt(index);
    return difference === 0;
  });
}

// ─── Content ─────────────────────────────────────────────────────────────────

const copy: Record<Action, { subject: string; heading: string; intro: string; button: string }> = {
  magiclink: { subject: 'Your Open Media sign-in code', heading: 'Sign in to Open Media', intro: 'Tap the button to sign in on this device, or type the code in Open Media on any device.', button: 'Sign in to Open Media' },
  email: { subject: 'Your Open Media sign-in code', heading: 'Sign in to Open Media', intro: 'Tap the button to sign in on this device, or type the code in Open Media on any device.', button: 'Sign in to Open Media' },
  signup: { subject: 'Welcome to Open Media: confirm your email', heading: 'Welcome to Open Media', intro: 'Confirm this is your email to finish creating your account. Tap the button, or type the code in Open Media.', button: 'Confirm my email' },
  invite: { subject: 'You’re invited to Open Media', heading: 'You’re invited to Open Media', intro: 'Someone invited you to Open Media, one open app for your social world. Tap the button to accept.', button: 'Accept the invitation' },
  recovery: { subject: 'Get back into Open Media', heading: 'Get back into your account', intro: 'Tap the button to sign in again, or type the code in Open Media.', button: 'Sign in to Open Media' },
  email_change: { subject: 'Confirm your new email for Open Media', heading: 'Confirm your email change', intro: 'Confirm this change to the email on your Open Media account. Tap the button, or type the code in Open Media.', button: 'Confirm the change' },
  reauthentication: { subject: 'Your Open Media confirmation code', heading: 'Confirm it’s you', intro: 'Type this code in Open Media to confirm the change you asked for.', button: '' },
};

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const spaced = (code: string) => (code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code);

export function verifyLink(supabaseUrl: string, tokenHash: string, type: Action, redirectTo: string): string {
  const url = new URL('/auth/v1/verify', supabaseUrl);
  url.searchParams.set('token', tokenHash);
  url.searchParams.set('type', type);
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

/** The Open Media email: a quiet black-and-white card with the button, the code and a safety note. */
export function renderAuthEmail(input: { to: string; action: Action; code: string; link?: string }): AuthEmail {
  const text = copy[input.action] ?? copy.magiclink;
  const code = escape(spaced(input.code));
  const button = input.link && text.button
    ? `<tr><td align="center" style="padding:8px 0 28px"><a href="${escape(input.link)}" class="button" style="display:inline-block;background:#111111;color:#ffffff;font-size:16px;font-weight:600;line-height:20px;text-decoration:none;padding:15px 28px;border-radius:999px">${escape(text.button)}</a></td></tr>`
    : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escape(text.subject)}</title>
<style>
body{margin:0;padding:0;background:#f4f3ef}
.light-logo{display:inline-block}.dark-logo{display:none}
@media (prefers-color-scheme:dark){
 body,.page{background:#0d0d0d!important}.card{background:#171717!important;border-color:#2a2a2a!important}
 .ink{color:#f5f5f2!important}.muted{color:#a3a3a0!important}.codebox{background:#222222!important;border-color:#333333!important}
 .button{background:#f5f5f2!important;color:#111111!important}.light-logo{display:none!important}.dark-logo{display:inline-block!important}
}
@media (max-width:520px){.card{border-radius:0!important;border-left:0!important;border-right:0!important}.pad{padding:32px 24px!important}}
</style></head>
<body class="page" style="margin:0;padding:0;background:#f4f3ef">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(text.heading)}. Your code is ${code}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="page" style="background:#f4f3ef"><tr><td align="center" style="padding:40px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td align="center" style="padding:0 0 24px"><a href="${brand.site}" style="text-decoration:none"><img class="light-logo" src="${brand.logo}" width="36" height="36" alt="" style="vertical-align:middle;border:0"><img class="dark-logo" src="${brand.logoDark}" width="36" height="36" alt="" style="vertical-align:middle;border:0"><span class="ink" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;color:#111111;vertical-align:middle;padding-left:10px">Open Media</span></a></td></tr>
<tr><td class="card" style="background:#ffffff;border:1px solid #e7e5df;border-radius:20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="pad" style="padding:40px 40px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<h1 class="ink" style="margin:0 0 12px;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:34px;line-height:38px;font-weight:400;color:#111111">${escape(text.heading)}</h1>
<p class="muted" style="margin:0 0 28px;font-size:15px;line-height:23px;color:#5c5c58">${escape(text.intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${button}
<tr><td align="center" class="codebox" style="background:#f7f6f2;border:1px solid #ecebe6;border-radius:14px;padding:20px 12px">
<div class="muted" style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#77776f;padding-bottom:8px">Your code</div>
<div class="ink" style="font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;font-size:30px;line-height:36px;letter-spacing:.18em;font-weight:600;color:#111111">${code}</div>
</td></tr></table>
<p class="muted" style="margin:24px 0 0;font-size:13px;line-height:20px;color:#77776f">The code and button work once and expire in 15 minutes. No one from Open Media will ever ask for it. If an AI assistant you use is signing you in for you, share the code only with that assistant.</p>
</td></tr></table></td></tr>
<tr><td align="center" style="padding:24px 24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<p class="muted" style="margin:0;font-size:12px;line-height:18px;color:#8a8a83">Didn’t ask for this? You can ignore this email; nothing changes without the code.<br><a href="${brand.site}" class="muted" style="color:#8a8a83;text-decoration:underline">openmedia.site</a> · One open app for your social world</p>
</td></tr></table></td></tr></table></body></html>`;
  const plain = [
    text.heading, '', text.intro, '',
    `Your code: ${spaced(input.code)}`,
    ...(input.link && text.button ? ['', `${text.button}: ${input.link}`] : []),
    '', 'The code and link work once and expire in 15 minutes. No one from Open Media will ever ask for it.',
    'Didn’t ask for this? Ignore this email; nothing changes without the code.', '', 'Open Media · https://openmedia.site',
  ].join('\n');
  return { to: input.to, subject: text.subject, html, text: plain };
}

/** The emails one hook call should send (an email change with secure change on sends two). */
export function authEmailsFor(payload: HookPayload, supabaseUrl: string): AuthEmail[] {
  const { user, email_data: data } = payload;
  const action = data.email_action_type;
  const link = (hash: string) => (action === 'reauthentication' ? undefined : verifyLink(supabaseUrl, hash, action === 'email' ? 'magiclink' : action, data.redirect_to));
  if (action === 'email_change' && user.new_email) {
    const emails: AuthEmail[] = [];
    if (data.token_hash) emails.push(renderAuthEmail({ to: user.email, action, code: data.token, link: link(data.token_hash) }));
    if (data.token_hash_new) emails.push(renderAuthEmail({ to: user.new_email, action, code: data.token_new ?? '', link: link(data.token_hash_new) }));
    return emails;
  }
  return [renderAuthEmail({ to: user.email, action, code: data.token, link: data.token_hash ? link(data.token_hash) : undefined })];
}

// ─── The hook ────────────────────────────────────────────────────────────────

const hookError = (status: number, message: string) => new Response(JSON.stringify({ error: { http_code: status, message } }), { status, headers: { 'content-type': 'application/json' } });

export async function handleSendEmailHook(request: Request, env: AuthEmailEnv): Promise<Response> {
  if (!env.SEND_EMAIL_HOOK_SECRET || !env.EMAIL) return hookError(503, 'Open Media email is not configured.');
  const body = await request.text();
  if (!(await verifyHookSignature(request.headers, body, env.SEND_EMAIL_HOOK_SECRET))) return hookError(401, 'Invalid signature.');
  let payload: HookPayload;
  try { payload = JSON.parse(body); } catch { return hookError(400, 'Invalid payload.'); }
  if (!payload?.user?.email || !payload.email_data?.email_action_type) return hookError(400, 'Invalid payload.');
  const from = { email: env.AUTH_EMAIL_FROM ?? 'security@openmedia.site', name: 'Open Media' };
  try {
    for (const email of authEmailsFor(payload, env.SUPABASE_URL)) {
      await env.EMAIL.send({ from, to: email.to, subject: email.subject, html: email.html, text: email.text });
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'auth_email_failed', action: payload.email_data.email_action_type, error: error instanceof Error ? error.message : String(error) }));
    return hookError(502, 'The email could not be sent. Try again in a minute.');
  }
  return new Response('{}', { headers: { 'content-type': 'application/json' } });
}
