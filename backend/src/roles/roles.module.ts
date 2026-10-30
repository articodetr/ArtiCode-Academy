import { Module } from '@nestjs/common';
import { PermissionsController } from './permissions.controller.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';

/**
 * MOD-03-T08 — roles and permissions: `GET /api/roles`, `GET /api/permissions`,
 * `POST /api/roles`, `PATCH /api/roles/:id`, `DELETE /api/roles/:id`. Relies on
 * the global guards (AuthModule), PrismaModule and the global AuditModule;
 * reuses the MOD-03 error dictionary and the no-exceeding rule of users/.
 */
@Module({
  controllers: [RolesController, PermissionsController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
