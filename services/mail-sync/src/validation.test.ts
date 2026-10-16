import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { describeValidationError } from './validation.js';

test('describes missing mailbox fields in plain language', () => {
  const schema = z.object({ host: z.string().min(1), smtp: z.object({ host: z.string().min(1) }) });
  const result = schema.safeParse({ host: '', smtp: { host: '' } });
  assert.equal(result.success, false);
  const message = describeValidationError(result.error!);
  assert.match(message, /incoming mail server/);
  assert.match(message, /outgoing \(SMTP\) server/);
  assert.doesNotMatch(message, /too_small|regex|\[/);
});
