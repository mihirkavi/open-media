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

/** True when Supabase refused because passkeys (WebAuthn MFA) are switched off on the server. */
export function passkeysSwitchedOffError(detail: string): boolean {
  return /mfa_webauthn_(enroll|verify)_not_enabled|MFA (enroll|verify) is disabled for WebAuthn/i.test(detail);
}

/**
 * Explains why Supabase refused a password (its `weak_password.reasons`), so the message matches the
 * server's actual rules: production may require character types or block leaked passwords.
 */
export function weakPasswordMessage(reasons: readonly string[] | undefined, serverMessage = ''): string {
  const parts: string[] = [];
  if (reasons?.includes('pwned')) parts.push('This password has appeared in a known data breach, so it isn’t safe. Choose a different one.');
  if (reasons?.includes('length')) {
    const length = serverMessage.match(/at least (\d+) characters/i)?.[1] ?? String(minimumPasswordLength);
    parts.push(`Use at least ${length} characters.`);
  }
  if (reasons?.includes('characters')) {
    const groups = serverMessage.split(/each:/i)[1] ?? '';
    const needed = [
      /[a-z]{3}/.test(groups) ? 'a lowercase letter' : '',
      /[A-Z]{3}/.test(groups) ? 'an uppercase letter' : '',
      /\d{3}/.test(groups) ? 'a number' : '',
      /[!@#$%^&*]/.test(groups) ? 'a symbol (like ! @ # $)' : '',
    ].filter(Boolean);
    const list = needed.length ? needed : ['a lowercase letter', 'an uppercase letter', 'a number'];
    parts.push(`Include at least one of each: ${list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]}.`);
  }
  return parts.join(' ') || 'Choose a stronger password.';
}
