import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { Model, Types } from 'mongoose';
import slugify from 'slugify';

import { CommonService } from '../common/common.service';
import {
  calendarDay,
  calendarMonthBounds,
  dayLabelToUtcAnchor,
} from '../common/calendar';
import { User } from 'src/auth/entities/user.entity';

import { CreateHabitDto } from './dto/create-habit.dto';
import { CompleteHabitDto } from './dto/complete-habit.dto';
import { UpdateHabitLogDto } from './dto/update-habit-log.dto';
import { GetLogsDto } from './dto/get-logs.dto';
import { UpdateHabitUserDto } from './dto/update-habit-user.dto';
import { Habit, HabitLog, HabitUser } from './entities';
import {
  configurationView,
  HabitConfiguration,
  legacyConfiguration,
  nextCalendarDay,
  parseConfiguration,
  resolveConfigurationForDate,
} from './configuration/habit-configuration';

type HabitListRow = Pick<
  HabitUser,
  'habitId' | 'title' | 'category' | 'color' | 'icon' | 'configurationRevisions'
> &
  Pick<Habit, 'slug'>;

/** Shape produced by the global-habit lookup and log projection below. */
type HabitLogSummary = Pick<
  HabitLog,
  'date' | 'completed' | 'amount' | 'note' | 'configurationSnapshot'
> &
  Pick<Habit, 'title' | 'slug'> & {
    _id: Types.ObjectId;
    habitId: Types.ObjectId;
  };

@Injectable()
export class HabitsService {
  constructor(
    @InjectModel('Habit')
    private readonly habitModel: Model<Habit>,
    @InjectModel('HabitUser')
    private readonly habitUserModel: Model<HabitUser>,
    @InjectModel('HabitLog')
    private readonly habitLogModel: Model<HabitLog>,

    private readonly commonService: CommonService,
  ) {}

  async create(createHabitDto: CreateHabitDto, user: User) {
    const today = calendarDay(new Date(), user.timeZone ?? 'UTC');
    const configuration =
      this.validatedConfiguration(createHabitDto.configuration) ??
      legacyConfiguration();
    const slug = slugify(createHabitDto.title, {
      lower: true,
      strict: true,
      trim: true,
    });

    try {
      // 1️ Obtener o crear hábito global
      const habit = await this.habitModel.findOneAndUpdate(
        // Busca por slug para evitar duplicados y mantener consistencia
        { slug },
        {
          $setOnInsert: { title: createHabitDto.title, slug },
        },
        {
          returnDocument: 'after', // Devuelve el documento después de la actualización
          upsert: true, // Crea el documento si no existe
          setDefaultsOnInsert: true, // Aplica los valores por defecto si se crea un nuevo documento
        },
      );

      // 2️ Crear o reactivar relación usuario-hábito
      const habitUser = await this.habitUserModel.findOneAndUpdate(
        {
          userId: user._id,
          habitId: habit._id,
        },
        {
          ...this.personalUpdate(createHabitDto, true),
          $setOnInsert: {
            configurationRevisions: [
              this.configurationRevision(configuration, today),
            ],
          },
        },
        {
          returnDocument: 'after',
          upsert: true,
          setDefaultsOnInsert: true,
          runValidators: true,
        },
      );

      return this.associationView(habitUser.toObject(), today);
    } catch (error) {
      this.commonService.handleExceptions(error, 'Habit');
    }
  }

  async findAllByUser(user: User) {
    const today = calendarDay(new Date(), user.timeZone ?? 'UTC');
    const rows = await this.habitUserModel.aggregate<HabitListRow>([
      {
        $match: {
          userId: new Types.ObjectId(user._id),
          active: true,
        },
      },
      {
        $lookup: {
          from: 'habits',
          localField: 'habitId',
          foreignField: '_id',
          as: 'habit',
        },
      },
      { $unwind: '$habit' },
      {
        $project: {
          _id: 0,
          habitId: '$habit._id',
          title: { $ifNull: ['$title', '$habit.title'] },
          slug: '$habit.slug',
          category: { $ifNull: ['$category', '$$REMOVE'] },
          color: { $ifNull: ['$color', '$$REMOVE'] },
          icon: { $ifNull: ['$icon', '$$REMOVE'] },
          configurationRevisions: 1,
        },
      },
    ]);
    return rows.map((row) => this.associationView(row, today));
  }

  async findOneByUser(habitId: string, user: User, instant = new Date()) {
    const today = calendarDay(instant, user.timeZone ?? 'UTC');
    const habitUser = await this.habitUserModel
      .findOne({ userId: user._id, habitId: new Types.ObjectId(habitId) })
      .lean();

    if (!habitUser) {
      throw new NotFoundException('Habit not found for this user');
    }

    return this.personalView(habitUser, today);
  }

  private associationView<
    T extends { configurationRevisions?: HabitUser['configurationRevisions'] },
  >(row: T, today: string) {
    const { configurationRevisions, ...fields } = row;
    return { ...fields, ...configurationView(configurationRevisions, today) };
  }

  private configurationRevision(
    configuration: HabitConfiguration,
    effectiveFrom: string,
  ) {
    return {
      revisionId: new Types.ObjectId().toHexString(),
      effectiveFrom,
      configuration,
    };
  }

  private validatedConfiguration(
    value: unknown,
  ): HabitConfiguration | undefined {
    if (value === undefined) return undefined;
    try {
      return parseConfiguration(value);
    } catch {
      throw new BadRequestException(
        'Expected a complete valid schedule and goal configuration',
      );
    }
  }

  private async personalView(
    habitUser: Pick<
      HabitUser,
      | 'habitId'
      | 'active'
      | 'title'
      | 'category'
      | 'color'
      | 'icon'
      | 'configurationRevisions'
    >,
    today: string,
  ) {
    const habit = await this.habitModel
      .findOne({ _id: habitUser.habitId })
      .lean();
    if (!habit) {
      throw new NotFoundException('Habit not found for this user');
    }

    return {
      habitId: habitUser.habitId,
      title: habitUser.title ?? habit.title,
      slug: habit.slug,
      active: habitUser.active,
      ...(habitUser.category != null ? { category: habitUser.category } : {}),
      ...(habitUser.color != null ? { color: habitUser.color } : {}),
      ...(habitUser.icon != null ? { icon: habitUser.icon } : {}),
      ...configurationView(habitUser.configurationRevisions, today),
    };
  }

  private personalUpdate(dto: UpdateHabitUserDto, active?: boolean) {
    const $set: Record<string, string | boolean> = {};
    const $unset: Record<string, 1> = {};
    if (active !== undefined) $set.active = active;
    if (dto.title !== undefined) $set.title = dto.title;
    for (const key of ['category', 'color', 'icon'] as const) {
      if (dto[key] === '') $unset[key] = 1;
      else if (dto[key] !== undefined) $set[key] = dto[key];
    }
    return {
      ...(Object.keys($set).length ? { $set } : {}),
      ...(Object.keys($unset).length ? { $unset } : {}),
    };
  }

  async updateDefinition(habitId: string, dto: UpdateHabitUserDto, user: User) {
    const instant = new Date();
    const today = calendarDay(instant, user.timeZone ?? 'UTC');
    const configuration = this.validatedConfiguration(dto.configuration);
    const update = {
      ...this.personalUpdate(dto),
      ...(configuration
        ? {
            $push: {
              configurationRevisions: this.configurationRevision(
                configuration,
                nextCalendarDay(today),
              ),
            },
          }
        : {}),
    };
    if (!Object.keys(update).length)
      return this.findOneByUser(habitId, user, instant);
    const habitUser = await this.habitUserModel
      .findOneAndUpdate(
        { userId: user._id, habitId: new Types.ObjectId(habitId) },
        update,
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!habitUser) {
      throw new NotFoundException('Habit not found for this user');
    }
    return this.personalView(habitUser, today);
  }

  async update(habitId: string, user: User) {
    const today = calendarDay(new Date(), user.timeZone ?? 'UTC');
    const habitUser = await this.habitUserModel
      .findOneAndUpdate(
        {
          userId: user._id,
          habitId: new Types.ObjectId(habitId),
        },
        {
          active: false,
        },
        {
          returnDocument: 'after',
        },
      )
      .lean()
      .exec();

    if (!habitUser) {
      throw new NotFoundException('Habit not found for this user');
    }

    return this.associationView(habitUser, today);
  }

  async complete(habitId: string, user: User, dto: CompleteHabitDto = {}) {
    // Capture the account day once, before any awaited read or write.
    const day = calendarDay(new Date(), user.timeZone ?? 'UTC');
    const filter = {
      userId: user._id,
      habitId: new Types.ObjectId(habitId),
      date: dayLabelToUtcAnchor(day),
    };
    const habitUser = await this.habitUserModel
      .findOne({ userId: filter.userId, habitId: filter.habitId, active: true })
      .lean();
    if (!habitUser) {
      throw new NotFoundException('Habit not active for this user');
    }

    let log = await this.habitLogModel.findOne(filter).lean();
    const resolved = () =>
      resolveConfigurationForDate(habitUser.configurationRevisions, day);
    if (!log) {
      const snapshot = resolved();
      const progress = this.completionProgress(dto, snapshot.configuration);
      const schedule = snapshot.configuration.schedule;
      const weekday = filter.date.getUTCDay() || 7;
      if (schedule.kind === 'weekdays' && !schedule.days.includes(weekday)) {
        throw new BadRequestException('Habit is not scheduled for today');
      }
      try {
        // The unique owner/habit/date key selects the winner; no existing
        // fields are changed here, including on a concurrent insertion.
        log = await this.habitLogModel
          .findOneAndUpdate(
            filter,
            { $setOnInsert: { configurationSnapshot: snapshot, ...progress } },
            { upsert: true, returnDocument: 'after', runValidators: true },
          )
          .lean()
          .exec();
      } catch (error: unknown) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 11000
        )
          throw error;
        // A competing insert won. Read its authority rather than retrying
        // with our configuration or rewriting the original snapshot.
        log = await this.habitLogModel.findOne(filter).lean();
        if (!log) throw error;
      }
    }
    if (!log) throw new NotFoundException('Habit log not found');
    const configuration = log.configurationSnapshot
      ? parseConfiguration(log.configurationSnapshot.configuration)
      : resolved().configuration;
    const progress = this.completionProgress(dto, configuration);
    return this.habitLogModel
      .findOneAndUpdate(
        { ...filter, _id: log._id },
        { $set: progress },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
  }

  private completionProgress(
    dto: CompleteHabitDto,
    configuration: HabitConfiguration,
  ) {
    if (
      typeof dto !== 'object' ||
      dto === null ||
      Array.isArray(dto) ||
      Object.keys(dto).some((key) => key !== 'amount')
    )
      throw new BadRequestException('Expected only an optional amount');
    const { goal } = configuration;
    if (goal.kind === 'checkbox') {
      if (Object.prototype.hasOwnProperty.call(dto, 'amount')) {
        throw new BadRequestException('Checkbox goals do not accept amount');
      }
      return { completed: true };
    }
    const amount = dto.amount;
    if (
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 1e9
    )
      throw new BadRequestException(
        'Quantity goals require a finite amount 0..1e9',
      );
    return { amount, completed: amount >= goal.target };
  }

  async updateLog(
    habitId: string,
    day: string,
    dto: UpdateHabitLogDto,
    user: User,
  ) {
    const today = calendarDay(new Date(), user.timeZone ?? 'UTC');
    const date = this.queryAnchor(day);
    if (day > today)
      throw new BadRequestException('Cannot record future dates');
    const note = this.validatedLogPatch(dto);
    const filter = {
      userId: user._id,
      habitId: new Types.ObjectId(habitId),
      date,
    };
    const habitUser = await this.habitUserModel
      .findOne({ userId: filter.userId, habitId: filter.habitId })
      .lean();
    if (!habitUser)
      throw new NotFoundException('Habit not found for this user');

    let log = await this.habitLogModel.findOne(filter).lean();
    const resolved = () =>
      resolveConfigurationForDate(habitUser.configurationRevisions, day);
    if (!log) {
      if (!habitUser.active)
        throw new NotFoundException('Habit not active for this user');
      if (dto.amount === undefined && dto.completed === undefined)
        throw new BadRequestException('New records require explicit progress');
      const snapshot = resolved();
      const progress = this.correctionProgress(dto, snapshot.configuration);
      const schedule = snapshot.configuration.schedule;
      const weekday = date.getUTCDay() || 7;
      if (schedule.kind === 'weekdays' && !schedule.days.includes(weekday))
        throw new BadRequestException('Habit is not scheduled for this date');
      try {
        // Insert-only authority: a competing writer's original snapshot wins.
        log = await this.habitLogModel
          .findOneAndUpdate(
            filter,
            {
              $setOnInsert: {
                configurationSnapshot: snapshot,
                ...progress,
                ...(note ? { note } : {}),
              },
            },
            { upsert: true, returnDocument: 'after', runValidators: true },
          )
          .lean()
          .exec();
      } catch (error: unknown) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 11000
        )
          throw error;
        log = await this.habitLogModel.findOne(filter).lean();
      }
    }
    if (!log)
      throw new ConflictException('Habit log changed; retry correction');
    // Notes-only edits do not derive progress, fill legacy gaps or touch snapshots.
    const progress =
      dto.amount === undefined && dto.completed === undefined
        ? {}
        : this.correctionProgress(
            dto,
            log.configurationSnapshot
              ? parseConfiguration(log.configurationSnapshot.configuration)
              : resolved().configuration,
          );
    const $set = { ...progress, ...(note ? { note } : {}) };
    const result = await this.habitLogModel
      .findOneAndUpdate(
        { ...filter, _id: log._id },
        {
          ...(Object.keys($set).length ? { $set } : {}),
          ...(note === '' ? { $unset: { note: 1 } } : {}),
        },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    // Undo/reinsert must not cause a correction to overwrite the new identity.
    if (!result)
      throw new ConflictException('Habit log changed; retry correction');
    return result;
  }

  private validatedLogPatch(dto: UpdateHabitLogDto) {
    if (
      typeof dto !== 'object' ||
      dto === null ||
      Array.isArray(dto) ||
      !Object.keys(dto).length ||
      Object.keys(dto).some(
        (key) => !['amount', 'completed', 'note'].includes(key),
      ) ||
      !Object.values(dto).some((value: unknown) => value !== undefined)
    )
      throw new BadRequestException('Expected amount, completed and/or note');
    if (
      dto.amount !== undefined &&
      (typeof dto.amount !== 'number' ||
        !Number.isFinite(dto.amount) ||
        dto.amount < 0 ||
        dto.amount > 1e9)
    )
      throw new BadRequestException('Expected a finite amount 0..1e9');
    if (dto.completed !== undefined && typeof dto.completed !== 'boolean')
      throw new BadRequestException('Expected a boolean completed flag');
    if (dto.note !== undefined) {
      if (typeof dto.note !== 'string' || dto.note.trim().length > 2000)
        throw new BadRequestException(
          'Expected a note of at most 2000 characters',
        );
      return dto.note.trim();
    }
    return undefined;
  }

  private correctionProgress(
    dto: UpdateHabitLogDto,
    configuration: HabitConfiguration,
  ) {
    if (configuration.goal.kind === 'quantity') {
      if (dto.completed !== undefined)
        throw new BadRequestException('Quantity goals do not accept completed');
      return this.completionProgress({ amount: dto.amount }, configuration);
    }
    if (dto.amount !== undefined)
      throw new BadRequestException('Checkbox goals do not accept amount');
    if (typeof dto.completed !== 'boolean')
      throw new BadRequestException('Checkbox progress requires completed');
    return { completed: dto.completed };
  }

  async getLogs(habitId: string, user: User, getLogsDto: GetLogsDto) {
    const month = calendarMonthBounds(new Date(), user.timeZone ?? 'UTC');
    const startDate =
      getLogsDto.startDate === undefined
        ? month.start
        : this.queryAnchor(getLogsDto.startDate);
    const endDate =
      getLogsDto.endDate === undefined
        ? month.end
        : this.queryAnchor(getLogsDto.endDate);

    if (startDate > endDate) {
      throw new BadRequestException('Invalid date range');
    }

    return await this.habitLogModel
      .find({
        userId: user._id,
        habitId: new Types.ObjectId(habitId),
        date: {
          $gte: startDate,
          $lte: endDate,
        },
      })
      .lean()
      .exec();
  }

  private todayAnchor(user: User) {
    return dayLabelToUtcAnchor(calendarDay(new Date(), user.timeZone ?? 'UTC'));
  }

  private queryAnchor(label: string) {
    try {
      return dayLabelToUtcAnchor(label);
    } catch {
      throw new BadRequestException(
        'Expected a valid YYYY-MM-DD calendar date',
      );
    }
  }

  async deleteHabitLog(habitId: string, user: User) {
    const today = this.todayAnchor(user);

    return await this.habitLogModel.deleteOne({
      userId: user._id,
      habitId: new Types.ObjectId(habitId),
      date: today,
    });
  }

  async getLogsByUser(user: User) {
    return await this.habitLogModel.aggregate<HabitLogSummary>([
      {
        $match: {
          userId: new Types.ObjectId(user._id),
        },
      },
      {
        $lookup: {
          from: 'habits',
          localField: 'habitId',
          foreignField: '_id',
          as: 'habit',
        },
      },
      { $unwind: '$habit' },
      {
        $lookup: {
          from: 'habitusers',
          let: { owner: '$userId', habit: '$habitId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$userId', '$$owner'] },
                    { $eq: ['$habitId', '$$habit'] },
                  ],
                },
              },
            },
          ],
          as: 'definition',
        },
      },
      {
        $project: {
          _id: 1,
          habitId: '$habit._id',
          title: {
            $ifNull: [
              { $arrayElemAt: ['$definition.title', 0] },
              '$habit.title',
            ],
          },
          slug: '$habit.slug',
          date: 1,
          completed: 1,
          amount: 1,
          note: { $ifNull: ['$note', '$$REMOVE'] },
          configurationSnapshot: 1,
        },
      },
      { $sort: { date: -1 } },
    ]);
  }
}
