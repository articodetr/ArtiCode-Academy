import { Module } from '@nestjs/common';
import { GradesModule } from '../grades/grades.module.js';
import { ClassCertificatesController } from './certificates.controller.js';
import { CertificatesService } from './certificates.service.js';

/**
 * MOD-10 — certificates (roadmap §4h.10): issuing and the class preview since
 * T02 (`/api/classes/:id/certificates`). Reads the final grades through the
 * exported GradebookService of GradesModule (the same computation and the same
 * class-row lock); relies on the global guards, PrismaModule and AuditModule.
 */
@Module({
  imports: [GradesModule],
  controllers: [ClassCertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
