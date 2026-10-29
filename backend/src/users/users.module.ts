import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * MOD-03 — user management. T01 (list and detail) so far; creation, updates,
 * status changes and role assignment follow in the next roadmap tasks. Relies
 * on the global AuthGuard/PermissionsGuard (AuthModule) and PrismaModule.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
