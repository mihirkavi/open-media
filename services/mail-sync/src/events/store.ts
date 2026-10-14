import type {
  CanonicalEvent,
  EventPlan,
  ExplicitPreferences,
  LearnedSignal,
  PlanState,
  Registration,
  RegistrationStatus,
  Verification,
} from './types.js';

/** Defaults are deliberately generic; each person sets their own through the preference tools. */
export const DEFAULT_PREFERENCES: ExplicitPreferences = {
  homeArea: 'south_bay',
  preferredAreas: [],
  timezone: 'America/Los_Angeles',
  maxTravelMinutes: 45,
  travelMode: 'driving',
  preferredDayparts: ['evening'],
  interests: [],
  goals: [],
  avoid: [],
  formatsPreferred: [],
  formatsAvoided: [],
  preferRecurringCommunities: true,
  favorMeaningfulConversation: true,
  explorationShare: 0.2,
  suggestionsPerSearch: 5,
  autoHoldOnSave: false,
};

interface EventRow {
  id: string;
  record_json: string;
}

interface PlanRow {
  id: string;
  user_id: string;
  event_id: string;
  state: PlanState;
  notes: string | null;
  hold_start: string | null;
  hold_end: string | null;
  travel_before_minutes: number;
  travel_after_minutes: number;
  calendar_sequence: number;
  created_at: string;
  updated_at: string;
}

interface RegistrationRow {
  id: string;
  user_id: string;
  event_id: string;
  status: RegistrationStatus;
  method: Registration['method'];
  verification: Verification;
  provider: string | null;
  provider_reference: string | null;
  updated_at: string;
}

/** D1-backed persistence. Every user-owned query is scoped by the authenticated user id. */
export class EventStore {
  constructor(private readonly db: D1Database) {}

  // ----- Users and preferences -----

  async ensureUser(userId: string): Promise<void> {
    await this.db.prepare('INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)').bind(userId, now()).run();
  }

  async getPreferences(userId: string): Promise<ExplicitPreferences> {
    const row = await this.db.prepare('SELECT explicit_json FROM user_preferences WHERE user_id = ?').bind(userId).first<{ explicit_json: string }>();
    return { ...DEFAULT_PREFERENCES, ...(row ? JSON.parse(row.explicit_json) as Partial<ExplicitPreferences> : {}) };
  }

  async savePreferences(userId: string, preferences: ExplicitPreferences): Promise<void> {
    await this.db
      .prepare('INSERT INTO user_preferences (user_id, explicit_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET explicit_json = excluded.explicit_json, updated_at = excluded.updated_at')
      .bind(userId, JSON.stringify(preferences), now())
      .run();
  }

  async learnedSignals(userId: string): Promise<LearnedSignal[]> {
    const { results } = await this.db.prepare('SELECT signal, observations, positive, user_confirmed, updated_at FROM learned_signals WHERE user_id = ? ORDER BY observations DESC LIMIT 200').bind(userId).all<{ signal: string; observations: number; positive: number; user_confirmed: number; updated_at: string }>();
    return results.map((row) => ({
      signal: row.signal,
      observations: row.observations,
      positive: row.positive,
      // Confidence grows with evidence; three observations give 0.5.
      confidence: Math.round((row.observations / (row.observations + 3)) * 100) / 100,
      userConfirmed: row.user_confirmed === 1,
      updatedAt: row.updated_at,
    }));
  }

  async recordSignals(userId: string, signals: string[], positive: boolean): Promise<void> {
    if (!signals.length) return;
    const statement = this.db.prepare(
      'INSERT INTO learned_signals (user_id, signal, observations, positive, updated_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT(user_id, signal) DO UPDATE SET observations = observations + 1, positive = positive + excluded.positive, updated_at = excluded.updated_at',
    );
    await this.db.batch(signals.map((signal) => statement.bind(userId, signal, positive ? 1 : 0, now())));
  }

  // ----- Canonical events -----

  async findEventIdsBySource(keys: Array<{ provider: string; providerEventId: string }>): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (let index = 0; index < keys.length; index += 40) {
      const chunk = keys.slice(index, index + 40);
      const where = chunk.map(() => '(provider = ? AND provider_event_id = ?)').join(' OR ');
      const { results } = await this.db
        .prepare(`SELECT provider, provider_event_id, event_id FROM event_sources WHERE ${where}`)
        .bind(...chunk.flatMap((key) => [key.provider, key.providerEventId]))
        .all<{ provider: string; provider_event_id: string; event_id: string }>();
      for (const row of results) result.set(`${row.provider}|${row.provider_event_id}`, row.event_id);
    }
    return result;
  }

  async getEvents(ids: string[]): Promise<Map<string, CanonicalEvent>> {
    const result = new Map<string, CanonicalEvent>();
    const unique = [...new Set(ids)];
    for (let index = 0; index < unique.length; index += 80) {
      const chunk = unique.slice(index, index + 80);
      const { results } = await this.db
        .prepare(`SELECT id, record_json FROM events WHERE id IN (${chunk.map(() => '?').join(',')})`)
        .bind(...chunk)
        .all<EventRow>();
      for (const row of results) result.set(row.id, JSON.parse(row.record_json) as CanonicalEvent);
    }
    return result;
  }

  async getEvent(id: string): Promise<CanonicalEvent | undefined> {
    return (await this.getEvents([id])).get(id);
  }

  /** Inserts or updates events and their sources, recording meaningful changes. */
  async upsertEvents(events: CanonicalEvent[], previous: Map<string, CanonicalEvent>): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    const timestamp = now();
    for (const event of events) {
      const before = previous.get(event.id);
      statements.push(
        this.db
          .prepare(`INSERT INTO events (id, title, description, starts_at, ends_at, date_only, timezone, status, attendance_mode, city, latitude, longitude, record_json, first_seen_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
              date_only = excluded.date_only, timezone = excluded.timezone, status = excluded.status, attendance_mode = excluded.attendance_mode, city = excluded.city,
              latitude = excluded.latitude, longitude = excluded.longitude, record_json = excluded.record_json, updated_at = excluded.updated_at`)
          .bind(
            event.id, event.title, event.description ?? null, event.startsAt, event.endsAt ?? null, event.dateOnly ? 1 : 0, event.timezone ?? null,
            event.status, event.attendanceMode, event.venue?.city ?? null, event.venue?.latitude ?? null, event.venue?.longitude ?? null,
            JSON.stringify(event), timestamp, timestamp,
          ),
      );
      for (const source of event.sources) {
        statements.push(
          this.db
            .prepare('INSERT INTO event_sources (provider, provider_event_id, event_id, url, retrieved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(provider, provider_event_id) DO UPDATE SET url = excluded.url, retrieved_at = excluded.retrieved_at')
            .bind(source.provider, source.providerEventId, event.id, source.url, source.retrievedAt),
        );
      }
      if (before) {
        for (const change of detectChanges(before, event)) {
          statements.push(
            this.db.prepare('INSERT INTO event_changes (event_id, field, old_value, new_value, detected_at) VALUES (?, ?, ?, ?, ?)').bind(event.id, change.field, change.from, change.to, timestamp),
          );
        }
      }
    }
    for (let index = 0; index < statements.length; index += 90) await this.db.batch(statements.slice(index, index + 90));
  }

  async recentChanges(eventIds: string[], since: string): Promise<Array<{ eventId: string; field: string; from: string | null; to: string | null; detectedAt: string }>> {
    const results = await this.inChunks<{ event_id: string; field: string; old_value: string | null; new_value: string | null; detected_at: string }>(
      eventIds,
      (marks) => `SELECT event_id, field, old_value, new_value, detected_at FROM event_changes WHERE detected_at >= ? AND event_id IN (${marks})`,
      [since],
    );
    results.sort((a, b) => b.detected_at.localeCompare(a.detected_at));
    return results.slice(0, 100).map((row) => ({ eventId: row.event_id, field: row.field, from: row.old_value, to: row.new_value, detectedAt: row.detected_at }));
  }

  // ----- Provider cache and health -----

  /** Returns a cached provider response, or loads and caches it. `fresh` skips the read but still refreshes the cache. */
  async cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>, fresh = false): Promise<T> {
    const row = fresh ? null : await this.db.prepare('SELECT payload, expires_at FROM provider_cache WHERE cache_key = ?').bind(key).first<{ payload: string; expires_at: number }>();
    if (row && row.expires_at > Date.now()) return JSON.parse(row.payload) as T;
    const value = await load();
    await this.db
      .prepare('INSERT INTO provider_cache (cache_key, payload, expires_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at')
      .bind(key, JSON.stringify(value), Date.now() + ttlSeconds * 1000)
      .run();
    return value;
  }

  async pruneCache(): Promise<void> {
    await this.db.prepare('DELETE FROM provider_cache WHERE expires_at < ?').bind(Date.now()).run();
  }

  async recordProviderHealth(provider: string, error?: string): Promise<void> {
    const timestamp = now();
    if (error) {
      await this.db
        .prepare('INSERT INTO provider_health (provider, last_error_at, last_error, consecutive_failures) VALUES (?, ?, ?, 1) ON CONFLICT(provider) DO UPDATE SET last_error_at = excluded.last_error_at, last_error = excluded.last_error, consecutive_failures = consecutive_failures + 1')
        .bind(provider, timestamp, error.slice(0, 300))
        .run();
    } else {
      await this.db
        .prepare('INSERT INTO provider_health (provider, last_ok_at, consecutive_failures) VALUES (?, ?, 0) ON CONFLICT(provider) DO UPDATE SET last_ok_at = excluded.last_ok_at, consecutive_failures = 0')
        .bind(provider, timestamp)
        .run();
    }
  }

  async providerHealth(): Promise<Map<string, { lastOkAt: string | null; lastErrorAt: string | null; lastError: string | null; consecutiveFailures: number }>> {
    const { results } = await this.db.prepare('SELECT provider, last_ok_at, last_error_at, last_error, consecutive_failures FROM provider_health').all<{ provider: string; last_ok_at: string | null; last_error_at: string | null; last_error: string | null; consecutive_failures: number }>();
    return new Map(results.map((row) => [row.provider, { lastOkAt: row.last_ok_at, lastErrorAt: row.last_error_at, lastError: row.last_error, consecutiveFailures: row.consecutive_failures }]));
  }

  // ----- Plans -----

  async getPlan(userId: string, eventId: string): Promise<EventPlan | undefined> {
    const row = await this.db.prepare('SELECT * FROM event_plans WHERE user_id = ? AND event_id = ?').bind(userId, eventId).first<PlanRow>();
    return row ? planFromRow(row) : undefined;
  }

  async listPlans(userId: string, states?: PlanState[]): Promise<EventPlan[]> {
    const filter = states?.length ? ` AND state IN (${states.map(() => '?').join(',')})` : '';
    const { results } = await this.db.prepare(`SELECT * FROM event_plans WHERE user_id = ?${filter} ORDER BY updated_at DESC LIMIT 500`).bind(userId, ...(states ?? [])).all<PlanRow>();
    return results.map(planFromRow);
  }

  /** Active plans across all users, for scheduled refresh. */
  async listAllActivePlans(limit: number): Promise<EventPlan[]> {
    const { results } = await this.db
      .prepare("SELECT p.* FROM event_plans p JOIN events e ON e.id = p.event_id WHERE p.state IN ('interested','held','registration_pending','registered','waitlisted') AND e.starts_at >= ? ORDER BY e.starts_at ASC LIMIT ?")
      .bind(new Date(Date.now() - 86_400_000).toISOString(), limit)
      .all<PlanRow>();
    return results.map(planFromRow);
  }

  async plansByEvent(userId: string, eventIds: string[]): Promise<Map<string, EventPlan>> {
    const rows = await this.inChunks<PlanRow>(eventIds, (marks) => `SELECT * FROM event_plans WHERE user_id = ? AND event_id IN (${marks})`, [userId]);
    return new Map(rows.map((row) => [row.event_id, planFromRow(row)]));
  }

  /** Runs an `IN (…)` query in chunks; D1 allows at most 100 bound parameters per statement. */
  private async inChunks<T>(values: string[], sql: (marks: string) => string, prefix: unknown[] = [], suffix = ''): Promise<T[]> {
    const unique = [...new Set(values)];
    const rows: T[] = [];
    for (let index = 0; index < unique.length; index += 80) {
      const chunk = unique.slice(index, index + 80);
      const { results } = await this.db.prepare(sql(chunk.map(() => '?').join(',')) + suffix).bind(...prefix, ...chunk).all<T>();
      rows.push(...results);
    }
    return rows;
  }

  async savePlan(plan: EventPlan, fromState: PlanState | undefined, reason: string): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(`INSERT INTO event_plans (id, user_id, event_id, state, notes, hold_start, hold_end, travel_before_minutes, travel_after_minutes, calendar_sequence, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, event_id) DO UPDATE SET state = excluded.state, notes = excluded.notes, hold_start = excluded.hold_start, hold_end = excluded.hold_end,
            travel_before_minutes = excluded.travel_before_minutes, travel_after_minutes = excluded.travel_after_minutes, calendar_sequence = excluded.calendar_sequence, updated_at = excluded.updated_at`)
        .bind(plan.id, plan.userId, plan.eventId, plan.state, plan.notes ?? null, plan.holdStart ?? null, plan.holdEnd ?? null, plan.travelBeforeMinutes, plan.travelAfterMinutes, plan.calendarSequence, plan.createdAt, plan.updatedAt),
      this.db
        .prepare('INSERT INTO plan_history (plan_id, user_id, from_state, to_state, reason, at) SELECT id, ?, ?, ?, ?, ? FROM event_plans WHERE user_id = ? AND event_id = ?')
        .bind(plan.userId, fromState ?? null, plan.state, reason, plan.updatedAt, plan.userId, plan.eventId),
    ]);
  }

  // ----- Registrations -----

  async getRegistration(userId: string, eventId: string): Promise<Registration | undefined> {
    const row = await this.db.prepare('SELECT * FROM registrations WHERE user_id = ? AND event_id = ? ORDER BY updated_at DESC LIMIT 1').bind(userId, eventId).first<RegistrationRow>();
    return row ? registrationFromRow(row) : undefined;
  }

  async registrationsByEvent(userId: string, eventIds: string[]): Promise<Map<string, Registration>> {
    const rows = await this.inChunks<RegistrationRow>(eventIds, (marks) => `SELECT * FROM registrations WHERE user_id = ? AND event_id IN (${marks})`, [userId]);
    rows.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    return new Map(rows.map((row) => [row.event_id, registrationFromRow(row)]));
  }

  /** One registration record per user, event and method; repeated calls update it instead of duplicating. */
  async upsertRegistration(registration: Omit<Registration, 'id' | 'updatedAt'>): Promise<Registration> {
    const key = `${registration.userId}|${registration.eventId}|${registration.method}`;
    const timestamp = now();
    const id = `reg_${await shortHash(key)}`;
    await this.db
      .prepare(`INSERT INTO registrations (id, user_id, event_id, status, method, verification, provider, provider_reference, idempotency_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO UPDATE SET status = excluded.status, verification = excluded.verification, provider = excluded.provider,
          provider_reference = COALESCE(excluded.provider_reference, registrations.provider_reference), updated_at = excluded.updated_at`)
      .bind(id, registration.userId, registration.eventId, registration.status, registration.method, registration.verification, registration.provider ?? null, registration.providerReference ?? null, key, timestamp, timestamp)
      .run();
    return { ...registration, id, updatedAt: timestamp };
  }

  // ----- Interactions and feedback -----

  async recordInteractions(userId: string, eventIds: string[], kind: string): Promise<void> {
    if (!eventIds.length) return;
    const statement = this.db.prepare('INSERT INTO event_interactions (user_id, event_id, kind, at) VALUES (?, ?, ?, ?)');
    const timestamp = now();
    await this.db.batch(eventIds.map((eventId) => statement.bind(userId, eventId, kind, timestamp)));
  }

  async seenEventIds(userId: string, sinceDays = 21): Promise<Set<string>> {
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
    const { results } = await this.db.prepare("SELECT DISTINCT event_id FROM event_interactions WHERE user_id = ? AND kind = 'shown' AND at >= ?").bind(userId, since).all<{ event_id: string }>();
    return new Set(results.map((row) => row.event_id));
  }

  async saveFeedback(input: { userId: string; eventId: string; rating?: number; attended?: boolean; wouldReturn?: boolean; reasons: string[]; note?: string }): Promise<string> {
    const id = `fb_${crypto.randomUUID()}`;
    await this.db
      .prepare('INSERT INTO event_feedback (id, user_id, event_id, rating, attended, would_return, reasons_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, input.userId, input.eventId, input.rating ?? null, input.attended === undefined ? null : input.attended ? 1 : 0, input.wouldReturn === undefined ? null : input.wouldReturn ? 1 : 0, JSON.stringify(input.reasons), input.note ?? null, now())
      .run();
    return id;
  }

  // ----- User sources -----

  async listSources(userId: string): Promise<Array<{ id: string; url: string; label: string; provider: string; lastStatus: string | null; lastCheckedAt: string | null }>> {
    const { results } = await this.db.prepare('SELECT id, url, label, provider, last_status, last_checked_at FROM user_sources WHERE user_id = ? ORDER BY created_at').bind(userId).all<{ id: string; url: string; label: string; provider: string; last_status: string | null; last_checked_at: string | null }>();
    return results.map((row) => ({ id: row.id, url: row.url, label: row.label, provider: row.provider, lastStatus: row.last_status, lastCheckedAt: row.last_checked_at }));
  }

  async addSource(userId: string, url: string, label: string, provider: string, status: string): Promise<string> {
    const id = `src_${await shortHash(`${userId}|${url}`)}`;
    await this.db
      .prepare('INSERT INTO user_sources (id, user_id, url, label, provider, last_status, last_checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, url) DO UPDATE SET label = excluded.label, last_status = excluded.last_status, last_checked_at = excluded.last_checked_at')
      .bind(id, userId, url, label, provider, status, now(), now())
      .run();
    return id;
  }

  async removeSource(userId: string, id: string): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM user_sources WHERE user_id = ? AND id = ?').bind(userId, id).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async markSource(userId: string, id: string, status: string): Promise<void> {
    await this.db.prepare('UPDATE user_sources SET last_status = ?, last_checked_at = ? WHERE user_id = ? AND id = ?').bind(status.slice(0, 200), now(), userId, id).run();
  }

  // ----- Calendar feed -----

  async feedVersion(userId: string): Promise<number> {
    const row = await this.db.prepare('SELECT version FROM calendar_feed_versions WHERE user_id = ?').bind(userId).first<{ version: number }>();
    return row?.version ?? 1;
  }

  async rotateFeed(userId: string): Promise<number> {
    const next = (await this.feedVersion(userId)) + 1;
    await this.db
      .prepare('INSERT INTO calendar_feed_versions (user_id, version, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at')
      .bind(userId, next, now())
      .run();
    return next;
  }

  // ----- Audit, export and deletion -----

  async logAction(userId: string, tool: string, target: string | undefined, outcome: string, detail?: unknown): Promise<void> {
    await this.db
      .prepare('INSERT INTO agent_action_log (user_id, tool, target, outcome, detail_json, at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(userId, tool, target ?? null, outcome, detail === undefined ? null : JSON.stringify(detail).slice(0, 4000), now())
      .run();
  }

  async exportUser(userId: string): Promise<Record<string, unknown>> {
    const all = async (sql: string) => (await this.db.prepare(sql).bind(userId).all()).results;
    return {
      preferences: await this.getPreferences(userId),
      learnedSignals: await this.learnedSignals(userId),
      plans: await all('SELECT * FROM event_plans WHERE user_id = ?'),
      planHistory: await all('SELECT * FROM plan_history WHERE user_id = ?'),
      registrations: await all('SELECT id, event_id, status, method, verification, provider, provider_reference, created_at, updated_at FROM registrations WHERE user_id = ?'),
      feedback: await all('SELECT * FROM event_feedback WHERE user_id = ?'),
      interactions: await all('SELECT event_id, kind, at FROM event_interactions WHERE user_id = ?'),
      sources: await all('SELECT id, url, label, provider, created_at FROM user_sources WHERE user_id = ?'),
      actionLog: await all('SELECT tool, target, outcome, at FROM agent_action_log WHERE user_id = ? ORDER BY at DESC LIMIT 1000'),
    };
  }

  /** Deletes a person's history. Preferences and sources are kept unless asked. */
  async deleteHistory(userId: string, includePreferences: boolean): Promise<void> {
    const statements = [
      'DELETE FROM plan_history WHERE user_id = ?',
      'DELETE FROM event_plans WHERE user_id = ?',
      'DELETE FROM registrations WHERE user_id = ?',
      'DELETE FROM event_feedback WHERE user_id = ?',
      'DELETE FROM event_interactions WHERE user_id = ?',
      'DELETE FROM learned_signals WHERE user_id = ?',
      'DELETE FROM agent_action_log WHERE user_id = ?',
      ...(includePreferences ? ['DELETE FROM user_preferences WHERE user_id = ?', 'DELETE FROM user_sources WHERE user_id = ?'] : []),
    ].map((sql) => this.db.prepare(sql).bind(userId));
    await this.db.batch(statements);
  }
}

function planFromRow(row: PlanRow): EventPlan {
  return {
    id: row.id,
    userId: row.user_id,
    eventId: row.event_id,
    state: row.state,
    notes: row.notes ?? undefined,
    holdStart: row.hold_start ?? undefined,
    holdEnd: row.hold_end ?? undefined,
    travelBeforeMinutes: row.travel_before_minutes,
    travelAfterMinutes: row.travel_after_minutes,
    calendarSequence: row.calendar_sequence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function registrationFromRow(row: RegistrationRow): Registration {
  return {
    id: row.id,
    userId: row.user_id,
    eventId: row.event_id,
    status: row.status,
    method: row.method,
    verification: row.verification,
    provider: row.provider ?? undefined,
    providerReference: row.provider_reference ?? undefined,
    updatedAt: row.updated_at,
  };
}

function detectChanges(before: CanonicalEvent, after: CanonicalEvent): Array<{ field: string; from: string | null; to: string | null }> {
  const changes: Array<{ field: string; from: string | null; to: string | null }> = [];
  const compare = (field: string, a: string | undefined, b: string | undefined) => {
    if ((a ?? null) !== (b ?? null) && b !== undefined) changes.push({ field, from: a ?? null, to: b ?? null });
  };
  if (!(before.dateOnly === false && after.dateOnly === true)) compare('starts_at', before.startsAt, after.startsAt);
  compare('ends_at', before.endsAt, after.endsAt);
  compare('status', before.status, after.status);
  compare('venue', before.venue?.address ?? before.venue?.name, after.venue?.address ?? after.venue?.name);
  compare('registration', before.registration?.availability, after.registration?.availability);
  return changes;
}

function now(): string {
  return new Date().toISOString();
}

export async function shortHash(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
