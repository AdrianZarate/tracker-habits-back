import { model, Types } from 'mongoose';
import { HabitLog, HabitLogSchema } from './habit-log.entity';

const Log = model<HabitLog>('MeasuredLogFixture', HabitLogSchema);
const configuration = {
  schedule: { kind: 'daily' },
  goal: { kind: 'quantity', target: 20, unit: 'pages' },
};
const snapshot = {
  configuration,
  revisionId: '000000000000000000000010',
  effectiveFrom: '2025-04-01',
};
const fixture = (fields: object = {}) =>
  new Log({
    userId: new Types.ObjectId(),
    habitId: new Types.ObjectId(),
    date: new Date('2025-04-01T00:00:00Z'),
    ...fields,
  });

describe('HabitLog measured schema (no DB)', () => {
  it('retains the unique owner/habit/date index', () => {
    expect(HabitLogSchema.indexes()).toContainEqual([
      { userId: 1, habitId: 1, date: 1 },
      { unique: true },
    ]);
  });

  it('preserves missing optional fields on legacy records', async () => {
    const row = fixture();
    await expect(row.validate()).resolves.toBeUndefined();
    expect(row.toObject()).not.toHaveProperty('amount');
    expect(row.toObject()).not.toHaveProperty('configurationSnapshot');
  });

  it.each([0, 0.5, 1e9])(
    'accepts amount %s and the full snapshot',
    async (amount) => {
      const row = fixture({ amount, configurationSnapshot: snapshot });
      await expect(row.validate()).resolves.toBeUndefined();
      expect(row.toObject()).toMatchObject({
        amount,
        configurationSnapshot: snapshot,
      });
    },
  );

  it('keeps missing revision metadata absent in a legacy-resolved snapshot', async () => {
    const row = fixture({ configurationSnapshot: { configuration } });
    await expect(row.validate()).resolves.toBeUndefined();
    expect(row.toObject().configurationSnapshot).toEqual({ configuration });
  });

  it.each([null, '1', NaN, Infinity, -1, 1e9 + 1])(
    'rejects amount without coercion %s',
    async (amount) => {
      await expect(fixture({ amount }).validate()).rejects.toThrow();
    },
  );

  it.each([
    null,
    [],
    {},
    { ...snapshot, extra: true },
    { ...snapshot, revisionId: null },
    { ...snapshot, revisionId: 1 },
    { ...snapshot, revisionId: 'bad' },
    { ...snapshot, effectiveFrom: null },
    { ...snapshot, effectiveFrom: '2025-02-29' },
    { ...snapshot, configuration: { ...configuration, extra: true } },
    {
      configuration: {
        ...configuration,
        goal: { kind: 'quantity', target: '20', unit: 'pages' },
      },
    },
    {
      configuration: {
        schedule: { kind: 'daily', days: [1] },
        goal: { kind: 'checkbox' },
      },
    },
  ])('rejects malformed snapshot %j', async (configurationSnapshot) => {
    await expect(
      fixture({ configurationSnapshot }).validate(),
    ).rejects.toThrow();
  });

  it('marks the snapshot immutable and prevents replacement on hydrated rows', () => {
    expect(HabitLogSchema.path('configurationSnapshot').options.immutable).toBe(
      true,
    );
    const row = Log.hydrate(
      fixture({ configurationSnapshot: snapshot }).toObject(),
    );
    row.configurationSnapshot = {
      configuration: {
        schedule: { kind: 'daily' },
        goal: { kind: 'checkbox' },
      },
    };
    expect(row.configurationSnapshot).toEqual(snapshot);
  });
});
