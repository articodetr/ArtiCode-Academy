import { Module } from '@nestjs/common';
import { EnrollmentsModule } from '../enrollments/enrollments.module.js';
import { CatalogController, MyEnrollmentRequestsController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { PublicCatalogController } from './public-catalog.controller.js';
import { PublicCatalogService } from './public-catalog.service.js';

/**
 * MOD-19 — the course catalog, self-service enrollment and the student's own
 * requests (roadmap §4p, ADR-077). The writes go through the enrollment
 * request writer of EnrollmentsModule, so the office's API-058 and the
 * student's API-221 share one rule set. MOD-20 (D-R138) adds the public
 * catalog for visitors (API-236/237), on the same query and price rules.
 */
@Module({
  imports: [EnrollmentsModule],
  controllers: [CatalogController, MyEnrollmentRequestsController, PublicCatalogController],
  providers: [CatalogService, PublicCatalogService],
})
export class CatalogModule {}
