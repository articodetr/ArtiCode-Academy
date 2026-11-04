import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller.js';
import { BranchesService } from './branches.service.js';

/**
 * MOD-02-T06 (O8) — the branches of the academy (`/api/branches`). Relies on
 * the global guards (AuthModule), PrismaModule and the global AuditModule;
 * reuses the code rule of courses/, the time-zone rule of academy/, the phone
 * rule of users/ and the D1 localized-text DTO of roles/.
 */
@Module({
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
