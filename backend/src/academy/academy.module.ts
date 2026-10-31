import { Module } from '@nestjs/common';
import { AcademyController } from './academy.controller.js';
import { AcademyService } from './academy.service.js';

/**
 * MOD-02/MOD-14 minimum — the single `academy` row: `GET /api/academy` and
 * `PATCH /api/academy`. Relies on the global guards (AuthModule), PrismaModule
 * and the global AuditModule; reuses the D1 localized-text DTO of roles/ and
 * the PATCH normalisers of users/.
 */
@Module({
  controllers: [AcademyController],
  providers: [AcademyService],
  exports: [AcademyService],
})
export class AcademyModule {}
