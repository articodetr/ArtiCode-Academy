import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { INVOICE_READ_PERMISSIONS, PAYMENTS_RECORD_PERMISSION, PAYMENTS_REFUND_PERMISSION, missingAny } from './finance.policy.js';
import { ListPaymentsQueryDto, PaymentDto, PaymentListDto, RecordPaymentDto, ReversePaymentDto } from './payments.dto.js';
import { PaymentsService } from './payments.service.js';

const READ_DENIED = 'permission_denied — `{ missing: ["invoices.read_all", "invoices.manage", "payments.record"] }` (any one suffices)';
const UNAUTHORIZED = 'unauthenticated | token_expired | token_invalid | session_invalid';

/** MOD-11-T04 — API-151: record a payment on an issued invoice (D-R63). */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('invoices')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class InvoicePaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/payments')
  @RequirePermissions(PAYMENTS_RECORD_PERMISSION)
  @ApiOperation({
    summary: 'Record a payment',
    description:
      'A manual payment of an issued invoice, at most its balance, in the invoice currency; the receipt number `RCPT-YYYY-NNNNN` comes from `number_sequences` (the year in the academy zone). `paidAt` defaults to now and is never in the future. Under the invoice-row lock — two payments at once never exceed the balance. The invoice paid amount follows in the same transaction. One `payments.recorded` event.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The invoice' })
  @ApiCreatedResponse({ type: PaymentDto })
  @ApiBadRequestResponse({ description: 'Validation failed (amount, method, paidAt not an instant or in the future)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `payments.record`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'invoice_not_found' })
  @ApiConflictResponse({ description: 'invoice_not_issued — `{ status }` | payment_exceeds_balance — `{ amount, balance }`' })
  @ApiServiceUnavailableResponse({ description: 'academy_not_configured' })
  record(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: RecordPaymentDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<PaymentDto> {
    return this.payments.record(id, body, caller, requestContext(req));
  }
}

/** MOD-11-T04 — API-152..API-154: receipts and their reversal (D-R63, D-R65). */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('payments')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions()
  @ApiOperation({
    summary: 'List payments',
    description:
      'Newest first (creation order), keyset `cursor`/`nextCursor`. ANDed filters `invoiceId`, `studentId`, `method`, `status` (completed|reversed), `from` ≤ paidAt < `to` (ISO 8601 with an offset), `q` (part of the receipt number). Each item carries its invoice as it stands now. Needs `invoices.read_all`, `invoices.manage` or `payments.record`.',
  })
  @ApiOkResponse({ type: PaymentListDto })
  @ApiBadRequestResponse({ description: 'Validation failed | cursor_invalid' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: READ_DENIED })
  list(@Query() query: ListPaymentsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<PaymentListDto> {
    const missing = missingAny(caller.permissions, INVOICE_READ_PERMISSIONS);
    if (missing) throw authError.permissionDenied(missing);
    return this.payments.list(query);
  }

  @Get(':id')
  @RequirePermissions()
  @ApiOperation({ summary: 'Read a receipt', description: 'The payment with its invoice (total, paid, balance now) and its student. Same keys as the list.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PaymentDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: READ_DENIED })
  @ApiNotFoundResponse({ description: 'payment_not_found' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<PaymentDto> {
    const missing = missingAny(caller.permissions, INVOICE_READ_PERMISSIONS);
    if (missing) throw authError.permissionDenied(missing);
    return this.payments.get(id);
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PAYMENTS_REFUND_PERMISSION)
  @ApiOperation({
    summary: 'Reverse a payment',
    description:
      'completed → reversed, for good, with a required `reason`; the payment stays on record and its amount leaves the invoice paid amount. Under the invoice-row lock. One `payments.reversed` event.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PaymentDto })
  @ApiBadRequestResponse({ description: 'Validation failed (reason)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `payments.refund`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'payment_not_found' })
  @ApiConflictResponse({ description: 'payment_reversed — `{ paymentId, reversedAt }`' })
  reverse(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ReversePaymentDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<PaymentDto> {
    return this.payments.reverse(id, body, caller, requestContext(req));
  }
}
