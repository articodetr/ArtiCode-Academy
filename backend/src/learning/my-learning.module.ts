import { Module } from '@nestjs/common';
import { AutoCertificatesModule } from '../certificates/auto-certificates.module.js';
import { MyLearningController } from './my-learning.controller.js';
import { MyLearningService } from './my-learning.service.js';

/**
 * MOD-20 «My School» (roadmap §4q): the learner's own workspace and progress —
 * API-229..234 (`/api/me/learning`). Ownership, no permission key (D-R132);
 * relies on the global guards (AuthModule) and PrismaModule; reuses the
 * ownership rule of lessons/my-lessons.policy.ts and the shared MOD-20 core
 * (learning.content/progress/curriculum/read.ts). No audit event (D-R139).
 */
@Module({
  imports: [AutoCertificatesModule],
  controllers: [MyLearningController],
  providers: [MyLearningService],
})
export class MyLearningModule {}
