import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { RequirePermissions } from '../auth/decorators.js';
import { PermissionCatalogDto } from './roles.dto.js';
import { MANAGE_ROLES_PERMISSION } from './roles.policy.js';
import { RolesService } from './roles.service.js';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('permissions')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `roles.manage`' })
export class PermissionsController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(MANAGE_ROLES_PERMISSION)
  @ApiOperation({
    summary: 'Permission catalog',
    description:
      'The active permission keys (deprecated ones excluded) with their localized descriptions, grouped by owning module in catalog order — the choices offered when editing a role. Requires `roles.manage`.',
  })
  @ApiOkResponse({ type: PermissionCatalogDto })
  list(): Promise<PermissionCatalogDto> {
    return this.roles.listPermissions();
  }
}
