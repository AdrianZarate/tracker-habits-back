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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HabitsService } from './habits.service';
import { CreateHabitDto } from './dto/create-habit.dto';
import { GetLogsDto } from './dto/get-logs.dto';
import { Auth, GetUser } from 'src/auth/decorators';
import { User } from 'src/auth/entities/user.entity';
import { ParseMongoIdPipe } from 'src/common/pipes/parse-mongo-id.pipe';

@ApiTags('Hábitos')
@ApiBearerAuth('JWT-auth')
@Auth()
@Controller('habits')
export class HabitsController {
  constructor(private readonly habitsService: HabitsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un nuevo hábito' })
  create(@Body() createHabitDto: CreateHabitDto, @GetUser() user: User) {
    return this.habitsService.create(createHabitDto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los hábitos del usuario' })
  findAll(@GetUser() user: User) {
    return this.habitsService.findAllByUser(user);
  }

  @Patch(':habitId')
  @ApiOperation({ summary: 'Actualizar un hábito' })
  update(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @GetUser() user: User,
  ) {
    return this.habitsService.update(habitId, user);
  }

  @Post(':habitId/complete')
  @ApiOperation({ summary: 'Marcar hábito como completado' })
  complete(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @GetUser() user: User,
  ) {
    return this.habitsService.complete(habitId, user);
  }

  @Get(':habitId/logs')
  @ApiOperation({ summary: 'Obtener logs de un hábito específico' })
  getLogs(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @Query() getLogsDto: GetLogsDto,
    @GetUser() user: User,
  ) {
    return this.habitsService.getLogs(habitId, user, getLogsDto);
  }

  @Delete(':habitId/incomplete')
  @ApiOperation({ summary: 'Eliminar el registro de hábito completado' })
  incomplete(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @GetUser() user: User,
  ) {
    return this.habitsService.deleteHabitLog(habitId, user);
  }

  @Get('logs')
  @ApiOperation({ summary: 'Obtener todos los logs del usuario' })
  getLogsByUser(@GetUser() user: User) {
    return this.habitsService.getLogsByUser(user);
  }
}
