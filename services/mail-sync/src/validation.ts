import { z } from 'zod';

const fieldMessages: Record<string, string> = {
  email: 'Enter a valid email address.',
  host: 'Enter the incoming mail server, like imap.example.com.',
  port: 'Enter the incoming server port (usually 993 for IMAP or 995 for POP).',
  username: 'Enter the username (usually your full email address).',
  password: 'Enter the password (usually an app password from your provider).',
  'smtp.host': 'Enter the outgoing (SMTP) server, like smtp.example.com, or turn off sending.',
  'smtp.port': 'Enter the outgoing server port (usually 465 or 587).',
  'smtp.security': 'Choose TLS or STARTTLS for the outgoing server.',
  to: 'Enter a valid recipient email address.',
  subject: 'The subject is too long or contains a line break.',
  text: 'Write a message before sending (up to 50,000 characters).',
  inReplyTo: 'The message being replied to is invalid.',
};

/** Turns a validation failure into short sentences a person can act on. */
export function describeValidationError(error: z.ZodError): string {
  const messages = new Set<string>();
  for (const issue of error.issues) {
    const field = issue.path.filter((part) => typeof part === 'string').join('.');
    messages.add(fieldMessages[field] ?? 'Some details are missing or invalid.');
  }
  return [...messages].join(' ');
}
