import { Module } from '@nestjs/common';
import { GuardiansController } from './guardians.controller.js';
import { GuardiansService } from './guardians.service.js';

/**
 * MOD-03-T09 — guardian ↔ student links under the user resource:
 * `GET /api/users/:studentId/guardians`, `GET /api/users/:guardianId/students`,
 * `POST /api/users/:studentId/guardians`, `PATCH`/`DELETE
 * /api/users/:studentId/guardians/:guardianId`. Relies on the global guards
 * (AuthModule), PrismaModule and the global AuditModule; reuses the MOD-03
 * error dictionary, the projection rule (D-R07) and the no-exceeding rule of
 * users/.
 */
@Module({
  controllers: [GuardiansController],
  providers: [GuardiansService],
  exports: [GuardiansService],
})
export class GuardiansModule {}
