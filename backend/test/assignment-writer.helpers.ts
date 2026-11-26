// Shared e2e fixture: the assignment keys a teacher no longer holds through the
// seeded `teacher` role (migration 20261126141500_teacher_without_assignments —
// a teacher does not manage assignments). A suite whose journey still needs a
// class teacher to write, read or grade assignments gives that fixture user this
// custom role BESIDE the seeded `teacher` role; the suite deletes the role with
// its other fixtures. teacher-assignments-access.e2e-spec.ts proves that the
// seeded role alone is refused.
import type { PrismaClient } from '../src/generated/prisma/client.js';

/** The three keys taken from the seeded `teacher` role. */
export const TEACHER_REVOKED_ASSIGNMENT_KEYS = ['assignments.read', 'assignments.manage', 'assignments.grade'] as const;

/**
 * Creates a custom (non-system) role holding the three assignment keys and
 * returns its id. `key` must be unique in the shared database — derive it
 * from the suite's run token.
 */
export async function createAssignmentWriterRole(prisma: PrismaClient, key: string): Promise<string> {
  const role = await prisma.role.create({
    data: {
      key,
      label: { ar: 'دور اختبار: الواجبات' },
      permissions: { create: TEACHER_REVOKED_ASSIGNMENT_KEYS.map((permissionKey) => ({ permissionKey })) },
    },
    select: { id: true },
  });
  return role.id;
}
