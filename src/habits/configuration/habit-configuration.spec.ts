import { model } from 'mongoose';
import { HabitUser, HabitUserSchema } from '../entities/habit-user.entity';
import { calendarDay } from '../../common/calendar';
import {
  ConfigurationRevision,
  configurationView,
  nextCalendarDay,
  parseConfiguration,
  resolveConfigurationForDate,
} from './habit-configuration';

const fallback = { schedule: { kind: 'daily' }, goal: { kind: 'checkbox' } };
const revision = (
  revisionId: string,
  effectiveFrom: string,
  target: number,
): ConfigurationRevision => ({
  revisionId,
  effectiveFrom,
  configuration: {
    schedule: { kind: 'weekly', timesPerWeek: 3 },
    goal: { kind: 'quantity', target, unit: 'pages' },
  },
});

describe('Configuration calendar and original-history resolution', () => {
  it.each([
    ['America/New_York', '2025-03-09T04:30:00Z', '2025-03-08', '2025-03-09'],
    ['America/New_York', '2025-03-10T03:30:00Z', '2025-03-09', '2025-03-10'],
    ['America/New_York', '2025-11-02T05:30:00Z', '2025-11-02', '2025-11-03'],
    ['America/New_York', '2025-11-02T06:30:00Z', '2025-11-02', '2025-11-03'],
    ['Asia/Tokyo', '2025-03-31T16:00:00Z', '2025-04-01', '2025-04-02'],
    ['America/Los_Angeles', '2025-04-01T00:30:00Z', '2025-03-31', '2025-04-01'],
    ['UTC', '2024-02-28T12:00:00Z', '2024-02-28', '2024-02-29'],
    ['UTC', '2024-02-29T12:00:00Z', '2024-02-29', '2024-03-01'],
    ['UTC', '2025-12-31T12:00:00Z', '2025-12-31', '2026-01-01'],
  ])(
    'advances labels, not 24-hour instants in %s at %s',
    (zone, instant, today, tomorrow) => {
      expect(calendarDay(new Date(instant), zone)).toBe(today);
      expect(nextCalendarDay(today)).toBe(tomorrow);
    },
  );

  it.each([
    '2025-02-29',
    '2025-04-31',
    '2025-4-01',
    '0000-01-01',
    '9999-12-31',
    '2025-04-01T00:00:00Z',
    '',
    null,
    1,
  ])('rejects invalid/overflow next-date label %j', (day) => {
    expect(() => nextCalendarDay(day as string)).toThrow(RangeError);
  });

  it('resolves greatest applicable date, then last persisted position (not ID order)', () => {
    const revisions = [
      revision('z', '2025-04-01', 10),
      revision('future', '2025-06-01', 90),
      revision('a', '2025-04-01', 20),
      revision('older', '2025-03-01', 5),
    ];
    expect(resolveConfigurationForDate(revisions, '2025-04-01')).toEqual(
      revisions[2],
    );
    expect(resolveConfigurationForDate(revisions, '2025-05-31')).toEqual(
      revisions[2],
    );
    expect(resolveConfigurationForDate(revisions, '2025-06-01')).toEqual(
      revisions[1],
    );
    expect(resolveConfigurationForDate(revisions, '2025-03-31')).toEqual(
      revisions[3],
    );
    expect(resolveConfigurationForDate(revisions, '2025-02-28')).toEqual({
      configuration: fallback,
    });
  });

  it('uses legacy defaults for every date without inventing a birth date', () => {
    for (const revisions of [undefined, []]) {
      expect(resolveConfigurationForDate(revisions, '1900-01-01')).toEqual({
        configuration: fallback,
      });
      expect(resolveConfigurationForDate(revisions, '2099-12-31')).toEqual({
        configuration: fallback,
      });
      expect(configurationView(revisions, '2025-04-01')).toEqual({});
    }
  });

  it('returns only current and nearest pending winner, excluding superseded/raw revisions', () => {
    const revisions = [
      revision('current', '2025-03-01', 1),
      revision('far', '2025-07-01', 7),
      revision('next-z', '2025-04-02', 2),
      revision('next-a', '2025-04-02', 3),
    ];
    expect(configurationView(revisions, '2025-04-01')).toEqual({
      configuration: revisions[0].configuration,
      pendingConfiguration: revisions[3],
    });
    expect(configurationView(revisions, '2025-07-01')).toEqual({
      configuration: revisions[1].configuration,
    });
    expect(configurationView(revisions, '2025-02-28')).toEqual({
      configuration: fallback,
      pendingConfiguration: revisions[0],
    });
  });

  it('preserves selected weekends and never aliases or mutates inputs/history/defaults', () => {
    const input = {
      schedule: { kind: 'weekdays', days: [6, 7] },
      goal: { kind: 'quantity', target: 2, unit: ' cups ' },
    };
    const parsed = parseConfiguration(input);
    expect(parsed).toEqual({
      ...input,
      goal: { ...input.goal, unit: 'cups' },
    });
    if (parsed.schedule.kind === 'weekdays') parsed.schedule.days.push(1);
    expect(input.schedule.days).toEqual([6, 7]);
    expect(input.goal.unit).toBe(' cups ');
    const revisions = [revision('original', '2025-04-01', 10)];
    Object.freeze(revisions[0].configuration.goal);
    Object.freeze(revisions[0]);
    Object.freeze(revisions);
    const resolved = resolveConfigurationForDate(revisions, '2025-04-01');
    if (resolved.configuration.goal.kind === 'quantity')
      resolved.configuration.goal.target = 99;
    expect(revisions[0].configuration.goal).toMatchObject({ target: 10 });
    const legacy = resolveConfigurationForDate(undefined, '2025-04-01');
    legacy.configuration.schedule = { kind: 'weekly', timesPerWeek: 7 };
    expect(resolveConfigurationForDate(undefined, '2025-04-01')).toEqual({
      configuration: fallback,
    });
  });

  it('rejects sparse weekday arrays without coercing missing days', () => {
    const days = Array<number>(2);
    days[0] = 1;
    expect(() =>
      parseConfiguration({
        schedule: { kind: 'weekdays', days },
        goal: { kind: 'checkbox' },
      }),
    ).toThrow(RangeError);
  });

  it.each(['2025-02-29', 'not-a-date', null, 1])(
    'rejects invalid resolver date %j even on legacy rows',
    (day) => {
      expect(() =>
        resolveConfigurationForDate(undefined, day as string),
      ).toThrow(RangeError);
    },
  );
});

const Fixture = model<HabitUser>(
  'ConfigurationFixtureHabitUser',
  HabitUserSchema,
);
describe('Embedded revision schema (no database)', () => {
  const ids = {
    userId: '000000000000000000000001',
    habitId: '000000000000000000000002',
  };
  it('does not create revisions on legacy documents; retains full bundles and IDs', async () => {
    expect(new Fixture(ids).toObject()).not.toHaveProperty(
      'configurationRevisions',
    );
    const stored = revision('000000000000000000000003', '2024-02-29', 0.1);
    const row = new Fixture({ ...ids, configurationRevisions: [stored] });
    await expect(row.validate()).resolves.toBeUndefined();
    expect(row.toObject().configurationRevisions).toEqual([stored]);
  });
  it.each([
    revision('000000000000000000000003', '2025-02-29', 1),
    {
      ...revision('000000000000000000000003', '2025-04-01', 1),
      configuration: {
        schedule: { kind: 'daily', days: [1] },
        goal: { kind: 'checkbox' },
      },
    },
    {
      ...revision('000000000000000000000003', '2025-04-01', 1),
      configuration: { schedule: { kind: 'daily' } },
    },
    revision('bad-id', '2025-04-01', 1),
  ])('rejects malformed persisted revisions %j', async (stored) => {
    await expect(
      new Fixture({ ...ids, configurationRevisions: [stored] }).validate(),
    ).rejects.toThrow();
  });
});
