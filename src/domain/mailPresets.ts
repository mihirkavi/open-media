export type SmtpSecurity = 'tls' | 'starttls';

export interface MailServer { host: string; port: number }
export interface SmtpServer extends MailServer { security: SmtpSecurity }

export interface MailProviderPreset {
  id: string;
  label: string;
  domains: string[];
  imap: MailServer;
  smtp: SmtpServer;
  /** What password the provider expects for IMAP/SMTP sign-in. */
  passwordHelp: string;
  /** Shown when the provider is known to restrict password sign-in. */
  caution?: string;
}

/** Standard server settings for common providers. Anything else uses the custom form. */
export const mailProviderPresets: MailProviderPreset[] = [
  {
    id: 'gmail', label: 'Gmail', domains: ['gmail.com', 'googlemail.com'],
    imap: { host: 'imap.gmail.com', port: 993 }, smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' },
    passwordHelp: 'Use a Google app password (Google Account → Security → 2-Step Verification → App passwords). Google Workspace accounts work too if your admin allows IMAP.',
  },
  {
    id: 'icloud', label: 'iCloud Mail', domains: ['icloud.com', 'me.com', 'mac.com'],
    imap: { host: 'imap.mail.me.com', port: 993 }, smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' },
    passwordHelp: 'Use an app-specific password from account.apple.com → Sign-In and Security. The username is your full iCloud address.',
  },
  {
    id: 'outlook', label: 'Outlook.com', domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    imap: { host: 'outlook.office365.com', port: 993 }, smtp: { host: 'smtp-mail.outlook.com', port: 587, security: 'starttls' },
    passwordHelp: 'Use your account password or an app password.',
    caution: 'Microsoft has turned off password sign-in for most Outlook.com and Microsoft 365 mailboxes and requires OAuth, which Open Media does not support yet. It may be refused.',
  },
  {
    id: 'yahoo', label: 'Yahoo Mail', domains: ['yahoo.com', 'ymail.com', 'rocketmail.com'],
    imap: { host: 'imap.mail.yahoo.com', port: 993 }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, security: 'tls' },
    passwordHelp: 'Use a Yahoo app password (Account Security → Generate app password).',
  },
  {
    id: 'aol', label: 'AOL Mail', domains: ['aol.com'],
    imap: { host: 'imap.aol.com', port: 993 }, smtp: { host: 'smtp.aol.com', port: 465, security: 'tls' },
    passwordHelp: 'Use an AOL app password (Account Security → Generate app password).',
  },
  {
    id: 'fastmail', label: 'Fastmail', domains: ['fastmail.com', 'fastmail.fm'],
    imap: { host: 'imap.fastmail.com', port: 993 }, smtp: { host: 'smtp.fastmail.com', port: 465, security: 'tls' },
    passwordHelp: 'Use a Fastmail app password with IMAP and SMTP access (Settings → Privacy & Security → App passwords).',
  },
  {
    id: 'zoho', label: 'Zoho Mail', domains: ['zoho.com', 'zohomail.com'],
    imap: { host: 'imap.zoho.com', port: 993 }, smtp: { host: 'smtp.zoho.com', port: 465, security: 'tls' },
    passwordHelp: 'Enable IMAP in Zoho Mail settings, then use an app-specific password if two-factor sign-in is on.',
  },
  {
    id: 'gmx', label: 'GMX', domains: ['gmx.com', 'gmx.net', 'gmx.de'],
    imap: { host: 'imap.gmx.com', port: 993 }, smtp: { host: 'mail.gmx.com', port: 587, security: 'starttls' },
    passwordHelp: 'Enable IMAP access in GMX settings, then use your account password.',
  },
];

export function presetForEmail(email: string): MailProviderPreset | undefined {
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return undefined;
  return mailProviderPresets.find((preset) => preset.domains.includes(domain));
}

/** Usual SMTP port for a security mode: implicit TLS on 465, STARTTLS on 587. */
export function defaultSmtpPort(security: SmtpSecurity): number {
  return security === 'tls' ? 465 : 587;
}
