/** Named IANA zones (including UTC), not numeric offsets. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A stored Date is a calendar label anchor, not account-local midnight. */
export function dayLabelToUtcAnchor(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith('0000')) {
    throw new RangeError('Expected a Gregorian YYYY-MM-DD label');
  }
  const anchor = new Date(`${day}T00:00:00.000Z`);
  if (
    !Number.isFinite(anchor.getTime()) ||
    anchor.toISOString().slice(0, 10) !== day
  ) {
    throw new RangeError('Invalid calendar day');
  }
  return anchor;
}

/** Derive a label only from a real instant, never from an existing log anchor. */
export function calendarDay(instant: Date, timeZone: string): string {
  if (!isValidTimeZone(timeZone)) throw new RangeError('Invalid IANA timezone');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    era: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  if (part('era') !== 'AD') throw new RangeError('Unsupported calendar era');
  const day = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
  dayLabelToUtcAnchor(day);
  return day;
}

/** Inclusive UTC label anchors for the account-local current calendar month. */
export function calendarMonthBounds(instant: Date, timeZone: string) {
  const start = dayLabelToUtcAnchor(
    `${calendarDay(instant, timeZone).slice(0, 7)}-01`,
  );
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { start, end };
}
