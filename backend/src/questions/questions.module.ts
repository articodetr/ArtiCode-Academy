import { Module } from '@nestjs/common';
import { QuestionBanksService } from './question-banks.service.js';
import { QuestionBanksController, QuestionsController } from './questions.controller.js';
import { QuestionsService } from './questions.service.js';

/**
 * MOD-09 phase 2 — question banks (roadmap §4r; decisions D-R162..D-R164):
 * `/api/question-banks` (API-260..API-264, and API-266 to create a question
 * inside a bank) and `/api/questions` (API-265, API-267..API-269). Relies on
 * the global guards (AuthModule), PrismaModule and the global AuditModule; its
 * own error dictionary is questions.errors.ts and its pure rules
 * questions.rules.ts. The exam side of the phase lives in ExamsModule, which
 * imports the pure policy and rules of this folder — no provider is shared.
 */
@Module({
  controllers: [QuestionBanksController, QuestionsController],
  providers: [QuestionBanksService, QuestionsService],
})
export class QuestionsModule {}
