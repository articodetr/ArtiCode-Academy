import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsUUID, ValidateNested } from 'class-validator';
import { ClassTeacherRole } from '../generated/prisma/client.js';

const CLASS_TEACHER_ROLES = Object.values(ClassTeacherRole) as ClassTeacherRole[];

/** Upper bound of one replacement list (a class has one lead and a few assistants). */
export const CLASS_TEACHERS_MAX = 20;

export class ClassTeacherInputDto {
  @ApiProperty({ format: 'uuid', description: 'A user holding the `teacher` role, invited or active' })
  @IsUUID('all')
  userId: string;

  @ApiProperty({ enum: CLASS_TEACHER_ROLES, description: 'At most one `lead` in the list' })
  @IsIn(CLASS_TEACHER_ROLES)
  role: ClassTeacherRole;
}

/** The whole final list of the class's teachers; `[]` removes every teacher. */
export class ReplaceClassTeachersDto {
  @ApiProperty({
    type: [ClassTeacherInputDto],
    maxItems: CLASS_TEACHERS_MAX,
    description: 'Full replacement: listed users are kept (role updated) or added, missing ones are removed. At most one lead; a user appears once.',
  })
  @IsArray()
  @ArrayMaxSize(CLASS_TEACHERS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ClassTeacherInputDto)
  teachers: ClassTeacherInputDto[];
}
