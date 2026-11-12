import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { GradeSchemesController } from './grade-schemes.controller.js';
import { GradeSchemesService } from './grade-schemes.service.js';
import { GradebookController } from './gradebook.controller.js';
import { GradebookService } from './gradebook.service.js';
import { MyGradesController } from './my-grades.controller.js';
import { MyGradesService } from './my-grades.service.js';

/**
 * MOD-09 — grades (roadmap §4h): grade schemes since T02 (`/api/grade-schemes`),
 * the gradebook and the final grades of a class since T05
 * (`/api/classes/:id/gradebook`, `/api/classes/:id/final-grades`) and «my
 * grades» since T06 (`/api/me/grades` — ownership + grades.read_own|read_linked). Relies on the
 * global guards (AuthModule), PrismaModule and the global AuditModule; reuses
 * the D1 localized-text DTO of roles/ and the raw-body transforms of courses/.
 * The MOD-09 error dictionary (`grades.errors.ts`) also serves exams/. Since
 * MOD-12-T03 a finalization tells the students whose final grade it created
 * or changed, through the NotificationsService of NotificationsModule.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [GradeSchemesController, GradebookController, MyGradesController],
  providers: [GradeSchemesService, GradebookService, MyGradesService],
  exports: [GradeSchemesService, GradebookService],
})
export class GradesModule {}
