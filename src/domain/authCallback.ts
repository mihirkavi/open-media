export interface AuthCallback {
  code?: string;
  error?: string;
}

const nativeSchemes = new Set(['convo:', 'openmedia:']);

export function createAuthRedirectURL(platform: 'web' | 'native', webOrigin?: string): string {
  if (platform === 'native') return 'openmedia://auth';
  if (!webOrigin) throw new Error('A web origin is required for web authentication.');

  const origin = new URL(webOrigin);
  if (origin.protocol !== 'https:' && origin.protocol !== 'http:') {
    throw new Error('Web authentication requires an HTTP or HTTPS origin.');
  }
  return new URL('/auth', origin.origin).toString();
}

export function parseAuthCallbackURL(value: string): AuthCallback | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  const nativeAuth = nativeSchemes.has(url.protocol) && (url.hostname === 'auth' || url.pathname === '/auth');
  const webAuth = (url.protocol === 'https:' || url.protocol === 'http:') && url.pathname.replace(/\/$/, '').endsWith('/auth');
  if (!nativeAuth && !webAuth) return undefined;

  const parameters = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const error = parameters.get('error_description') ?? fragment.get('error_description') ?? parameters.get('error') ?? fragment.get('error');
  if (error) return { error };

  const code = parameters.get('code');
  return code ? { code } : undefined;
}

/**
 * Whether sign-in emails carry a one-time code as well as a link. The repo's templates include
 * the code, so a local stack always does. Production uses Supabase's built-in sender (link only)
 * until custom SMTP and the templates are set up; then the build sets the codes flag to '1'.
 */
export function signInEmailsIncludeCode(supabaseURL: string | undefined, codesFlag: string | undefined): boolean {
  if (codesFlag === '1') return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test((supabaseURL ?? '').replace(/\/$/, ''));
}
