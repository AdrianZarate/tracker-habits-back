import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { Model, Types } from 'mongoose';
import slugify from 'slugify';

import { CommonService } from 'src/common/common.service';
import { User } from 'src/auth/entities/user.entity';

import { CreateHabitDto } from './dto/create-habit.dto';
import { Habit, HabitLog, HabitUser } from './entities';

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
          title: createHabitDto.title,
          slug,
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
          active: true,
        },
        {
          returnDocument: 'after',
          upsert: true,
          setDefaultsOnInsert: true,
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
          title: '$habit.title',
          slug: '$habit.slug',
        },
      },
    ]);
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
    const today = this.normalizeDate(new Date());

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

  private normalizeDate(date: Date) {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }
}
