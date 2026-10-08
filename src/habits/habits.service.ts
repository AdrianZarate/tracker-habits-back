import {
  BadRequestException,
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
import { GetLogsDto } from './dto/get-logs.dto';
import { UpdateHabitUserDto } from './dto/update-habit-user.dto';
import { Habit, HabitLog, HabitUser } from './entities';

/** Shape produced by the global-habit lookup and log projection below. */
type HabitLogSummary = Pick<HabitLog, 'date' | 'completed'> &
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
        this.personalUpdate(createHabitDto, true),
        {
          returnDocument: 'after',
          upsert: true,
          setDefaultsOnInsert: true,
          runValidators: true,
        },
      );

      return habitUser.toObject();
    } catch (error) {
      this.commonService.handleExceptions(error, 'Habit');
    }
  }

  async findAllByUser(user: User) {
    return this.habitUserModel.aggregate([
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
        },
      },
    ]);
  }

  async findOneByUser(habitId: string, user: User) {
    const habitUser = await this.habitUserModel
      .findOne({ userId: user._id, habitId: new Types.ObjectId(habitId) })
      .lean();

    if (!habitUser) {
      throw new NotFoundException('Habit not found for this user');
    }

    return this.personalView(habitUser);
  }

  private async personalView(
    habitUser: Pick<
      HabitUser,
      'habitId' | 'active' | 'title' | 'category' | 'color' | 'icon'
    >,
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
    const update = this.personalUpdate(dto);
    if (!Object.keys(update).length) return this.findOneByUser(habitId, user);
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
    return this.personalView(habitUser);
  }

  async update(habitId: string, user: User) {
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

    return habitUser;
  }

  async complete(habitId: string, user: User) {
    const today = this.todayAnchor(user);

    // 1️ Verificar que el hábito pertenece al usuario y está activo
    const habitUser = await this.habitUserModel
      .findOne({
        userId: user._id,
        habitId: new Types.ObjectId(habitId),
        active: true,
      })
      .lean();

    if (!habitUser) {
      throw new NotFoundException('Habit not active for this user');
    }

    // 2️ Upsert para evitar duplicados
    const habitLog = await this.habitLogModel
      .findOneAndUpdate(
        {
          userId: user._id,
          habitId: new Types.ObjectId(habitId),
          date: today,
        },
        {
          completed: true,
        },
        {
          upsert: true,
          returnDocument: 'after',
        },
      )
      .lean()
      .exec();

    return habitLog;
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
        },
      },
      { $sort: { date: -1 } },
    ]);
  }
}
