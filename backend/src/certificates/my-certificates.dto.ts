import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { CertificateDto } from './certificates.dto.js';
import { COMPLETION_STATES } from './certificates.policy.js';
import type { CompletionState } from './certificates.policy.js';

const RELATIONS: MyClassRelation[] = ['self', 'child'];

export class ListMyCertificatesQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'The certificates of this class only' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The certificates of this student only — the caller or one of their linked children' })
  @IsOptional()
  @IsUUID('all')
  studentId?: string;
}

/** A certificate as its owner sees it: everything to print it, never the issuer, the revoker or the revocation reason. */
export class MyCertificateItemDto extends OmitType(CertificateDto, ['issuedBy', 'revokedBy', 'revokeReason'] as const) {
  @ApiProperty({ enum: RELATIONS, description: '`self` (certificates.read_own) or `child` (certificates.read_linked and the guardian role)' })
  relation: MyClassRelation;
}

export class MyCertificateListDto {
  @ApiProperty({ type: [MyCertificateItemDto], description: 'Issued and revoked certificates, newest first' })
  items: MyCertificateItemDto[];
}

// --- API-070/071 (ADR-049): the student's way to their own certificate -------

export class CompletionLessonsDto {
  @ApiProperty({ type: 'integer', description: 'Required published lessons of the course' })
  required: number;

  @ApiProperty({ type: 'integer', description: 'Of them, the ones the student has completed' })
  completed: number;
}

export class CompletionWorkDto {
  @ApiProperty({ enum: ['exam', 'assignment'] })
  kind: 'exam' | 'assignment';

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ type: Number })
  maxScore: number;

  @ApiProperty({ type: Boolean, description: 'Finished and visible to the student: a released exam result, a graded assignment' })
  done: boolean;

  @ApiProperty({ type: Number, nullable: true, description: 'The student’s own score once done; null for an excused exam' })
  score: number | null;
}

export class CompletionGradeDto {
  @ApiProperty({ type: Number })
  percent: number;

  @ApiProperty({ type: () => LocalizedTextDto })
  label: LocalizedText;

  @ApiProperty({ type: String, nullable: true })
  letter: string | null;

  @ApiProperty({ type: Boolean })
  isPass: boolean;
}

export class CompletionCertificateDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String })
  serial: string;

  @ApiProperty({ enum: ['issued', 'revoked'] })
  status: 'issued' | 'revoked';
}

export class EnrollmentCompletionDto {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty({ enum: COMPLETION_STATES, description: 'Where the student stands, in the order the server checks it' })
  state: CompletionState;

  @ApiProperty({ type: () => CompletionLessonsDto })
  lessons: CompletionLessonsDto;

  @ApiProperty({ type: () => [CompletionWorkDto], description: 'The class’s weighted assessments' })
  work: CompletionWorkDto[];

  @ApiProperty({ type: () => CompletionGradeDto, nullable: true, description: 'Only once every assessment is finished — never a running average (D-R48)' })
  grade: CompletionGradeDto | null;

  @ApiProperty({ type: () => CompletionCertificateDto, nullable: true, description: 'The issued certificate, else the latest revoked one' })
  certificate: CompletionCertificateDto | null;
}

export class ClaimCertificateResultDto {
  @ApiProperty({ type: Boolean, description: 'false = the student already held this certificate and nothing was written' })
  created: boolean;

  @ApiProperty({ type: () => MyCertificateItemDto })
  certificate: MyCertificateItemDto;
}
