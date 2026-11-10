import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { INVOICE_READ_PERMISSIONS, INVOICES_MANAGE_PERMISSION, missingAny } from './finance.policy.js';
import {
  ChangeInvoiceStatusDto,
  ClassInvoicesResultDto,
  CreateInvoiceDto,
  InvoiceDto,
  InvoiceListDto,
  IssueClassInvoicesDto,
  ListInvoicesQueryDto,
  UpdateInvoiceDto,
} from './invoices.dto.js';
import { InvoicesService } from './invoices.service.js';

const READ_DENIED = 'permission_denied — `{ missing: ["invoices.read_all", "invoices.manage", "payments.record"] }` (any one suffices)';
const MANAGE_DENIED = 'permission_denied — `invoices.manage`; origin_forbidden';
const INVOICE_RULES =
  'invoice_invalid — `{ problems }`: no_lines, no_installments, installments_sum, due_dates_not_ascending, installment_not_positive, discount_exceeds_subtotal, discount_reason_without_discount, total_zero, plan_with_lines, lines_required';

/**
 * MOD-11-T03 — invoices (roadmap §4i.4 API-144..API-149; D-R59..D-R62,
 * D-R64, D-R65). Reading needs `invoices.read_all`, `invoices.manage` or
 * `payments.record` (any one — checked here, the guard needs every listed
 * key); writing needs `invoices.manage`.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('invoices')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions()
  @ApiOperation({
    summary: 'List invoices',
    description:
      'Newest first, keyset `cursor`/`nextCursor`. ANDed filters `studentId`, `enrollmentId`, `classId` (the enrollments of a class), `feePlanId`, `status`, `balance` (unpaid|partial|paid — issued invoices), `overdue` (true|false — an issued invoice with an installment due before today in the academy zone and not covered), `q` (part of the number). Needs `invoices.read_all`, `invoices.manage` or `payments.record`.',
  })
  @ApiOkResponse({ type: InvoiceListDto })
  @ApiBadRequestResponse({ description: 'Validation failed | cursor_invalid' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: READ_DENIED })
  list(@Query() query: ListInvoicesQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<InvoiceListDto> {
    const missing = missingAny(caller.permissions, INVOICE_READ_PERMISSIONS);
    if (missing) throw authError.permissionDenied(missing);
    return this.invoices.list(query);
  }

  @Get(':id')
  @RequirePermissions()
  @ApiOperation({
    summary: 'Read an invoice',
    description: 'With its lines, its installments (paid, remaining, status and overdue computed from the paid amount, oldest first — D-R62) and its payments, newest first. Same keys as the list.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: InvoiceDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: READ_DENIED })
  @ApiNotFoundResponse({ description: 'invoice_not_found' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<InvoiceDto> {
    const missing = missingAny(caller.permissions, INVOICE_READ_PERMISSIONS);
    if (missing) throw authError.permissionDenied(missing);
    return this.invoices.get(id);
  }

  @Post()
  @RequirePermissions(INVOICES_MANAGE_PERMISSION)
  @ApiOperation({
    summary: 'Create a draft invoice',
    description:
      'For a user holding the student role, optionally tied to one of their enrollments. Either `feePlanId` (an active plan — its lines are copied and its shares split the total from today in the academy zone, the remainder on the last part; a plan of another course or class than the enrollment is refused) or `lines` + `installments` (summing to the total, due days not decreasing). One optional discount with its reason. The currency is the academy currency. One `invoices.created` event.',
  })
  @ApiCreatedResponse({ type: InvoiceDto })
  @ApiBadRequestResponse({ description: `Validation failed | ${INVOICE_RULES}` })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: MANAGE_DENIED })
  @ApiNotFoundResponse({ description: 'student_not_found | fee_plan_not_found' })
  @ApiConflictResponse({ description: 'fee_plan_inactive' })
  @ApiUnprocessableEntityResponse({ description: 'enrollment_mismatch | fee_plan_mismatch' })
  @ApiServiceUnavailableResponse({ description: 'academy_not_configured' })
  create(@Body() body: CreateInvoiceDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<InvoiceDto> {
    return this.invoices.create(body, caller, requestContext(req));
  }

  @Patch(':id')
  @RequirePermissions(INVOICES_MANAGE_PERMISSION)
  @ApiOperation({
    summary: 'Update a draft invoice',
    description:
      'A draft only. Smallest change; `null` clears the enrollment, the discount reason or the notes; lines and installments are replaced whole, and the draft must stay valid (send the installments with a changed total). One `invoices.updated { fields }` event; no difference = no write, no event.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: InvoiceDto })
  @ApiBadRequestResponse({ description: `Validation failed | nothing_to_update | ${INVOICE_RULES}` })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: MANAGE_DENIED })
  @ApiNotFoundResponse({ description: 'invoice_not_found' })
  @ApiConflictResponse({ description: 'invoice_not_draft — `{ status }`' })
  @ApiUnprocessableEntityResponse({ description: 'enrollment_mismatch' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateInvoiceDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<InvoiceDto> {
    return this.invoices.update(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(INVOICES_MANAGE_PERMISSION)
  @ApiOperation({ summary: 'Delete a draft invoice', description: 'A draft only (an issued invoice is cancelled instead). One `invoices.deleted` event.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: MANAGE_DENIED })
  @ApiNotFoundResponse({ description: 'invoice_not_found' })
  @ApiConflictResponse({ description: 'invoice_not_draft — `{ status }`' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.invoices.remove(id, caller, requestContext(req));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(INVOICES_MANAGE_PERMISSION)
  @ApiOperation({
    summary: 'Issue or cancel an invoice',
    description:
      '`issue`: draft → issued — the rules are checked again and the number `INV-YYYY-NNNNN` is reserved from `number_sequences` (the year in the academy zone); its lines and installments are frozen. `cancel`: issued → cancelled with a required `reason`, refused while a completed payment stands (reverse it first). Under the invoice-row lock. One `invoices.issued` or `invoices.cancelled` event.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: InvoiceDto })
  @ApiBadRequestResponse({ description: `Validation failed (a cancel without reason) | ${INVOICE_RULES}` })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: MANAGE_DENIED })
  @ApiNotFoundResponse({ description: 'invoice_not_found' })
  @ApiConflictResponse({ description: 'invalid_transition — `{ from, action, allowed }` | invoice_has_payments — `{ paymentCount }`' })
  @ApiServiceUnavailableResponse({ description: 'academy_not_configured' })
  changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeInvoiceStatusDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<InvoiceDto> {
    return this.invoices.changeStatus(id, body, caller, requestContext(req));
  }
}

/** MOD-11-T03 — API-150: one invoice from a plan for every active enrollment of a class (D-R60). */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('classes')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class ClassInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post(':id/invoices')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(INVOICES_MANAGE_PERMISSION)
  @ApiOperation({
    summary: "Invoice a class's enrollments from a fee plan",
    description:
      'For every `active` enrollment of the class without a non-cancelled invoice from the same plan (others are `skipped` with their reason): drafts, or issued at once with consecutive numbers when `issue` is true. The plan must be active and price this class, its course, or no course or class. Under the class-row lock. One `invoices.batch_created` event on the class; nothing to create = 200 without write or event.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiOkResponse({ type: ClassInvoicesResultDto })
  @ApiBadRequestResponse({ description: `Validation failed | ${INVOICE_RULES}` })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: MANAGE_DENIED })
  @ApiNotFoundResponse({ description: 'class_not_found | fee_plan_not_found' })
  @ApiConflictResponse({ description: 'fee_plan_inactive' })
  @ApiUnprocessableEntityResponse({ description: 'fee_plan_mismatch — `{ feePlanId, classId }`' })
  @ApiServiceUnavailableResponse({ description: 'academy_not_configured' })
  issueForClass(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: IssueClassInvoicesDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<ClassInvoicesResultDto> {
    return this.invoices.issueForClass(id, body, caller, requestContext(req));
  }
}
