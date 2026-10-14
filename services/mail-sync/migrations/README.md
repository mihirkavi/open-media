# D1 migrations

Schema for the `open-media-events` D1 database (binding `EVENTS_DB`). Name files `NNNN_description.sql`. Apply them with `npx wrangler d1 migrations apply open-media-events --local` (or `--remote`). Never edit a migration that has already been applied; add a new one. Supabase migrations for the app live in `supabase/migrations`.
