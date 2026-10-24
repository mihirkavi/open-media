import { BridgedNetwork } from './models';

/**
 * Every chat network Open Media can bridge (ADR 0011), with the guidance the
 * connect screen shows. The bridge supplies the sign-in steps themselves; these
 * notes tell a person where to find things in that network's own app.
 */
export interface ChatNetwork {
  id: BridgedNetwork;
  name: string;
  /** How likely the network is to restrict accounts that use a bridge. */
  risk: 'low' | 'medium' | 'high';
  /** Where to scan a QR code from. */
  qr?: string;
  /** Where to type a pairing code. */
  code?: string;
  /** What to do when the bridge shows an emoji to confirm on the phone. */
  emoji?: string;
  /** Advice shown above typed sign-in fields. */
  input?: string;
  /** Advice shown with copied browser values (cookies, headers). */
  cookies?: string;
  /** Where the person can also remove Open Media later. */
  linkedDevices?: string;
  /** Why the network isn't offered when this server doesn't run its bridge. */
  setup?: string;
}

export const chatNetworks: ChatNetwork[] = [
  {
    id: 'whatsapp', name: 'WhatsApp', risk: 'medium',
    qr: 'On your phone, open WhatsApp → Settings → Linked devices → Link a device, then point the camera at this code.',
    code: 'Open WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead, then type this code.',
    linkedDevices: 'WhatsApp → Settings → Linked devices',
  },
  {
    id: 'signal', name: 'Signal', risk: 'low',
    qr: 'On your phone, open Signal → Settings → Linked devices → Link new device, then point the camera at this code.',
    linkedDevices: 'Signal → Settings → Linked devices',
  },
  {
    id: 'telegram', name: 'Telegram', risk: 'low',
    qr: 'On your phone, open Telegram → Settings → Devices → Link Desktop Device, then point the camera at this code.',
    input: 'Use the phone number on your Telegram account. Telegram sends the login code to your other Telegram apps, not by SMS.',
    linkedDevices: 'Telegram → Settings → Devices',
    setup: 'Needs Open Media’s own Telegram app ID from my.telegram.org before it can run.',
  },
  {
    id: 'gmessages', name: 'Google Messages', risk: 'low',
    qr: 'On your Android phone, open Google Messages → your profile picture → Device pairing → QR code scanner, then point the camera at this code.',
    cookies: 'Sign in with the Google account your phone uses for Google Messages, then copy the Google cookies it asks for. Afterwards your phone asks you to confirm an emoji.',
    emoji: 'Google Messages on your phone now shows a few emoji. Tap the one that matches this one.',
    linkedDevices: 'Google Messages → Device pairing',
  },
  {
    id: 'gvoice', name: 'Google Voice', risk: 'medium',
    cookies: 'Sign in to voice.google.com, then copy the Google cookies it asks for.',
  },
  {
    id: 'instagram', name: 'Instagram', risk: 'high',
    cookies: 'Sign in to instagram.com, then copy the cookies it asks for.',
    input: 'Use your Instagram username and password. If Instagram asks for a code, it arrives the same way it usually does.',
  },
  {
    id: 'messenger', name: 'Messenger', risk: 'high',
    cookies: 'Sign in to facebook.com or messenger.com, then copy the cookies it asks for.',
    input: 'Use your Facebook email or phone number and password.',
  },
  {
    id: 'linkedin', name: 'LinkedIn', risk: 'high',
    cookies: 'Sign in to linkedin.com, open Messaging once, then copy the cookies and headers it asks for.',
  },
  {
    id: 'twitter', name: 'X', risk: 'high',
    cookies: 'Sign in to x.com, then copy the cookies it asks for.',
    input: 'Use your X username and password.',
  },
  {
    id: 'bluesky', name: 'Bluesky', risk: 'low',
    input: 'Use an app password (Bluesky → Settings → Privacy and security → App passwords) and allow direct messages, rather than your main password.',
  },
  {
    id: 'slack', name: 'Slack', risk: 'medium',
    cookies: 'Sign in to your workspace at app.slack.com, then copy the token and cookie it asks for. Your workspace’s rules may not allow this.',
    input: 'Use the email and password for your Slack workspace.',
  },
  {
    id: 'discord', name: 'Discord', risk: 'high',
    cookies: 'Sign in at discord.com/app, then copy the Authorization header of any request to discord.com. Discord’s terms don’t allow automating personal accounts, so it may lock this account.',
  },
];

/** Networks no bridge can reach; listed so the inbox is honest about what's missing. */
export const unreachableChatNetworks = [
  { name: 'iMessage', reason: 'Needs a Mac relay for each person; not supported.' },
  { name: 'Snapchat', reason: 'No working bridge exists.' },
  { name: 'TikTok', reason: 'No working bridge exists.' },
  { name: 'Google Chat', reason: 'Its bridge is no longer maintained.' },
];

export function chatNetwork(id: string): ChatNetwork | undefined {
  return chatNetworks.find((network) => network.id === id);
}
