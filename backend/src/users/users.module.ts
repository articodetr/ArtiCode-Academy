import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * MOD-03 — user management: T01 (list and detail, with the reduced projection
 * of D-R07), T02 (creation), T04 (update), T06 (account status and soft
 * delete) and T07 (role assignment), plus MFA-T04 (the administrative reset
 * of two-step verification, API-212); invitations and password reset live in
 * AccountModule, guardian links in GuardiansModule. Imports AuthModule for
 * MfaCore (it also registers the global guards); relies on PrismaModule and
 * the global AuditModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
