import { Module } from '@nestjs/common';
import { FeePlansController } from './fee-plans.controller.js';
import { FeePlansService } from './fee-plans.service.js';
import { ClassInvoicesController, InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';

/**
 * MOD-11 — payments and installments (roadmap §4i): fee plans since T02
 * (`/api/fee-plans`), invoices since T03 (`/api/invoices`,
 * `/api/classes/:id/invoices`); payments and «my invoices» follow in T04/T05.
 * Relies on the global guards, PrismaModule and AuditModule; one error
 * dictionary for the whole module (`finance.errors.ts`).
 */
@Module({
  controllers: [FeePlansController, InvoicesController, ClassInvoicesController],
  providers: [FeePlansService, InvoicesService],
  exports: [FeePlansService, InvoicesService],
})
export class FinanceModule {}
