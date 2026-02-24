import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { HabitsService } from './habits.service';
import { CreateHabitDto } from './dto/create-habit.dto';
import { Auth, GetUser } from 'src/auth/decorators';
import { User } from 'src/auth/entities/user.entity';
import { ParseMongoIdPipe } from 'src/common/pipes/parse-mongo-id.pipe';

@Controller('habits')
export class HabitsController {
  constructor(private readonly habitsService: HabitsService) {}

  @Post()
  @Auth()
  create(@Body() createHabitDto: CreateHabitDto, @GetUser() user: User) {
    return this.habitsService.create(createHabitDto, user);
  }

  @Get()
  @Auth()
  findAll(@GetUser() user: User) {
    return this.habitsService.findAllByUser(user);
  }

  @Patch(':habitId')
  @Auth()
  update(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @GetUser() user: User,
  ) {
    return this.habitsService.update(habitId, user);
  }

  @Post(':habitId/complete')
  @Auth()
  complete(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @GetUser() user: User,
  ) {
    return this.habitsService.complete(habitId, user);
  }
}
