import { Module } from '@nestjs/common';
import { AcademiesController } from './academies.controller.js';
import { AcademiesService } from './academies.service.js';
import { DomainsController } from './domains.controller.js';
import { DomainsService } from './domains.service.js';
import { PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';
import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';

/**
 * MOD-18-T04 — the academies registry of the platform (API-183..195): academies
 * and their lifecycle, domains, plans and subscriptions. PlatformPrismaService
 * and PlatformAuditService come from their global modules; the guards
 * (OriginGuard → PlatformAuthGuard → PlatformRolesGuard) are global too.
 */
@Module({
  controllers: [AcademiesController, DomainsController, PlansController, SubscriptionsController],
  providers: [AcademiesService, DomainsService, PlansService, SubscriptionsService],
})
export class PlatformRegistryModule {}
