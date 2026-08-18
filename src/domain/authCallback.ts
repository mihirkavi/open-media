export interface AuthCallback {
  code?: string;
  error?: string;
}

const nativeSchemes = new Set(['convo:', 'openmedia:']);

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
