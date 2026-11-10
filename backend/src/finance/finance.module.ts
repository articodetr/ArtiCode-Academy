import { Module } from '@nestjs/common';
import { FeePlansController } from './fee-plans.controller.js';
import { FeePlansService } from './fee-plans.service.js';

/**
 * MOD-11 — payments and installments (roadmap §4i): fee plans since T02
 * (`/api/fee-plans`); invoices, payments and «my invoices» follow in T03..T05.
 * Relies on the global guards, PrismaModule and AuditModule; one error
 * dictionary for the whole module (`finance.errors.ts`).
 */
@Module({
  controllers: [FeePlansController],
  providers: [FeePlansService],
  exports: [FeePlansService],
})
export class FinanceModule {}
