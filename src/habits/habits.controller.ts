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
import { CompleteHabitDto } from './dto/complete-habit.dto';
import { UpdateHabitLogDto } from './dto/update-habit-log.dto';
import { GetLogsDto } from './dto/get-logs.dto';
import { UpdateHabitUserDto } from './dto/update-habit-user.dto';
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

  @Get('logs')
  @ApiOperation({ summary: 'Obtener todos los logs del usuario' })
  getLogsByUser(@GetUser() user: User) {
    return this.habitsService.getLogsByUser(user);
  }

  @Get(':habitId')
  @ApiOperation({ summary: 'Obtener un hábito del usuario, incluso inactivo' })
  findOne(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @GetUser() user: User,
  ) {
    return this.habitsService.findOneByUser(habitId, user);
  }

  @Patch(':habitId/definition')
  @ApiOperation({ summary: 'Editar la definición personal, incluso inactiva' })
  updateDefinition(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @Body() updateHabitUserDto: UpdateHabitUserDto,
    @GetUser() user: User,
  ) {
    return this.habitsService.updateDefinition(
      habitId,
      updateHabitUserDto,
      user,
    );
  }

  @Patch(':habitId')
  @ApiOperation({ summary: 'Desactivar un hábito (compatibilidad)' })
  update(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @GetUser() user: User,
  ) {
    return this.habitsService.update(habitId, user);
  }

  @Post(':habitId/complete')
  @ApiOperation({ summary: 'Registrar progreso de hoy (total de reemplazo)' })
  complete(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @Body() completeHabitDto: CompleteHabitDto,
    @GetUser() user: User,
  ) {
    return this.habitsService.complete(habitId, user, completeHabitDto);
  }

  @Patch(':habitId/logs/:date')
  @ApiOperation({
    summary: 'Corregir progreso o notas de una fecha del usuario',
  })
  updateLog(
    @Param('habitId', ParseMongoIdPipe) habitId: string,
    @Param('date') date: string,
    @Body() dto: UpdateHabitLogDto,
    @GetUser() user: User,
  ) {
    return this.habitsService.updateLog(habitId, date, dto, user);
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
}
