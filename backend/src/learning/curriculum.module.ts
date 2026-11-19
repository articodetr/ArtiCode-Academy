import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CurriculumController } from './curriculum.controller.js';
import { CurriculumService } from './curriculum.service.js';

/**
 * MOD-20 «My School» (roadmap §4q): the course curriculum for authors —
 * API-226..228 (`/api/courses/:id/curriculum`). Relies on the global guards
 * (AuthModule), PrismaModule and the global AuditModule; the MOD-04 error
 * dictionary and permission keys come from courses/, the MOD-20 ones from
 * learning.errors.ts. Imports NotificationsModule (LRN-T06, D-R146): an
 * API-227 write that publishes lessons tells the open and running classes of
 * the course (`curriculum.lessons_published`).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [CurriculumController],
  providers: [CurriculumService],
  exports: [CurriculumService],
})
export class CurriculumModule {}
