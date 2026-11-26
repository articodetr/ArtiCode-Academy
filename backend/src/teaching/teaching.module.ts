import { Module } from '@nestjs/common';
import { GradesModule } from '../grades/grades.module.js';
import { TeachingStudentsController } from './teaching-students.controller.js';
import { TeachingStudentsService } from './teaching-students.service.js';

/** «طلابي» for a teacher (CH-0370): read-only views of the students of the classes the caller teaches. */
@Module({
  imports: [GradesModule],
  controllers: [TeachingStudentsController],
  providers: [TeachingStudentsService],
})
export class TeachingModule {}
