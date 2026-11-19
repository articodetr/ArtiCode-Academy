import { Module } from '@nestjs/common';
import { EnrollmentsModule } from '../enrollments/enrollments.module.js';
import { CatalogController, MyEnrollmentRequestsController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

/**
 * MOD-19 — the course catalog, self-service enrollment and the student's own
 * requests (roadmap §4p, ADR-077). The writes go through the enrollment
 * request writer of EnrollmentsModule, so the office's API-058 and the
 * student's API-221 share one rule set.
 */
@Module({
  imports: [EnrollmentsModule],
  controllers: [CatalogController, MyEnrollmentRequestsController],
  providers: [CatalogService],
})
export class CatalogModule {}
