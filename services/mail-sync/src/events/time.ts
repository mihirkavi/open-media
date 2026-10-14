import { zonedWallTimeToUtc } from 'structured-event-feeds';

export type Period = 'today' | 'tonight' | 'tomorrow' | 'this_weekend' | 'next_weekend' | 'next_7_days' | 'next_14_days' | 'next_30_days';

export const PERIODS: Period[] = ['today', 'tonight', 'tomorrow', 'this_weekend', 'next_weekend', 'next_7_days', 'next_14_days', 'next_30_days'];

interface LocalDate {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

export function localToday(now: Date, timeZone: string): LocalDate {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? 'Sun'),
  };
}

function at(date: LocalDate, offsetDays: number, hour: number, timeZone: string): Date {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + offsetDays));
  return zonedWallTimeToUtc({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour, minute: 0, second: 0 }, timeZone);
}

/** Resolves a named period in the person's timezone. Windows never start in the past. */
export function resolvePeriod(period: Period, now: Date, timeZone: string): { start: Date; end: Date } {
  const today = localToday(now, timeZone);
  const clamp = (start: Date, end: Date) => ({ start: start < now ? now : start, end });
  switch (period) {
    case 'today':
      return clamp(at(today, 0, 0, timeZone), at(today, 1, 3, timeZone));
    case 'tonight':
      return clamp(at(today, 0, 17, timeZone), at(today, 1, 3, timeZone));
    case 'tomorrow':
      return clamp(at(today, 1, 0, timeZone), at(today, 2, 3, timeZone));
    case 'this_weekend': {
      // Friday 5 PM through Sunday night; on a weekend day, the current weekend.
      const toFriday = today.weekday === 0 ? -2 : today.weekday === 6 ? -1 : 5 - today.weekday;
      return clamp(at(today, toFriday, 17, timeZone), at(today, toFriday + 3, 0, timeZone));
    }
    case 'next_weekend': {
      const toFriday = today.weekday === 0 ? 5 : today.weekday === 6 ? 6 : 5 - today.weekday + 7;
      return clamp(at(today, toFriday, 17, timeZone), at(today, toFriday + 3, 0, timeZone));
    }
    case 'next_14_days':
      return clamp(now, at(today, 15, 0, timeZone));
    case 'next_30_days':
      return clamp(now, at(today, 31, 0, timeZone));
    case 'next_7_days':
    default:
      return clamp(now, at(today, 8, 0, timeZone));
  }
}

/** Voice-friendly local time, e.g. “Thu Oct 16, 7:00 PM”. */
export function formatLocal(iso: string, timeZone: string, dateOnly = false): string {
  if (dateOnly) {
    const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(year!, month! - 1, day!))) + ' (time not listed)';
  }
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function localDateKey(iso: string, timeZone: string, dateOnly = false): string {
  if (dateOnly) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
