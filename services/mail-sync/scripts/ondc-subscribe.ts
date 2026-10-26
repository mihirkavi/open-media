/**
 * Prints the ONDC registry /subscribe request for Open Media as a marketplace seller app
 * (ops_no 2, ADR 0015). It reads the same values the Worker uses, plus the business details the
 * registry asks for, from environment variables, and marks anything missing as "<fill in: …>".
 * It prints only; submit the request yourself (pre-production first) once the Worker serves
 * /ondc-site-verification.html and /ondc/on_subscribe on that domain.
 *
 *   ONDC_SUBSCRIBER_ID, ONDC_UNIQUE_KEY_ID, ONDC_REQUEST_ID, ONDC_SIGNING_PRIVATE_KEY, ONDC_ENCRYPTION_PRIVATE_KEY
 *   ONDC_CITY_CODES (comma-separated, default std:080), ONDC_LEGAL_NAME, ONDC_BUSINESS_ADDRESS, ONDC_GST_NO,
 *   ONDC_PAN_NAME, ONDC_PAN_NO, ONDC_INCORPORATED (DD/MM/YYYY), ONDC_SIGNATORY, ONDC_SIGNATORY_ADDRESS, ONDC_EMAIL, ONDC_MOBILE
 */
import { ondcCategories } from '../../../src/domain/ondc';
import { encryptionPublicKey, signingPublicKey } from '../src/ondc/crypto.js';

const value = (name: string, what: string) => process.env[name]?.trim() || `<fill in: ${what}>`;
const signing = process.env.ONDC_SIGNING_PRIVATE_KEY ? signingPublicKey(process.env.ONDC_SIGNING_PRIVATE_KEY) : '<fill in: run npm run ondc:keys>';
const encryption = process.env.ONDC_ENCRYPTION_PRIVATE_KEY ? encryptionPublicKey(process.env.ONDC_ENCRYPTION_PRIVATE_KEY) : '<fill in: run npm run ondc:keys>';
const cities = (process.env.ONDC_CITY_CODES ?? 'std:080').split(',').map((code: string) => code.trim()).filter(Boolean);
const now = new Date();
const validUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

console.log(JSON.stringify({
  context: { operation: { ops_no: 2 } },
  message: {
    request_id: value('ONDC_REQUEST_ID', 'the request_id you stored as ONDC_REQUEST_ID'),
    timestamp: now.toISOString(),
    entity: {
      gst: { legal_entity_name: value('ONDC_LEGAL_NAME', 'legal entity name'), business_address: value('ONDC_BUSINESS_ADDRESS', 'registered business address'), city_code: cities, gst_no: value('ONDC_GST_NO', 'GSTIN') },
      pan: { name_as_per_pan: value('ONDC_PAN_NAME', 'name as per PAN'), pan_no: value('ONDC_PAN_NO', 'PAN'), date_of_incorporation: value('ONDC_INCORPORATED', 'DD/MM/YYYY') },
      name_of_authorised_signatory: value('ONDC_SIGNATORY', 'authorised signatory'),
      'address_of_authorised Signatory': value('ONDC_SIGNATORY_ADDRESS', 'signatory address'),
      email_id: value('ONDC_EMAIL', 'contact email'),
      mobile_no: value('ONDC_MOBILE', 'ten-digit mobile number'),
      country: 'IND',
      subscriber_id: value('ONDC_SUBSCRIBER_ID', 'your API domain, e.g. api.example.in'),
      unique_key_id: value('ONDC_UNIQUE_KEY_ID', 'from npm run ondc:keys'),
      callback_url: '/ondc',
      key_pair: { signing_public_key: signing, encryption_public_key: encryption, valid_from: now.toISOString(), valid_until: validUntil.toISOString() },
    },
    network_participant: Object.keys(ondcCategories).map((domain) => ({ subscriber_url: '/ondc', domain, type: 'sellerApp', msn: true, city_code: cities })),
  },
}, null, 2));
