import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { listMailAccounts, syncMailAccount } from "../connectors/mailApiConnector";
import { nextMailPoll } from "../domain/liveMail";

/**
 * Keeps email live while the app is open, like a chat: each mailbox has one waiting sync that
 * the service answers the moment new mail arrives. It stops in the background and catches up
 * when the app comes back. `accountsVersion` restarts it after a mailbox is added or removed.
 */
export function useLiveMail(enabled: boolean, accountsVersion: number, onNewMail: () => void) {
  const onNewMailRef = useRef(onNewMail);
  onNewMailRef.current = onNewMail;
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | undefined;
    const follow = async (accountId: string, signal: AbortSignal) => {
      let failures = 0;
      while (!signal.aborted) {
        const started = Date.now();
        let newMessages = 0;
        try {
          newMessages = (await syncMailAccount(accountId, { wait: true, signal })).length;
          failures = 0;
          if (newMessages) onNewMailRef.current();
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
        .catch(() => undefined);
    };
    const stop = () => {
      controller?.abort();
      controller = undefined;
    };
    if (AppState.currentState !== "background") start();
    const subscription = AppState.addEventListener("change", (state) => (state === "active" ? start() : state === "background" ? stop() : undefined));
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
