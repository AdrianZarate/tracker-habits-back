import {
  calendarDay,
  calendarMonthBounds,
  dayLabelToUtcAnchor,
  isValidTimeZone,
} from './calendar';

describe('account calendar labels', () => {
  it.each([
    ['UTC', true],
    ['America/New_York', true],
    ['Asia/Tokyo', true],
    ['Mars/Olympus', false],
    ['', false],
    ['+01:00', false],
    [null, false],
  ])('validates timezone %s', (zone, valid) => {
    expect(isValidTimeZone(zone)).toBe(valid);
  });

  it.each([
    ['2024-02-29T23:30:00Z', 'Asia/Tokyo', '2024-03-01'],
    ['2024-03-01T01:30:00Z', 'America/Los_Angeles', '2024-02-29'],
    ['2024-03-10T06:59:59Z', 'America/New_York', '2024-03-10'],
    ['2024-03-10T07:00:00Z', 'America/New_York', '2024-03-10'],
    ['2024-11-03T05:30:00Z', 'America/New_York', '2024-11-03'],
    ['2024-11-03T06:30:00Z', 'America/New_York', '2024-11-03'],
  ])('labels %s in %s', (instant, zone, expected) => {
    expect(calendarDay(new Date(instant), zone)).toBe(expected);
  });

  it.each(['2024-02-29', '2023-12-31', '0099-01-01'])(
    'anchors %s without shifting',
    (day) => {
      expect(dayLabelToUtcAnchor(day).toISOString()).toBe(
        `${day}T00:00:00.000Z`,
      );
    },
  );

  it.each([
    '2023-02-29',
    '2024-02-30',
    '2024-13-01',
    '2024-00-01',
    '2024-01-00',
    '2024-1-01',
    '2024-01-01T00:00:00Z',
    '0000-01-01',
  ])('rejects invalid label %s', (day) => {
    expect(() => dayLabelToUtcAnchor(day)).toThrow(RangeError);
  });

  it.each([
    ['2024-03-01T01:00:00Z', 'America/Los_Angeles', '2024-02-01', '2024-02-29'],
    ['2023-02-15T12:00:00Z', 'UTC', '2023-02-01', '2023-02-28'],
    ['2024-12-31T23:00:00Z', 'Asia/Tokyo', '2025-01-01', '2025-01-31'],
    ['2024-04-15T12:00:00Z', 'UTC', '2024-04-01', '2024-04-30'],
  ])('bounds local month at %s in %s', (instant, zone, start, end) => {
    expect(calendarMonthBounds(new Date(instant), zone)).toEqual({
      start: dayLabelToUtcAnchor(start),
      end: dayLabelToUtcAnchor(end),
    });
  });

  it('rejects an instant outside the supported Gregorian label years', () => {
    expect(() => calendarDay(new Date('0000-01-01T12:00:00Z'), 'UTC')).toThrow(
      RangeError,
    );
  });

  it('rejects invalid zones and instants instead of guessing', () => {
    expect(() =>
      calendarDay(new Date('2024-01-01T12:00:00Z'), 'Mars/Olympus'),
    ).toThrow(RangeError);
    expect(() => calendarDay(new Date('invalid'), 'UTC')).toThrow(RangeError);
  });
});
