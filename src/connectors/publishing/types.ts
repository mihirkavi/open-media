import { CrossPostContent } from '../../domain/crossPosting';
import { NetworkId } from '../../domain/networkPosts';

/** The account a person connected for cross-posting. Contains no secrets. */
export interface NetworkAccount {
  network: NetworkId;
  /** Shown as “Connected as …”. */
  handle: string;
  profileURL?: string;
}

/**
 * Whether this build and device can publish to a network at all. `owner` means Open Media’s operator
 * still has to configure something once (for example an app identity); `device` means this platform
 * lacks something the network needs (for example a wallet in this browser).
 */
export type PublishAvailability =
  | { available: true }
  | { available: false; setup: 'owner' | 'device'; reason: string };

export interface PublishedCopy { externalId: string; url?: string }

/** A step the person completes outside Open Media, such as approving in the Farcaster app. */
export interface ApprovalPrompt {
  title: string;
  message: string;
  /** Opens the approval on this device (a deep link or web page). */
  url: string;
  /** SVG data URI of a QR code for approving on another device (phone camera). */
  qrCode?: string;
}

export interface ConnectContext {
  /** Shows (or, with `undefined`, clears) an approval step while the connector waits for it. */
  showApproval(prompt: ApprovalPrompt | undefined): void;
  signal: AbortSignal;
}

/**
 * Delegated, revocable publishing for one network. Open Media never asks for a seed phrase or a
 * network’s main private key: each connector uses the network’s own delegation (an app key,
 * derived key, or signer the person approves on that network) and keeps it on this device.
 */
export interface PublishingConnector {
  id: NetworkId;
  availability(): Promise<PublishAvailability>;
  /** The connected account on this device, if any. */
  account(): Promise<NetworkAccount | undefined>;
  /** Interactive: sends the person to the network (or their wallet) to approve Open Media. */
  connect(context: ConnectContext): Promise<NetworkAccount>;
  /** Forgets this device’s delegated key. `revokeHint` says how to revoke it on the network too. */
  disconnect(): Promise<void>;
  revokeHint: string;
  publish(content: CrossPostContent, idempotencyKey: string): Promise<PublishedCopy>;
}

/** Errors whose message is safe and useful to show people as-is. */
export class PublishingError extends Error {}
