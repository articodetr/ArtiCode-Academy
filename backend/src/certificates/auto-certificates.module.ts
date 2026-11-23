import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AutoCertificatesService } from './auto-certificates.service.js';

/**
 * CH-0363 — the automatic course-completion certificate. A module of its own,
 * so «My School» and the attendance sheet can use it without importing the
 * grades chain of CertificatesModule.
 */
@Module({
  imports: [NotificationsModule],
  providers: [AutoCertificatesService],
  exports: [AutoCertificatesService],
})
export class AutoCertificatesModule {}
