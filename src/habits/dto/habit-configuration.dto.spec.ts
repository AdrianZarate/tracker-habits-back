import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateHabitDto } from './create-habit.dto';
import { UpdateHabitUserDto } from './update-habit-user.dto';

const checkbox = { kind: 'checkbox' };
const daily = { kind: 'daily' };
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
});

describe.each([CreateHabitDto, UpdateHabitUserDto])(
  '%s configuration',
  (Dto) => {
    it.each([
      { schedule: daily, goal: checkbox },
      { schedule: { kind: 'weekdays', days: [1, 3, 7] }, goal: checkbox },
      {
        schedule: { kind: 'weekly', timesPerWeek: 7 },
        goal: { kind: 'quantity', target: 1e9, unit: ' Custom unit ' },
      },
    ])(
      'accepts a complete bundle %j through the production pipe',
      async (configuration) => {
        await expect(
          pipe.transform(
            { title: 'Read', configuration },
            { type: 'body', metatype: Dto },
          ),
        ).resolves.toMatchObject({
          configuration: {
            ...configuration,
            goal:
              configuration.goal.kind === 'quantity'
                ? { ...configuration.goal, unit: 'Custom unit' }
                : checkbox,
          },
        });
      },
    );

    it.each([
      null,
      false,
      [],
      'daily',
      {},
      { schedule: daily },
      { goal: checkbox },
      { schedule: null, goal: checkbox },
      { schedule: daily, goal: null },
      { schedule: daily, goal: checkbox, extra: true },
      ...[
        {},
        [],
        'daily',
        { kind: 'unknown' },
        { kind: 'daily', days: [1] },
        { kind: 'daily', timesPerWeek: 1 },
        { kind: 'weekdays', days: [] },
        { kind: 'weekdays', days: [1, 1] },
        { kind: 'weekdays', days: [0] },
        { kind: 'weekdays', days: [8] },
        { kind: 'weekdays', days: [1.5] },
        { kind: 'weekdays', days: ['1'] },
        { kind: 'weekdays', days: null },
        { kind: 'weekdays', days: [1], timesPerWeek: 1 },
        ...[null, '1', 0, 8, 1.5, NaN, Infinity].map((timesPerWeek) => ({
          kind: 'weekly',
          timesPerWeek,
        })),
        { kind: 'weekly', timesPerWeek: 2, days: [1] },
      ].map((schedule) => ({ schedule, goal: checkbox })),
      ...[
        {},
        [],
        'checkbox',
        { kind: 'unknown' },
        { kind: 'checkbox', target: 1 },
        { kind: 'checkbox', unit: 'x' },
        ...[null, '1', 0, -1, 1e9 + 1, NaN, Infinity].map((target) => ({
          kind: 'quantity',
          target,
          unit: 'x',
        })),
        ...[null, 1, '', '   ', 'x'.repeat(33)].map((unit) => ({
          kind: 'quantity',
          target: 1,
          unit,
        })),
        { kind: 'quantity', target: 1, unit: 'x', extra: true },
      ].map((goal) => ({ schedule: daily, goal })),
    ])(
      'rejects invalid/partial/irrelevant fields %j',
      async (configuration) => {
        expect(
          await validate(
            plainToInstance(Dto, { title: 'Read', configuration }),
          ),
        ).not.toHaveLength(0);
      },
    );

    it('allows omitted configuration and small positive fractional quantities', async () => {
      expect(
        await validate(plainToInstance(Dto, { title: 'Read' })),
      ).toHaveLength(0);
      await expect(
        pipe.transform(
          {
            title: 'Read',
            configuration: {
              schedule: daily,
              goal: { kind: 'quantity', target: 0.01, unit: 'x'.repeat(32) },
            },
          },
          { type: 'body', metatype: Dto },
        ),
      ).resolves.toBeDefined();
    });
  },
);
