import { Module } from '@nestjs/common';
import { FeePlansController } from './fee-plans.controller.js';
import { FeePlansService } from './fee-plans.service.js';
import { ClassInvoicesController, InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoicePaymentsController, PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

/**
 * MOD-11 — payments and installments (roadmap §4i): fee plans since T02
 * (`/api/fee-plans`), invoices since T03 (`/api/invoices`,
 * `/api/classes/:id/invoices`), payments and receipts since T04
 * (`/api/invoices/:id/payments`, `/api/payments`); «my invoices» follows in
 * T05. Relies on the global guards, PrismaModule and AuditModule; one error
 * dictionary for the whole module (`finance.errors.ts`).
 */
@Module({
  controllers: [FeePlansController, InvoicesController, ClassInvoicesController, InvoicePaymentsController, PaymentsController],
  providers: [FeePlansService, InvoicesService, PaymentsService],
  exports: [FeePlansService, InvoicesService, PaymentsService],
})
export class FinanceModule {}
