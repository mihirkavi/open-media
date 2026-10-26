/**
 * New ONDC key pairs (ADR 0015). Prints the commands that store the private keys as Worker
 * secrets and the public keys for the registry. Nothing is written to disk; run it in a private
 * terminal and do not paste the private keys anywhere else.
 */
import { randomUUID } from 'node:crypto';

import { generateOndcKeys } from '../src/ondc/crypto.js';

const keys = generateOndcKeys();
const uniqueKeyId = randomUUID();
const requestId = randomUUID();
console.log(`# Public: give these to the ONDC registry (npm run ondc:subscribe prints the whole request).
ONDC_UNIQUE_KEY_ID=${uniqueKeyId}
signing_public_key=${keys.signingPublic}
encryption_public_key=${keys.encryptionPublic}

# Private: store each as a Worker secret (wrangler asks for the value; paste it there only).
#   ONDC_SIGNING_PRIVATE_KEY    = ${keys.signingPrivate}
#   ONDC_ENCRYPTION_PRIVATE_KEY = ${keys.encryptionPrivate}
npx wrangler secret put ONDC_SIGNING_PRIVATE_KEY
npx wrangler secret put ONDC_ENCRYPTION_PRIVATE_KEY
npx wrangler secret put ONDC_UNIQUE_KEY_ID        # ${uniqueKeyId}
npx wrangler secret put ONDC_REQUEST_ID           # ${requestId}
npx wrangler secret put ONDC_SUBSCRIBER_ID        # your API domain, e.g. api.example.in
npx wrangler secret put ONDC_ENVIRONMENT          # preprod first, then prod`);
