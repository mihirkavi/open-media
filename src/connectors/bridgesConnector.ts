import { BridgeSnapshot, mapBridgeSnapshot } from '../domain/bridgedChats';
import { Conversation } from '../domain/models';
import { request } from './mailApiConnector';

/**
 * Bridged chats (ADR 0011): WhatsApp and other networks reached through
 * Open Media's chat bridges. The Open Media service does the bridging; the app
 * only talks to it with the signed-in person's session.
 */

export interface BridgeNetworkStatus {
  id: string;
  name: string;
  available: boolean;
  logins: { id: string; name: string; state: string }[];
}

export interface BridgeLoginStep {
  loginId: string;
  type: 'display_and_wait' | 'user_input' | 'complete' | 'unsupported';
  stepId: string;
  instructions?: string;
  display?: { type: 'qr' | 'code' | 'emoji' | 'nothing'; data?: string };
  fields?: { id: string; name: string; description?: string; type: string }[];
}

export async function loadBridgeStatus(): Promise<BridgeNetworkStatus[]> {
  return (await request<{ networks: BridgeNetworkStatus[] }>('/v1/bridges', {}, 'Could not load chat networks.')).networks;
}

export function startBridgeLogin(network: string, flow: 'qr' | 'phone'): Promise<BridgeLoginStep> {
  return request(`/v1/bridges/${network}/login/start`, { method: 'POST', body: { flow } }, 'Could not start connecting.');
}

/** Waits for the next step: a refreshed QR code, a pairing code, or completion. */
export function continueBridgeLogin(network: string, step: BridgeLoginStep, values?: Record<string, string>): Promise<BridgeLoginStep> {
  return request(`/v1/bridges/${network}/login/step`, { method: 'POST', body: { loginId: step.loginId, stepId: step.stepId, type: step.type, values } }, 'The connection didn’t finish. Try again.');
}

export async function cancelBridgeLogin(network: string, loginId: string): Promise<void> {
  await request(`/v1/bridges/${network}/login/cancel`, { method: 'POST', body: { loginId } }, 'Could not cancel.').catch(() => undefined);
}

export async function disconnectBridge(network: string, loginId: string): Promise<void> {
  await request(`/v1/bridges/${network}/logout`, { method: 'POST', body: { loginId } }, 'Could not disconnect.');
}

export async function loadBridgedConversations(): Promise<Conversation[]> {
  return mapBridgeSnapshot(await request<BridgeSnapshot>('/v1/bridges/conversations', {}, 'Could not load bridged chats.'));
}

export async function sendBridgedMessage(conversationId: string, body: string): Promise<void> {
  await request(`/v1/bridges/rooms/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: { body } }, 'The message wasn’t sent.');
}


export { bridgedSourceOf, mapBridgeSnapshot } from '../domain/bridgedChats';
