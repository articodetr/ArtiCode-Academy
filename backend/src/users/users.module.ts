import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * MOD-03 — user management. T01 (list and detail, with the reduced projection
 * of D-R07) and T02 (creation) so far; invitations, updates, status changes
 * and role assignment follow in the next roadmap tasks. Relies on the global
 * guards (AuthModule), PrismaModule and the global AuditModule.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
