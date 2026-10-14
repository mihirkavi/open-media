/**
 * Call one Open Media Events tool from the terminal.
 *   EVENTS_BASE_URL=… EVENTS_OWNER_CODE=… npx tsx scripts/events-call.ts <tool> '<json arguments>'
 */
import { base, call, token } from './events-client.js';

const [tool, rawArgs = '{}'] = process.argv.slice(2);
if (!tool) throw new Error('Usage: events-call.ts <tool> [json-arguments]');
const accessToken = await token(`${base}/mcp`);
console.log(JSON.stringify(await call(accessToken, tool, JSON.parse(rawArgs)), null, 2));
