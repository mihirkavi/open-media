/**
 * Password rules for Open Media accounts (ADR 0034). Kept to what actually helps: a length that
 * resists guessing, and the 72-byte limit of the hash Supabase uses (longer passwords would be
 * silently cut). The server enforces the same minimum (auth.minimum_password_length).
 */
export const minimumPasswordLength = 8;
const maximumPasswordBytes = 72;

/** A plain-language problem with this password, or undefined when it is acceptable. */
export function passwordProblem(password: string, email = ''): string | undefined {
  if (password.length < minimumPasswordLength) return `Use at least ${minimumPasswordLength} characters.`;
  if (new TextEncoder().encode(password).length > maximumPasswordBytes) return 'Use a shorter password (at most 72 characters).';
  if (!password.trim()) return 'A password can’t be only spaces.';
  const local = email.trim().toLowerCase().split('@')[0];
  if (local.length >= 4 && password.toLowerCase() === local) return 'Don’t use your email name as your password.';
  return undefined;
}

/** The passkey's relying-party ID for this web address: the site's domain, shared by www. */
export function passkeyRelyingParty(location: { hostname: string; origin: string }): { rpId: string; rpOrigins: string[] } {
  return { rpId: location.hostname.replace(/^www\./, ''), rpOrigins: [location.origin] };
}
