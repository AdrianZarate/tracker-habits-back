import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Delete,
  Param,
  Query,
} from '@nestjs/common';
import { HabitsService } from './habits.service';
import { CreateHabitDto } from './dto/create-habit.dto';
import { GetLogsDto } from './dto/get-logs.dto';
import { Auth, GetUser } from 'src/auth/decorators';
import { User } from 'src/auth/entities/user.entity';
import { ParseMongoIdPipe } from 'src/common/pipes/parse-mongo-id.pipe';

@Auth()
@Controller('habits')
export class HabitsController {
  constructor(private readonly habitsService: HabitsService) {}

  @Post()
  create(@Body() createHabitDto: CreateHabitDto, @GetUser() user: User) {
    return this.habitsService.create(createHabitDto, user);
  }

  @Get()
  findAll(@GetUser() user: User) {
    return this.habitsService.findAllByUser(user);
  }

  @Patch(':habitId')
  update(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @GetUser() user: User,
  ) {
    return this.habitsService.update(habitId, user);
  }

  @Post(':habitId/complete')
  complete(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @GetUser() user: User,
  ) {
    return this.habitsService.complete(habitId, user);
  }

  @Get(':habitId/logs')
  getLogs(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @Query() getLogsDto: GetLogsDto,
    @GetUser() user: User,
  ) {
    return this.habitsService.getLogs(habitId, user, getLogsDto);
  }

  @Delete(':habitId/incomplete')
  incomplete(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @GetUser() user: User,
  ) {
    return this.habitsService.deleteHabitLog(habitId, user);
  }

  @Get('logs')
  getLogsByUser(@GetUser() user: User) {
    return this.habitsService.getLogsByUser(user);
  }
}
