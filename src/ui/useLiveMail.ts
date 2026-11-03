import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { followMailAccount, listMailAccounts } from "../connectors/mailApiConnector";
import { nextMailPoll } from "../domain/liveMail";

/**
 * Keeps email live while the app is open, like a chat: each mailbox has one waiting sync that
 * the service answers the moment new mail arrives (ADR 0025). Each answer carries a cursor that
 * makes the next wait cheap. On a phone it stops in the background, where the system would
 * suspend it anyway, and catches up when the app comes back; a web tab keeps following mail when
 * it is hidden, like any mail client. `accountsVersion` restarts it after a mailbox is added or removed.
 */
export function useLiveMail(enabled: boolean, accountsVersion: number, onNewMail: () => void) {
  const onNewMailRef = useRef(onNewMail);
  onNewMailRef.current = onNewMail;
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | undefined;
    const follow = async (accountId: string, signal: AbortSignal) => {
      let failures = 0;
      let cursor: string | undefined;
      while (!signal.aborted) {
        const started = Date.now();
        let newMessages = 0;
        try {
          const answer = await followMailAccount(accountId, { cursor, signal });
          cursor = answer.cursor;
          newMessages = answer.messages.length;
          failures = 0;
          // New mail, or mail read or marked unread in another app: show the stored mail again.
          if (newMessages || answer.readChanged) onNewMailRef.current();
        } catch {
          if (signal.aborted) return;
          failures += 1;
        }
        await pause(nextMailPoll({ elapsedMs: Date.now() - started, newMessages, failures }), signal);
      }
    };
    const start = () => {
      if (controller) return;
      const current = new AbortController();
      controller = current;
      listMailAccounts()
        .then((accounts) => accounts.forEach((account) => follow(account.id, current.signal)))
        .catch(() => {
          // Try again on the next return to the app.
          if (controller === current) controller = undefined;
        });
    };
    const stop = () => {
      controller?.abort();
      controller = undefined;
    };
    const followsInBackground = Platform.OS === "web";
    if (followsInBackground || AppState.currentState !== "background") start();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else if (state === "background" && !followsInBackground) stop();
    });
    return () => {
      subscription.remove();
      stop();
    };
  }, [enabled, accountsVersion]);
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
