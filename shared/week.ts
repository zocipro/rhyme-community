// Leaderboard weeks run Monday 00:00 → next Monday 00:00, Beijing time (UTC+8, no daylight saving).
const OFFSET = 8 * 3_600_000, DAY = 86_400_000;

export function weekRange(now: Date, back = 0): { start: string; end: string } {
  const local = new Date(now.getTime() + OFFSET);
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - (sinceMonday + back * 7) * DAY - OFFSET;
  return { start: new Date(monday).toISOString(), end: new Date(monday + 7 * DAY).toISOString() };
}
