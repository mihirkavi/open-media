import { Platform } from 'react-native';

import { apiConfigured, getAPIURL } from '../connectors/mailApiConnector';
import { webMcpRequestUrl, webMcpTools } from '../domain/webMcpTools';

interface ModelContext { registerTool(tool: object, options?: { signal?: AbortSignal }): Promise<void> | void }

/**
 * Registers Open Media's read-only WebMCP tools in the web app, so an agent in the person's browser
 * can search and read without driving the interface. Returns a function that unregisters them.
 * Does nothing on iOS and Android, or in browsers without WebMCP.
 */
export function registerWebMcpTools(): () => void {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || !apiConfigured()) return () => undefined;
  const context = (document as unknown as { modelContext?: ModelContext }).modelContext
    ?? (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  if (!context || typeof context.registerTool !== 'function') return () => undefined;
  const controller = new AbortController();
  const origin = getAPIURL();
  for (const tool of webMcpTools) {
    try {
      const done = context.registerTool({
        name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (input: Record<string, unknown> = {}, options?: { signal?: AbortSignal }) => {
          const response = await fetch(webMcpRequestUrl(origin, tool, input), { headers: { accept: 'application/json' }, signal: options?.signal });
          return response.text();
        },
      }, { signal: controller.signal });
      if (done && typeof (done as Promise<void>).catch === 'function') (done as Promise<void>).catch(() => undefined);
    } catch {
      // A browser with an older WebMCP build may refuse a tool; the app works the same without it.
    }
  }
  return () => controller.abort();
}
