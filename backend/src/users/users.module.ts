import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * MOD-03 — user management: T01 (list and detail, with the reduced projection
 * of D-R07), T02 (creation), T04 (update), T06 (account status and soft
 * delete) and T07 (role assignment); invitations and password reset live in
 * AccountModule, guardian links in GuardiansModule. Relies on the global
 * guards (AuthModule), PrismaModule and the global AuditModule.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
