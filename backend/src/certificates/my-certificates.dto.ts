import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import { CertificateDto } from './certificates.dto.js';

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
