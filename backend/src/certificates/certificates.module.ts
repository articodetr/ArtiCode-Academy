import { Module } from '@nestjs/common';
import { GradesModule } from '../grades/grades.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CertificateVerificationController, CertificatesController } from './certificates-read.controller.js';
import { ClassCertificatesController } from './certificates.controller.js';
import { CertificatesService } from './certificates.service.js';
import { MyCertificatesController } from './my-certificates.controller.js';
import { MyCertificatesService } from './my-certificates.service.js';

/**
 * MOD-10 — certificates (roadmap §4h.10): issuing and the class preview since
 * T02 (`/api/classes/:id/certificates`); listing, reading, revoking and the
 * public verification since T03 (`/api/certificates`, `/api/certificates/verify/:code`). Reads the final grades through the
 * exported GradebookService of GradesModule (the same computation and the same
 * class-row lock); relies on the global guards, PrismaModule and AuditModule.
 * Since MOD-12-T03 issuing and revoking tell the student and their guardians
 * through the NotificationsService of NotificationsModule.
 */
@Module({
  imports: [GradesModule, NotificationsModule],
  controllers: [ClassCertificatesController, CertificatesController, CertificateVerificationController, MyCertificatesController],
  providers: [CertificatesService, MyCertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
