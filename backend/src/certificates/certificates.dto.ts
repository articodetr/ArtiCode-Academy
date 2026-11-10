import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { EnrollmentStudentDto } from '../enrollments/enrollments.dto.js';
import { CertificateStatus, ClassStatus, EnrollmentStatus } from '../generated/prisma/client.js';
import { INELIGIBLE_REASONS } from './certificates.policy.js';
import type { IneligibleReason } from './certificates.policy.js';

/** At most this many enrollments in one issuing request. */
export const ISSUE_MAX_ENROLLMENTS = 500;

/** API-132 body: every eligible enrollment of the class, or the named ones. */
export class IssueCertificatesDto {
  @ApiPropertyOptional({ type: [String], format: 'uuid', minItems: 1, maxItems: ISSUE_MAX_ENROLLMENTS, description: 'Only these enrollments of the class; absent = every eligible enrollment' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ISSUE_MAX_ENROLLMENTS)
  @IsUUID('all', { each: true })
  enrollmentIds?: string[];
}

export class CertificateRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ENG-A1-2026-1' })
  code: string;

  @ApiProperty({ description: 'Localized name' })
  name: LocalizedText;
}

export class CertificateStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ type: String, nullable: true })
  fullNameLatin: string | null;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;
}

export class CertificateActorDto {
  @ApiProperty()
  fullName: string;
}

export class CertificateGradeDto {
  @ApiProperty({ example: 86.4 })
  percent: number;

  @ApiProperty({ description: 'The grade scheme band at issuance' })
  label: LocalizedText;

  @ApiProperty({ type: String, nullable: true, example: 'B' })
  letter: string | null;
}

/** What is printed (D-R50): fixed at issuance, never changed by later edits. */
export class CertificateSnapshotDto {
  @ApiProperty({ type: CertificateStudentDto, description: 'Without the id' })
  student: Omit<CertificateStudentDto, 'id'>;

  @ApiProperty({ description: '{ code, name }' })
  course: { code: string; name: LocalizedText };

  @ApiProperty({ description: '{ code, name }' })
  class: { code: string; name: LocalizedText };

  @ApiProperty({ description: '{ name } — the academy name at issuance' })
  academy: { name: LocalizedText };

  @ApiProperty({ type: CertificateGradeDto })
  grade: CertificateGradeDto;

  @ApiProperty({ type: String, nullable: true, description: 'When the enrollment was completed (ISO 8601)' })
  completedAt: string | null;

  @ApiProperty({ description: 'ISO 8601' })
  issuedAt: string;
}

export class CertificateDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'CERT-2026-00001', description: 'PREFIX-YYYY-NNNNN (D-R53)' })
  serial: string;

  @ApiProperty({ example: 'K7Q2M4XW9PLR5TBC3NHD', description: 'The public verification code (D-R56)' })
  verificationCode: string;

  @ApiProperty({ enum: CertificateStatus })
  status: CertificateStatus;

  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ type: CertificateRefDto })
  class: CertificateRefDto;

  @ApiProperty({ type: CertificateRefDto })
  course: CertificateRefDto;

  @ApiProperty({ type: CertificateStudentDto, description: 'Identity only' })
  student: CertificateStudentDto;

  @ApiProperty({ type: CertificateGradeDto })
  grade: CertificateGradeDto;

  @ApiProperty({ type: CertificateSnapshotDto })
  snapshot: CertificateSnapshotDto;

  @ApiProperty({ description: 'ISO 8601' })
  issuedAt: string;

  @ApiProperty({ type: CertificateActorDto, nullable: true, description: 'By name only' })
  issuedBy: CertificateActorDto | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601' })
  revokedAt: string | null;

  @ApiProperty({ type: CertificateActorDto, nullable: true, description: 'By name only' })
  revokedBy: CertificateActorDto | null;

  @ApiProperty({ type: String, nullable: true })
  revokeReason: string | null;
}

export class SkippedEnrollmentDto {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ format: 'uuid' })
  studentId: string;

  @ApiProperty({ enum: INELIGIBLE_REASONS })
  reason: IneligibleReason;
}

export class IssueCertificatesResultDto {
  @ApiProperty({ type: [CertificateDto], description: 'The certificates issued by this request, in enrollment order' })
  issued: CertificateDto[];

  @ApiProperty({ type: [SkippedEnrollmentDto], description: 'The enrollments that got none, with the reason' })
  skipped: SkippedEnrollmentDto[];
}

export class CertificatePreviewFinalDto {
  @ApiProperty({ example: 86.4 })
  percent: number;

  @ApiProperty()
  label: LocalizedText;

  @ApiProperty({ type: String, nullable: true })
  letter: string | null;

  @ApiProperty()
  isPass: boolean;

  @ApiProperty({ description: 'A source changed after the final grade was fixed — finalize again first' })
  stale: boolean;
}

export class CertificatePreviewSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  serial: string;

  @ApiProperty({ description: 'ISO 8601' })
  issuedAt: string;
}

export class CertificatePreviewItemDto {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ enum: EnrollmentStatus })
  enrollmentStatus: EnrollmentStatus;

  @ApiProperty({ type: EnrollmentStudentDto, description: 'In the caller’s D-R07 projection' })
  student: EnrollmentStudentDto;

  @ApiProperty({ type: CertificatePreviewFinalDto, nullable: true })
  final: CertificatePreviewFinalDto | null;

  @ApiProperty({ type: CertificatePreviewSummaryDto, nullable: true, description: 'The issued certificate, if any' })
  certificate: CertificatePreviewSummaryDto | null;

  @ApiProperty({ enum: INELIGIBLE_REASONS, nullable: true, description: 'Why no certificate would be issued now; null = eligible' })
  reason: IneligibleReason | null;
}

export class CertificatePreviewClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: LocalizedText;

  @ApiProperty({ enum: ClassStatus })
  status: ClassStatus;
}

export class ClassCertificatesDto {
  @ApiProperty({ type: CertificatePreviewClassDto })
  class: CertificatePreviewClassDto;

  @ApiProperty({ description: 'How many certificates an issuing request would create now (0 unless the class is completed)' })
  issuable: number;

  @ApiProperty({ type: [CertificatePreviewItemDto], description: 'Every active or completed enrollment, in enrollment order' })
  items: CertificatePreviewItemDto[];
}
