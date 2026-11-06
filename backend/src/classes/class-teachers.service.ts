import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isEmptyTeacherPlan, planTeacherReplacement, teacherListProblems, writtenTeacherIds } from './class-teachers.changes.js';
import type { TeacherAssignment, TeacherReplacementPlan } from './class-teachers.changes.js';
import type { ReplaceClassTeachersDto } from './class-teachers.dto.js';
import type { ClassDto } from './classes.dto.js';
import { classesError } from './classes.errors.js';
import { ELIGIBLE_USER_STATUSES, TEACHER_ROLE_KEY } from './classes.policy.js';
import { CLASSES_ENTITY_TYPE, ClassesService } from './classes.service.js';

export const CLASS_TEACHERS_AUDIT_ACTION = 'classes.teachers.changed';

/**
 * MOD-05-T03 — the teachers of a class (`PUT /api/classes/:id/teachers`).
 * The body is the whole final list; planTeacherReplacement() turns it into
 * adds, removals and role changes. Every row the plan writes (added or role
 * changed) must belong to an invited or active, not soft-deleted user who
 * actually holds the `teacher` role; teachers kept as they are are not
 * re-checked, so a suspended former teacher does not block other edits.
 * The class row is locked (`FOR NO KEY UPDATE`, the lock of T02's capacity
 * and status writes), so two replacements of one class run one after the
 * other. Writes go in the order the partial unique index
 * `uq_class_teachers_lead` (immediate) needs: removals, demotions, promotions,
 * inserts. Exactly one `classes.teachers.changed` event per effective write;
 * an identical list writes and records nothing. Assigning a teacher changes
 * nobody's permissions, so no exceedingPermissions() check applies.
 */
@Injectable()
export class ClassTeachersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly classes: ClassesService,
  ) {}

  async replace(classId: string, input: ReplaceClassTeachersDto, caller: AuthPrincipal, ctx: RequestContext): Promise<ClassDto> {
    const requested: TeacherAssignment[] = input.teachers.map((entry) => ({ userId: entry.userId, role: entry.role }));
    const problems = teacherListProblems(requested);
    if (problems) throw classesError.teachersInvalid(problems.duplicates, problems.leadCount);

    await this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM classes WHERE id = ${classId}::uuid FOR NO KEY UPDATE`;
      const klass = locked[0];
      if (!klass) throw classesError.classNotFound(classId);

      const current = await tx.classTeacher.findMany({
        where: { classId },
        orderBy: [{ role: 'asc' }, { assignedAt: 'asc' }, { teacherUserId: 'asc' }],
        select: { teacherUserId: true, role: true },
      });
      const plan = planTeacherReplacement(
        current.map((row) => ({ userId: row.teacherUserId, role: row.role })),
        requested,
      );
      if (isEmptyTeacherPlan(plan)) return;
      await this.assertEligibleTeachers(tx, writtenTeacherIds(plan, requested));
      const clearedSlots = await this.write(tx, classId, plan, caller.id);
      await this.audit.record(
        {
          action: CLASS_TEACHERS_AUDIT_ACTION,
          actorUserId: caller.id,
          entityType: CLASSES_ENTITY_TYPE,
          entityId: classId,
          metadata: {
            code: klass.code,
            added: plan.added,
            removed: plan.removed,
            roleChanged: plan.roleChanged,
            ...(clearedSlots > 0 ? { clearedSlots } : {}),
          },
          ...ctx,
        },
        tx,
      );
    });
    return this.classes.getForManager(classId);
  }

  /** Checks the users in order and refuses the first that cannot teach: unknown/deleted 404, not invited/active 422, no teacher role 422. */
  private async assertEligibleTeachers(tx: Prisma.TransactionClient, userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const users = await tx.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, status: true, deletedAt: true, roles: { where: { role: { key: TEACHER_ROLE_KEY } }, select: { roleId: true } } },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    for (const userId of userIds) {
      const user = byId.get(userId);
      if (!user || user.deletedAt !== null) throw classesError.userNotFound(userId);
      if (!(ELIGIBLE_USER_STATUSES as readonly string[]).includes(user.status)) throw classesError.userNotEligible(userId, user.status);
      if (user.roles.length === 0) throw classesError.notATeacher(userId);
    }
  }

  /**
   * Removals, then demotions, then promotions, then inserts: at no point do two
   * leads exist. A removed teacher is also cleared from the class's weekly
   * slots (MOD-07-T03, D-R26: the slot falls back to the lead teacher at
   * generation time); returns how many slots that touched.
   */
  private async write(tx: Prisma.TransactionClient, classId: string, plan: TeacherReplacementPlan, actorId: string): Promise<number> {
    let clearedSlots = 0;
    if (plan.removed.length > 0) {
      await tx.classTeacher.deleteMany({ where: { classId, teacherUserId: { in: plan.removed } } });
      const cleared = await tx.classSchedule.updateMany({ where: { classId, teacherUserId: { in: plan.removed } }, data: { teacherUserId: null } });
      clearedSlots = cleared.count;
    }
    const demotions = plan.roleChanged.filter((change) => change.to === 'assistant');
    const promotions = plan.roleChanged.filter((change) => change.to === 'lead');
    for (const change of [...demotions, ...promotions]) {
      await tx.classTeacher.update({
        where: { classId_teacherUserId: { classId, teacherUserId: change.userId } },
        data: { role: change.to },
        select: { classId: true },
      });
    }
    if (plan.added.length > 0) {
      await tx.classTeacher.createMany({
        data: plan.added.map((entry) => ({ classId, teacherUserId: entry.userId, role: entry.role, assignedById: actorId })),
      });
    }
    return clearedSlots;
  }
}
