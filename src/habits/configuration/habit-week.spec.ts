import { calendarDay } from '../../common/calendar';
import { HabitConfiguration } from './habit-configuration';
import { isoWeekDates, scheduledOnDate } from './habit-week';

describe('ISO account-date weeks', () => {
  it.each([
    ['2025-03-31', '2025-03-31', '2025-04-06'],
    ['2025-04-06', '2025-03-31', '2025-04-06'],
    ['2021-01-01', '2020-12-28', '2021-01-03'],
    ['2024-02-29', '2024-02-26', '2024-03-03'],
    ['0001-01-01', '0001-01-01', '0001-01-07'],
    ['9999-12-26', '9999-12-20', '9999-12-26'],
  ])('labels the week containing %s', (day, start, end) => {
    const dates = isoWeekDates(day);
    expect(dates).toHaveLength(7);
    expect(new Set(dates).size).toBe(7);
    expect(dates[0]).toBe(start);
    expect(dates[6]).toBe(end);
    expect(dates).toContain(day);
  });

  it.each([
    '9999-12-27',
    '9999-12-31',
    '0000-12-31',
    '10000-01-01',
    '2025-02-29',
    '2025-3-01',
    '',
  ])('rejects invalid labels or overflowing full weeks: %s', (day) => {
    expect(() => isoWeekDates(day)).toThrow(RangeError);
  });

  it.each([
    ['2025-03-10T00:30:00Z', 'America/Los_Angeles', '2025-03-03', '2025-03-09'],
    ['2025-11-03T00:30:00Z', 'America/Los_Angeles', '2025-10-27', '2025-11-02'],
    ['2025-03-09T23:30:00Z', 'Asia/Tokyo', '2025-03-10', '2025-03-16'],
    ['2025-03-10T00:30:00Z', 'UTC', '2025-03-10', '2025-03-16'],
  ])(
    'uses account labels across DST/timezones %s %s',
    (instant, zone, start, end) => {
      const dates = isoWeekDates(calendarDay(new Date(instant), zone));
      expect(dates[0]).toBe(start);
      expect(dates[6]).toBe(end);
    },
  );

  it.each<HabitConfiguration['schedule']>([
    { kind: 'daily' },
    { kind: 'weekly', timesPerWeek: 3 },
  ])('allows every day for %j', (schedule) => {
    for (const day of isoWeekDates('2025-03-31'))
      expect(
        scheduledOnDate(day, { schedule, goal: { kind: 'checkbox' } }),
      ).toBe(true);
  });

  it('matches ISO Monday=1 and Sunday=7 rather than JS Sunday=0', () => {
    const configuration: HabitConfiguration = {
      schedule: { kind: 'weekdays', days: [1, 7] },
      goal: { kind: 'checkbox' },
    };
    expect(
      isoWeekDates('2025-03-31').map((day) =>
        scheduledOnDate(day, configuration),
      ),
    ).toEqual([true, false, false, false, false, false, true]);
  });
});
