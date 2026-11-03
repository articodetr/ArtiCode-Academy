import { Module } from '@nestjs/common';
import { ClassTeachersController } from './class-teachers.controller.js';
import { ClassTeachersService } from './class-teachers.service.js';
import { ClassesController } from './classes.controller.js';
import { ClassesService } from './classes.service.js';

/**
 * MOD-05 — classes (`/api/classes`, T02). Relies on the global guards
 * (AuthModule), PrismaModule and the global AuditModule; the MOD-05 error
 * dictionary (classes.errors.ts) and permission keys (classes.policy.ts) live
 * next to it and already cover T03 (teachers) and T04 (enrollments).
 */
@Module({
  // MOD-05-T03 (CH-0054): PUT /api/classes/:id/teachers in its own controller/service.
  controllers: [ClassesController, ClassTeachersController],
  providers: [ClassesService, ClassTeachersService],
  exports: [ClassesService],
})
export class ClassesModule {}
