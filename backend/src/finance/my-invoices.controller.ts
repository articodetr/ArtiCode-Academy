import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { ListMyInvoicesQueryDto, MyInvoiceListDto } from './my-invoices.dto.js';
import { myInvoicesMissing } from './my-invoices.policy.js';
import { MyInvoicesService } from './my-invoices.service.js';

/**
 * MOD-11-T05 — the caller's invoices (API-155; D-R65). No key at the guard
 * (either of two keys suffices): the controller refuses a caller who holds
 * neither `invoices.read_own` nor `invoices.read_linked`.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('me')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class MyInvoicesController {
  constructor(private readonly myInvoices: MyInvoicesService) {}

  @Get('invoices')
  @RequirePermissions()
  @ApiOperation({
    summary: 'List my invoices',
    description:
      'The caller’s own invoices with `invoices.read_own` (`relation: self`) and — while the caller holds the `guardian` role — their linked, not soft-deleted children’s with `invoices.read_linked` (`relation: child`); issued and cancelled, newest first, ' +
      'with the lines, the installments (paid, remaining, overdue — computed) and the valid receipts; never the internal note, the issuer, the fee plan, a recorder or a reversed payment. Filters `studentId`, `classId`, `status`; no pagination.',
  })
  @ApiOkResponse({ type: MyInvoiceListDto })
  @ApiBadRequestResponse({ description: 'Validation failed (a `draft` status filter included)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `{ missing: ["invoices.read_own", "invoices.read_linked"] }` (either one suffices)' })
  list(@Query() query: ListMyInvoicesQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<MyInvoiceListDto> {
    const missing = myInvoicesMissing(caller.permissions);
    if (missing) throw authError.permissionDenied(missing);
    return this.myInvoices.list(query, caller);
  }
}
