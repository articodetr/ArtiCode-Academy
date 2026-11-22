import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ExamAttemptsSweeper } from './attempts.sweeper.js';
import { ExamAttemptDetailController, ExamAttemptsController } from './exam-attempts.controller.js';
import { ExamAttemptsService } from './exam-attempts.service.js';
import { ExamGradingService } from './exam-grading.service.js';
import { ExamQuestionsController } from './exam-questions.controller.js';
import { ExamQuestionsService } from './exam-questions.service.js';
import { ExamResultsController, MyExamsController } from './exam-results.controller.js';
import { ExamResultsService } from './exam-results.service.js';
import { ClassExamsController, ExamsController } from './exams.controller.js';
import { ExamsService } from './exams.service.js';
import { MyAttemptsController } from './my-attempts.controller.js';
import { MyAttemptsService } from './my-attempts.service.js';
import { MyExamsService } from './my-exams.service.js';

/**
 * MOD-09 — exams whose results a teacher records (roadmap §4h, D-R42/D-R47):
 * the exams since T03 (`/api/exams`, `/api/classes/:id/exams`), the results
 * sheet (`/api/exams/:id/results`) and «my exams» (`/api/me/exams` — ownership,
 * no key) since T04. Relies on the global guards
 * (AuthModule), PrismaModule and the global AuditModule; uses the MOD-09
 * error dictionary of grades/grades.errors.ts, the class visibility rule of
 * classes/classes.policy.ts (D-R16), the instant helpers of
 * lessons/lessons.time.ts and the display-zone rule of
 * schedule/timetable.policy.ts (D-R41). Since MOD-12-T03 it imports
 * NotificationsModule: scheduling an exam and publishing its results notify
 * the learners through `NotificationsService` (roadmap §4j.5).
 *
 * Since MOD-09 phase 2 (roadmap §4r) it also holds the online side of an exam:
 * its linked questions and their frozen copies (`/api/exams/:id/questions` —
 * `ExamQuestionsService`, which `ExamsService` uses at `schedule` and
 * `unschedule`). The question banks themselves live in QuestionsModule; only
 * their pure policy and rules are imported here. And the attempts: a learner
 * takes the exam through `/api/me/exams/:id/attempts` and
 * `/api/me/exam-attempts/:id` (`MyAttemptsService` — ownership + `exams.take`),
 * `ExamGradingService` is the one writer of an attempt's result and of the
 * `online` rows of `exam_results`, `ExamAttemptsSweeper` closes the attempts
 * whose time is over even when nobody comes back (off under `NODE_ENV=test`),
 * and the teacher follows the attempts and corrects a key through
 * `/api/exams/:id/attempts`, `/api/exam-attempts/:id`,
 * `/api/exams/:id/questions/:examQuestionId/key` and `/api/exams/:id/regrade`
 * (`ExamAttemptsService`).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [
    ClassExamsController,
    ExamsController,
    ExamQuestionsController,
    ExamAttemptsController,
    ExamAttemptDetailController,
    ExamResultsController,
    MyExamsController,
    MyAttemptsController,
  ],
  providers: [ExamsService, ExamQuestionsService, ExamGradingService, ExamAttemptsService, ExamAttemptsSweeper, ExamResultsService, MyExamsService, MyAttemptsService],
  exports: [ExamsService],
})
export class ExamsModule {}
