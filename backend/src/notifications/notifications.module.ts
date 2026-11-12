import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { AnnouncementsController } from './announcements.controller.js';
import { AnnouncementsService } from './announcements.service.js';
import { MyNotificationsController } from './my-notifications.controller.js';
import { MyNotificationsService } from './my-notifications.service.js';
import { NotificationDispatcher } from './notifications.dispatcher.js';
import { NotificationsService } from './notifications.service.js';

/**
 * MOD-12 — notifications (roadmap §4j; owner decisions D-R79..D-R86; ADR-071).
 * T02: the engine (`NotificationsService.notifyStudents()` / `notifyClass()`
 * called by the writer services inside their transactions, and the in-process
 * `NotificationDispatcher` that e-mails after commit), «my notifications» and
 * the e-mail preferences (API-167..172). The writers of MOD-06..MOD-11 import
 * this module and call the service in T03/T04. T05: manual announcements
 * (`AnnouncementsController` / `AnnouncementsService`, API-173..175) — they
 * write their notifications themselves, in the engine's way, and hand the
 * e-mail copies to the same dispatcher. Relies on the global guards
 * (AuthModule), PrismaModule and the global AuditModule; the class visibility
 * rule of classes/classes.policy.ts (D-R16) is a pure function, so no feature
 * module is imported — the writers import this one.
 */
@Module({
  imports: [MailModule],
  controllers: [MyNotificationsController, AnnouncementsController],
  providers: [NotificationsService, NotificationDispatcher, MyNotificationsService, AnnouncementsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
