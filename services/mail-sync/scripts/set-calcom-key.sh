#!/usr/bin/env bash
# Store the Cal.com API key as a Worker secret, but only after Cal.com accepts it.
# The key is read with a hidden prompt and is never printed or written to disk.
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -s -p "Paste your Cal.com API key (starts with cal_), then press Enter: " KEY || true  # tolerate input without a trailing newline
echo
KEY="$(printf %s "$KEY" | tr -d '[:space:]')"
if [[ "$KEY" != cal_* ]]; then
  echo "That is not a Cal.com key (it should start with cal_; you pasted ${#KEY} characters). Nothing was stored."
  exit 1
fi
STATUS="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" https://api.cal.com/v2/calendars)"
if [[ "$STATUS" != 200 ]]; then
  echo "Cal.com rejected this key (HTTP $STATUS). Create a new key in Cal.com → Settings → Developer → API Keys. Nothing was stored."
  exit 1
fi
printf %s "$KEY" | npx wrangler secret put CALCOM_API_KEY
unset KEY
echo "Stored. Cal.com accepted the key."
