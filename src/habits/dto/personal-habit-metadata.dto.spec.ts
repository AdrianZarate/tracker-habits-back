import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateHabitDto } from './create-habit.dto';
import { UpdateHabitUserDto } from './update-habit-user.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
});

describe.each([CreateHabitDto, UpdateHabitUserDto])(
  '%s personal habit validation',
  (Dto) => {
    it('trims title and metadata before validating', async () => {
      const dto = plainToInstance(Dto, {
        title: '  Read  ',
        category: '  Learning  ',
        color: ' #Ab12ef ',
        icon: ' book ',
      });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto).toMatchObject({
        title: 'Read',
        category: 'Learning',
        color: '#Ab12ef',
        icon: 'book',
      });
    });

    it.each(['', '   ', ' ab ', null, 42, {}, [], 'a'.repeat(201)])(
      'rejects invalid title %j',
      async (title) => {
        expect(
          await validate(plainToInstance(Dto, { title })),
        ).not.toHaveLength(0);
      },
    );

    it.each(['category', 'color', 'icon'])(
      'allows omission or empty-string clearing for %s, but rejects null/types',
      async (field) => {
        for (const value of [undefined, '', '  ']) {
          expect(
            await validate(
              plainToInstance(Dto, { title: 'Read', [field]: value }),
            ),
          ).toHaveLength(0);
        }
        for (const value of [null, 42, {}, [], true]) {
          expect(
            await validate(
              plainToInstance(Dto, { title: 'Read', [field]: value }),
            ),
          ).not.toHaveLength(0);
        }
      },
    );

    it.each(['red', '#fff', 'abcdef', '#12345g', '#12345678'])(
      'rejects color %s',
      async (color) => {
        expect(
          await validate(plainToInstance(Dto, { title: 'Read', color })),
        ).not.toHaveLength(0);
      },
    );

    it('bounds category and icon and accepts their exact limits', async () => {
      expect(
        await validate(
          plainToInstance(Dto, {
            title: 'Read',
            category: 'a'.repeat(80),
            icon: 'a'.repeat(64),
          }),
        ),
      ).toHaveLength(0);
      expect(
        await validate(
          plainToInstance(Dto, {
            title: 'Read',
            category: 'a'.repeat(81),
            icon: 'a'.repeat(65),
          }),
        ),
      ).toHaveLength(2);
    });

    it('rejects ownership, identity, schedule and lifecycle payload fields through the production pipe', async () => {
      for (const field of [
        'userId',
        'habitId',
        'slug',
        'active',
        'schedule',
        'target',
      ]) {
        await expect(
          pipe.transform(
            { title: 'Read', [field]: 'forbidden' },
            { type: 'body', metatype: Dto },
          ),
        ).rejects.toThrow();
      }
    });
  },
);

describe('Create versus definition patch', () => {
  it('requires a create title, but accepts an omitted patch title', async () => {
    expect(await validate(new CreateHabitDto())).not.toHaveLength(0);
    expect(await validate(new UpdateHabitUserDto())).toHaveLength(0);
  });

  it('returns transformed DTO values even with production transform disabled', async () => {
    expect(
      await pipe.transform(
        { title: '  Read  ', category: '  ' },
        { type: 'body', metatype: UpdateHabitUserDto },
      ),
    ).toEqual({ title: 'Read', category: '' });
  });
});
