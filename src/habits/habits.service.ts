import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { Model } from 'mongoose';
import slugify from 'slugify';

import { CommonService } from 'src/common/common.service';
import { User } from 'src/auth/entities/user.entity';

import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';
import { Habit, HabitUser } from './entities';

@Injectable()
export class HabitsService {
  constructor(
    @InjectModel('Habit')
    private readonly habitModel: Model<Habit>,
    @InjectModel('HabitUser')
    private readonly habitUserModel: Model<HabitUser>,

    private readonly commonService: CommonService,
  ) {}

  async create(createHabitDto: CreateHabitDto, user: User) {
    const slug = slugify(createHabitDto.title, {
      lower: true,
      strict: true,
      trim: true,
    });

    try {
      // 1️⃣ Obtener o crear hábito global
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

      // 2️⃣ Crear o reactivar relación usuario-hábito
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

  // findAll() {
  //   return `This action returns all habits`;
  // }

  // findOne(id: number) {
  //   return `This action returns a #${id} habit`;
  // }

  // update(id: number, updateHabitDto: UpdateHabitDto) {
  //   return `This action updates a #${id} habit`;
  // }

  // remove(id: number) {
  //   return `This action removes a #${id} habit`;
  // }
}
