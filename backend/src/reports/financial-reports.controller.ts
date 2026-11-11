import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CollectionsReportDto,
  FinancialCollectionsQueryDto,
  FinancialReceivablesQueryDto,
  FinancialRevenueQueryDto,
  ReceivablesReportDto,
  RevenueReportDto,
} from './financial-reports.dto.js';
import { FinancialReportsService } from './financial-reports.service.js';
import { REPORTS_FINANCIAL_PERMISSION } from './reports.policy.js';

/**
 * MOD-13-T03 — financial reports (API-161..163). `reports.financial.view`
 * (academy_admin and staff by seed), academy-wide; read-only, never audited.
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports/financial')
@RequirePermissions(REPORTS_FINANCIAL_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `{ missing: ["reports.financial.view"] }`' })
@ApiBadRequestResponse({ description: '`report_range_invalid { from, to, maxDays }` or a validation failure' })
export class FinancialReportsController {
  constructor(private readonly reports: FinancialReportsService) {}

  @Get('collections')
  @ApiOperation({
    summary: 'Collections',
    description:
      'Completed payments paid in the period, by month (the academy’s zone), method and currency, with the reversed ones apart and totals per currency. Filters `method`, `courseId`, `classId` (through the invoice’s enrollment).',
  })
  @ApiOkResponse({ type: CollectionsReportDto })
  collections(@Query() query: FinancialCollectionsQueryDto): Promise<CollectionsReportDto> {
    return this.reports.collections(query);
  }

  @Get('receivables')
  @ApiOperation({
    summary: 'Receivables and arrears',
    description:
      'As of today: per (student × currency) with an issued invoice and a balance — total, paid, balance, the overdue part (the paid amount covers the oldest installment first), the oldest overdue day and the aging of the overdue amount (1–30, 31–60, 61–90, 91+ days). Filters `courseId`, `classId`, `overdueOnly`; no period.',
  })
  @ApiOkResponse({ type: ReceivablesReportDto })
  receivables(@Query() query: FinancialReceivablesQueryDto): Promise<ReceivablesReportDto> {
    return this.reports.receivables(query);
  }

  @Get('revenue')
  @ApiOperation({
    summary: 'Revenue by course',
    description:
      'Per course × month × currency: the invoices issued in the month and not cancelled (count, totals, discounts) and the completed payments paid in the month on them; invoices without an enrollment have no course. Filter `courseId`.',
  })
  @ApiOkResponse({ type: RevenueReportDto })
  revenue(@Query() query: FinancialRevenueQueryDto): Promise<RevenueReportDto> {
    return this.reports.revenue(query);
  }
}
