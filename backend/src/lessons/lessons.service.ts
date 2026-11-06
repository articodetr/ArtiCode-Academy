import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AttendanceStatus, ClassStatus, DeliveryMode } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { isWriteConflict } from '../schedule/class-schedule.service.js';
import { isEmptyLessonPatch, mergedRange, planLessonUpdate } from './lessons.changes.js';
import type { LessonPatch, LessonValues } from './lessons.changes.js';
import { LESSONS_PAGE_DEFAULT, LESSON_SORT_FIELD } from './lessons.dto.js';
import type { AttendanceCountsDto, ChangeLessonStatusDto, CreateLessonDto, LessonDto, LessonListDto, ListLessonsQueryDto, UpdateLessonDto } from './lessons.dto.js';
import { lessonsError } from './lessons.errors.js';
import type { LessonConflictResource } from './lessons.errors.js';
import { isClassOpenForLessons, seesEveryClass, visibleLessonsWhere } from './lessons.policy.js';
import { allowedLessonActions, hasStarted, isLessonDeletable, lockedFields, nextLessonStatus } from './lessons.status.js';
import { MAX_LESSON_HOURS, timeRangeProblem, toInstant, toIso } from './lessons.time.js';

export const LESSONS_AUDIT_ACTIONS = {
  created: 'lessons.created',
  updated: 'lessons.updated',
  statusChanged: 'lessons.status.changed',
  deleted: 'lessons.deleted',
} as const;

/** Audit `entity_type` of lesson events (`lessons.created` is recorded on the class — see createLessons). */
export const LESSONS_ENTITY_TYPE = 'lessons';
const CLASSES_ENTITY_TYPE = 'classes';

/** Attempts of a writing transaction when PostgreSQL reports a write conflict or a deadlock (KI-071). */
const WRITE_CONFLICT_ATTEMPTS = 2;

const LESSON_SELECT = {
  id: true,
  classId: true,
  syllabusItemId: true,
  scheduleId: true,
  roomId: true,
  teacherUserId: true,
  title: true,
  description: true,
  deliveryMode: true,
  startsAt: true,
  endsAt: true,
  status: true,
  meetingUrl: true,
  cancellationReason: true,
  attendanceTakenAt: true,
  createdAt: true,
  updatedAt: true,
  class: { select: { id: true, code: true, name: true, status: true, courseId: true, course: { select: { id: true, code: true, name: true } } } },
  syllabusItem: { select: { id: true, sortOrder: true, title: true } },
  room: { select: { id: true, code: true, name: true, branch: { select: { id: true, code: true, name: true } } } },
  teacher: { select: { id: true, fullName: true } },
} satisfies Prisma.LessonSelect;

type LessonRow = Prisma.LessonGetPayload<{ select: typeof LESSON_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];
type AttendanceCounts = Record<string, AttendanceCountsDto>;

const EMPTY_COUNTS: AttendanceCountsDto = { recorded: 0, present: 0, absent: 0, late: 0, excused: 0 };

/** The resolved values of one lesson to write (teacher already defaulted, instants parsed). */
interface LessonInput {
  title: LocalizedText;
  description: LocalizedText | null;
  deliveryMode: DeliveryMode;
  startsAt: Date;
  endsAt: Date;
  roomId: string | null;
  teacherUserId: string | null;
  syllabusItemId: string | null;
  meetingUrl: string | null;
  scheduleId: string | null;
}

/** What a creating caller asks for: `teacherUserId` undefined = the class's lead teacher at creation (D-R33 (3)). */
export interface LessonRequest {
  title: LocalizedText;
  description?: LocalizedText | null;
  deliveryMode?: DeliveryMode;
  startsAt: string;
  endsAt: string;
  roomId?: string | null;
  teacherUserId?: string | null;
  syllabusItemId?: string | null;
  meetingUrl?: string | null;
  /** The weekly slot a generated lesson comes from (MOD-07-T05); never set by the API. */
  scheduleId?: string | null;
}

function toLessonDto(row: LessonRow, counts: AttendanceCounts): LessonDto {
  return {
    id: row.id,
    class: {
      id: row.class.id,
      code: row.class.code,
      name: readLocalizedText(row.class.name) ?? { ar: row.class.code },
      status: row.class.status,
      course: { id: row.class.course.id, code: row.class.course.code, name: readLocalizedText(row.class.course.name) ?? { ar: row.class.course.code } },
    },
    title: readLocalizedText(row.title) ?? { ar: '' },
    description: readLocalizedText(row.description),
    deliveryMode: row.deliveryMode,
    startsAt: toIso(row.startsAt),
    endsAt: toIso(row.endsAt),
    status: row.status,
    room: row.room
      ? {
          id: row.room.id,
          code: row.room.code,
          name: readLocalizedText(row.room.name),
          branch: row.room.branch ? { id: row.room.branch.id, code: row.room.branch.code, name: readLocalizedText(row.room.branch.name) ?? { ar: row.room.branch.code } } : null,
        }
      : null,
    teacher: row.teacher ? { userId: row.teacher.id, fullName: row.teacher.fullName } : null,
    syllabusItem: row.syllabusItem
      ? { id: row.syllabusItem.id, sortOrder: row.syllabusItem.sortOrder, title: readLocalizedText(row.syllabusItem.title) ?? { ar: '' } }
      : null,
    scheduleId: row.scheduleId,
    meetingUrl: row.meetingUrl,
    cancellationReason: row.cancellationReason,
    attendanceTakenAt: row.attendanceTakenAt ? toIso(row.attendanceTakenAt) : null,
    attendance: counts[row.id] ?? EMPTY_COUNTS,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function valuesOf(row: LessonRow): LessonValues {
  return {
    title: readLocalizedText(row.title) ?? { ar: '' },
    description: readLocalizedText(row.description),
    deliveryMode: row.deliveryMode,
    startsAt: toIso(row.startsAt),
    endsAt: toIso(row.endsAt),
    roomId: row.roomId,
    teacherUserId: row.teacherUserId,
    syllabusItemId: row.syllabusItemId,
    meetingUrl: row.meetingUrl,
  };
}

function toUpdateInput(data: LessonPatch): Prisma.LessonUncheckedUpdateInput {
  const input: Prisma.LessonUncheckedUpdateInput = {};
  if (data.title !== undefined) input.title = data.title as Prisma.InputJsonValue;
  if (data.description !== undefined) input.description = data.description === null ? Prisma.DbNull : (data.description as Prisma.InputJsonValue);
  if (data.deliveryMode !== undefined) input.deliveryMode = data.deliveryMode;
  if (data.startsAt !== undefined) input.startsAt = toInstant(data.startsAt);
  if (data.endsAt !== undefined) input.endsAt = toInstant(data.endsAt);
  if (data.roomId !== undefined) input.roomId = data.roomId;
  if (data.teacherUserId !== undefined) input.teacherUserId = data.teacherUserId;
  if (data.syllabusItemId !== undefined) input.syllabusItemId = data.syllabusItemId;
  if (data.meetingUrl !== undefined) input.meetingUrl = data.meetingUrl;
  return input;
}

/**
 * Which EXCLUDE constraint a database error names (`ex_lessons_room` /
 * `ex_lessons_teacher` — D-R34). Prisma 7 with the pg adapter does not map
 * SQLSTATE 23P01 to a dedicated code, so the constraint is read from the
 * driver error (`meta.driverAdapterError.cause`) or the message (KI-036).
 */
export function lessonExclusionOf(error: unknown): LessonConflictResource | null {
  const texts: string[] = [];
  if (error instanceof Error) texts.push(error.message);
  const meta = (error as { meta?: Record<string, unknown> }).meta;
  const cause = (meta?.['driverAdapterError'] as { cause?: Record<string, unknown> } | undefined)?.cause;
  if (cause) {
    const constraint = cause['constraint'] as { index?: unknown } | undefined;
    if (typeof constraint?.index === 'string') texts.push(constraint.index);
    if (typeof cause['originalMessage'] === 'string') texts.push(cause['originalMessage']);
  }
  const joined = texts.join(' ');
  if (joined.includes('ex_lessons_room')) return 'room';
  if (joined.includes('ex_lessons_teacher')) return 'teacher';
  return null;
}

/** A booked resource of a lesson, for the conflict lookup after a 23P01. */
interface Booking {
  lessonId: string | null;
  roomId: string | null;
  teacherUserId: string | null;
  startsAt: Date;
  endsAt: Date;
}

/**
 * MOD-06-T02 — lessons (roadmap §4f.4 API-093..API-098; D-R31: every write on
 * `lessons` goes through this service, MOD-07-T05 included). Visibility
 * follows D-R16 through the class (`classes.manage` sees every class's
 * lessons, anyone else those of the classes they teach — others are 404);
 * writing needs `lessons.manage` and the same visibility. A lesson is created
 * for a class that is planned, open or running, with a teacher from the
 * class's teachers (the lead teacher by default), a syllabus item of the
 * class's course and an active room; its status moves through manual actions
 * (D-R33); double bookings are refused by the EXCLUDE constraints (D-R34)
 * and answered as `lesson_conflict` with the conflicting lesson. Creation
 * locks the class row (`FOR NO KEY UPDATE`, the MOD-05 lock), edits and
 * actions lock the lesson row, deletion locks it `FOR UPDATE`. Every write is
 * one transaction with exactly one audit event, retried once on a write
 * conflict or deadlock (KI-071).
 */
@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListLessonsQueryDto, caller: AuthPrincipal): Promise<LessonListDto> {
    const order: SortOrder = query.order ?? 'asc';
    const limit = query.limit ?? LESSONS_PAGE_DEFAULT;
    const filters: Prisma.LessonWhereInput[] = [visibleLessonsWhere(caller)];
    if (query.classId) filters.push({ classId: query.classId });
    if (query.teacherId) filters.push({ teacherUserId: query.teacherId });
    if (query.status) filters.push({ status: query.status });
    if (query.from) filters.push({ startsAt: { gte: toInstant(query.from) } });
    if (query.to) filters.push({ startsAt: { lte: toInstant(query.to) } });
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, LESSON_SORT_FIELD, order, true, () => lessonsError.cursorInvalid());
      const key = cursor.key as string;
      if (!Number.isFinite(Date.parse(key))) throw lessonsError.cursorInvalid();
      const cmp = order === 'asc' ? 'gt' : 'lt';
      const at = new Date(key);
      filters.push({ OR: [{ startsAt: { [cmp]: at } }, { startsAt: at, id: { [cmp]: cursor.id } }] });
    }
    const rows = await this.prisma.db.lesson.findMany({
      where: { AND: filters },
      orderBy: [{ startsAt: order }, { id: order }],
      take: limit + 1,
      select: LESSON_SELECT,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: LESSON_SORT_FIELD, order, key: toIso(last.startsAt), id: last.id }) : null;
    const counts = await this.attendanceCounts(this.prisma.db, page.map((row) => row.id));
    return { items: page.map((row) => toLessonDto(row, counts)), nextCursor };
  }

  async get(id: string, caller: AuthPrincipal): Promise<LessonDto> {
    const row = await this.prisma.db.lesson.findFirst({ where: { AND: [{ id }, visibleLessonsWhere(caller)] }, select: LESSON_SELECT });
    if (!row) throw lessonsError.lessonNotFound(id);
    return toLessonDto(row, await this.attendanceCounts(this.prisma.db, [id]));
  }

  /** `POST /api/classes/:id/lessons` — one lesson by hand (API-095). */
  async create(classId: string, input: CreateLessonDto, caller: AuthPrincipal, ctx: RequestContext): Promise<LessonDto> {
    const request: LessonRequest = {
      title: toLocalizedText(input.title),
      description: input.description === undefined ? undefined : input.description === null ? null : toLocalizedText(input.description),
      deliveryMode: input.deliveryMode,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      roomId: input.roomId,
      teacherUserId: input.teacherUserId,
      syllabusItemId: input.syllabusItemId,
      meetingUrl: input.meetingUrl,
    };
    const [lesson] = await this.createLessons(classId, [request], caller, ctx);
    return lesson!;
  }

  /**
   * Creates the lessons of one class in one transaction with exactly one
   * `lessons.created` event (D-R31 — MOD-07-T05 generates lessons from the
   * weekly slots through this method). Checks, in order: the class exists and
   * is visible to the caller (404), it is planned/open/running (409
   * class_closed), every time range is valid (400), every named teacher is
   * one of the class's teachers (422 — an absent teacher defaults to the lead
   * teacher at creation), every syllabus item belongs to the class's course
   * (404/422), every room exists and is active (404/422). A double booking of a
   * room or a teacher — among the created lessons or with existing ones — is
   * refused by the EXCLUDE constraints (`lesson_conflict`).
   */
  async createLessons(classId: string, requests: readonly LessonRequest[], caller: AuthPrincipal, ctx: RequestContext): Promise<LessonDto[]> {
    for (const request of requests) this.assertRange(request.startsAt, request.endsAt);
    const bookings: Booking[] = [];
    for (let attempt = 1; ; attempt++) {
      bookings.length = 0;
      try {
        return await this.prisma.db.$transaction(async (tx) => {
          const klass = await this.lockClass(tx, classId, caller);
          if (!isClassOpenForLessons(klass.status)) throw lessonsError.classClosed(classId, klass.status);
          const lead = await tx.classTeacher.findFirst({ where: { classId, role: 'lead' }, select: { teacherUserId: true } });
          const inputs: LessonInput[] = [];
          for (const request of requests) {
            const teacherUserId = request.teacherUserId === undefined ? (lead?.teacherUserId ?? null) : request.teacherUserId;
            if (teacherUserId !== null && request.teacherUserId !== undefined) await this.assertTeacherAssigned(tx, classId, teacherUserId);
            const syllabusItemId = request.syllabusItemId ?? null;
            if (syllabusItemId !== null) await this.assertSyllabusItem(tx, syllabusItemId, klass.courseId);
            const roomId = request.roomId ?? null;
            if (roomId !== null) await this.assertRoomUsable(tx, roomId);
            inputs.push({
              title: request.title,
              description: request.description ?? null,
              deliveryMode: request.deliveryMode ?? 'in_person',
              startsAt: toInstant(request.startsAt),
              endsAt: toInstant(request.endsAt),
              roomId,
              teacherUserId,
              syllabusItemId,
              meetingUrl: request.meetingUrl ?? null,
              scheduleId: request.scheduleId ?? null,
            });
          }
          const ids: string[] = [];
          for (const values of inputs) {
            bookings.push({ lessonId: null, roomId: values.roomId, teacherUserId: values.teacherUserId, startsAt: values.startsAt, endsAt: values.endsAt });
            const created = await tx.lesson.create({
              data: {
                classId,
                createdById: caller.id,
                title: values.title as Prisma.InputJsonValue,
                description: values.description === null ? Prisma.DbNull : (values.description as Prisma.InputJsonValue),
                deliveryMode: values.deliveryMode,
                startsAt: values.startsAt,
                endsAt: values.endsAt,
                roomId: values.roomId,
                teacherUserId: values.teacherUserId,
                syllabusItemId: values.syllabusItemId,
                meetingUrl: values.meetingUrl,
                scheduleId: values.scheduleId,
              },
              select: { id: true },
            });
            ids.push(created.id);
          }
          await this.audit.record(
            {
              action: LESSONS_AUDIT_ACTIONS.created,
              actorUserId: caller.id,
              entityType: CLASSES_ENTITY_TYPE,
              entityId: classId,
              metadata: { code: klass.code, classId, count: ids.length, lessonIds: ids },
              ...ctx,
            },
            tx,
          );
          const rows = await tx.lesson.findMany({ where: { id: { in: ids } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: LESSON_SELECT });
          return rows.map((row) => toLessonDto(row, {}));
        });
      } catch (error) {
        const resource = lessonExclusionOf(error);
        if (resource !== null) throw await this.conflictFor(resource, bookings);
        if (isWriteConflict(error) && attempt < WRITE_CONFLICT_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  async update(id: string, input: UpdateLessonDto, caller: AuthPrincipal, ctx: RequestContext): Promise<LessonDto> {
    if (isEmptyLessonPatch(input)) throw lessonsError.nothingToUpdate();
    const patch: LessonPatch = {};
    if (input.title !== undefined) patch.title = toLocalizedText(input.title);
    if (input.description !== undefined) patch.description = input.description === null ? null : toLocalizedText(input.description);
    if (input.deliveryMode !== undefined) patch.deliveryMode = input.deliveryMode;
    if (input.startsAt !== undefined) patch.startsAt = toIso(toInstant(input.startsAt));
    if (input.endsAt !== undefined) patch.endsAt = toIso(toInstant(input.endsAt));
    if (input.roomId !== undefined) patch.roomId = input.roomId;
    if (input.teacherUserId !== undefined) patch.teacherUserId = input.teacherUserId;
    if (input.syllabusItemId !== undefined) patch.syllabusItemId = input.syllabusItemId;
    if (input.meetingUrl !== undefined) patch.meetingUrl = input.meetingUrl;

    let booking: Booking | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.db.$transaction(async (tx) => {
          const row = await this.lockLesson(tx, id, caller, 'NO KEY UPDATE');
          const current = valuesOf(row);
          const plan = planLessonUpdate(current, patch);
          if (plan.fields.length === 0) return toLessonDto(row, await this.attendanceCounts(tx, [id]));
          if (!isClassOpenForLessons(row.class.status)) throw lessonsError.classClosed(row.classId, row.class.status);
          const locked = lockedFields(row.status, plan.fields);
          if (locked.length > 0) throw lessonsError.lessonLocked(row.status, locked);
          const range = mergedRange(current, plan.data);
          this.assertRange(range.startsAt, range.endsAt);
          if (typeof plan.data.teacherUserId === 'string') await this.assertTeacherAssigned(tx, row.classId, plan.data.teacherUserId);
          if (typeof plan.data.syllabusItemId === 'string') await this.assertSyllabusItem(tx, plan.data.syllabusItemId, row.class.courseId);
          if (typeof plan.data.roomId === 'string') await this.assertRoomUsable(tx, plan.data.roomId);
          booking = {
            lessonId: id,
            roomId: plan.data.roomId !== undefined ? plan.data.roomId : row.roomId,
            teacherUserId: plan.data.teacherUserId !== undefined ? plan.data.teacherUserId : row.teacherUserId,
            startsAt: toInstant(range.startsAt),
            endsAt: toInstant(range.endsAt),
          };
          await tx.lesson.update({ where: { id }, data: toUpdateInput(plan.data), select: { id: true } });
          await this.audit.record(
            {
              action: LESSONS_AUDIT_ACTIONS.updated,
              actorUserId: caller.id,
              entityType: LESSONS_ENTITY_TYPE,
              entityId: id,
              metadata: { classId: row.classId, code: row.class.code, fields: plan.fields },
              ...ctx,
            },
            tx,
          );
          return this.read(tx, id);
        });
      } catch (error) {
        const resource = lessonExclusionOf(error);
        if (resource !== null) throw await this.conflictFor(resource, booking ? [booking] : []);
        if (isWriteConflict(error) && attempt < WRITE_CONFLICT_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /** complete / cancel / restore (lessons.status.ts); `restore` meets the EXCLUDE constraints again. */
  async changeStatus(id: string, input: ChangeLessonStatusDto, caller: AuthPrincipal, ctx: RequestContext): Promise<LessonDto> {
    let booking: Booking | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.db.$transaction(async (tx) => {
          const row = await this.lockLesson(tx, id, caller, 'NO KEY UPDATE');
          if (!isClassOpenForLessons(row.class.status)) throw lessonsError.classClosed(row.classId, row.class.status);
          const to = nextLessonStatus(input.action, row.status);
          if (to === null) throw lessonsError.invalidTransition(row.status, input.action, allowedLessonActions(row.status));
          if (input.action === 'complete' && !hasStarted(row.startsAt)) throw lessonsError.lessonNotStarted(toIso(row.startsAt));
          booking = { lessonId: id, roomId: row.roomId, teacherUserId: row.teacherUserId, startsAt: row.startsAt, endsAt: row.endsAt };
          const data: Prisma.LessonUncheckedUpdateInput = { status: to };
          if (input.action === 'cancel') data.cancellationReason = input.reason ?? null;
          if (input.action === 'restore') data.cancellationReason = null;
          await tx.lesson.update({ where: { id }, data, select: { id: true } });
          await this.audit.record(
            {
              action: LESSONS_AUDIT_ACTIONS.statusChanged,
              actorUserId: caller.id,
              entityType: LESSONS_ENTITY_TYPE,
              entityId: id,
              metadata: {
                classId: row.classId,
                code: row.class.code,
                action: input.action,
                from: row.status,
                to,
                ...(input.reason !== undefined ? { reason: input.reason } : {}),
              },
              ...ctx,
            },
            tx,
          );
          return this.read(tx, id);
        });
      } catch (error) {
        const resource = lessonExclusionOf(error);
        if (resource !== null) throw await this.conflictFor(resource, booking ? [booking] : []);
        if (isWriteConflict(error) && attempt < WRITE_CONFLICT_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /** Deletes a scheduled lesson without any attendance record; any other is 409 lesson_not_deletable — cancel it instead. */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockLesson(tx, id, caller, 'UPDATE');
      if (!isClassOpenForLessons(row.class.status)) throw lessonsError.classClosed(row.classId, row.class.status);
      const attendanceCount = await tx.attendanceRecord.count({ where: { lessonId: id } });
      if (!isLessonDeletable(row.status, attendanceCount)) throw lessonsError.lessonNotDeletable(row.status, attendanceCount);
      await tx.lesson.delete({ where: { id }, select: { id: true } });
      await this.audit.record(
        {
          action: LESSONS_AUDIT_ACTIONS.deleted,
          actorUserId: caller.id,
          entityType: LESSONS_ENTITY_TYPE,
          entityId: id,
          metadata: { classId: row.classId, code: row.class.code, startsAt: toIso(row.startsAt) },
          ...ctx,
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------------------

  private assertRange(startsAt: string, endsAt: string): void {
    const problem = timeRangeProblem(toInstant(startsAt), toInstant(endsAt));
    if (problem !== null) throw lessonsError.timeRangeInvalid(startsAt, endsAt, MAX_LESSON_HOURS);
  }

  /**
   * Locks the class row (the MOD-05 lock, so lesson creation serialises with
   * the class's own actions) and applies the visibility rule: without
   * `classes.manage` the caller must be one of the class's teachers — an
   * unknown or invisible class is 404 before any other detail is revealed.
   */
  private async lockClass(tx: Tx, classId: string, caller: AuthPrincipal): Promise<{ code: string; status: ClassStatus; courseId: string }> {
    const locked = await tx.$queryRaw<{ code: string; status: ClassStatus; courseId: string }[]>`
      SELECT code, status, course_id AS "courseId" FROM classes WHERE id = ${classId}::uuid FOR NO KEY UPDATE`;
    const klass = locked[0];
    if (!klass) throw lessonsError.classNotFound(classId);
    if (!seesEveryClass(caller)) {
      const assigned = await tx.classTeacher.findFirst({ where: { classId, teacherUserId: caller.id }, select: { classId: true } });
      if (!assigned) throw lessonsError.classNotFound(classId);
    }
    return klass;
  }

  /** Locks the lesson row and reads it with the visibility rule; an unknown or invisible lesson is 404. */
  private async lockLesson(tx: Tx, id: string, caller: AuthPrincipal, mode: 'NO KEY UPDATE' | 'UPDATE'): Promise<LessonRow> {
    const locked =
      mode === 'UPDATE'
        ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM lessons WHERE id = ${id}::uuid FOR UPDATE`
        : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM lessons WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) throw lessonsError.lessonNotFound(id);
    const row = await tx.lesson.findFirst({ where: { AND: [{ id }, visibleLessonsWhere(caller)] }, select: LESSON_SELECT });
    if (!row) throw lessonsError.lessonNotFound(id);
    return row;
  }

  private async assertTeacherAssigned(tx: Tx, classId: string, userId: string): Promise<void> {
    const assigned = await tx.classTeacher.findFirst({ where: { classId, teacherUserId: userId }, select: { classId: true } });
    if (!assigned) throw lessonsError.teacherNotAssigned(userId);
  }

  private async assertSyllabusItem(tx: Tx, syllabusItemId: string, courseId: string): Promise<void> {
    const item = await tx.courseSyllabusItem.findUnique({ where: { id: syllabusItemId }, select: { courseId: true } });
    if (!item) throw lessonsError.syllabusItemNotFound(syllabusItemId);
    if (item.courseId !== courseId) throw lessonsError.syllabusItemMismatch(syllabusItemId, courseId);
  }

  private async assertRoomUsable(tx: Tx, roomId: string): Promise<void> {
    const room = await tx.room.findUnique({ where: { id: roomId }, select: { isActive: true } });
    if (!room) throw lessonsError.roomNotFound(roomId);
    if (!room.isActive) throw lessonsError.roomInactive(roomId);
  }

  /**
   * After a 23P01 from `ex_lessons_room` / `ex_lessons_teacher`: the first
   * booking that overlaps a non-cancelled lesson holding the same resource
   * (half-open instants), other than the booking's own lesson.
   */
  private async conflictFor(resource: LessonConflictResource, bookings: readonly Booking[]): Promise<Error> {
    for (const booking of bookings) {
      const held = resource === 'room' ? booking.roomId : booking.teacherUserId;
      if (held === null) continue;
      const other = await this.prisma.db.lesson.findFirst({
        where: {
          ...(booking.lessonId !== null ? { id: { not: booking.lessonId } } : {}),
          status: { not: 'cancelled' },
          ...(resource === 'room' ? { roomId: held } : { teacherUserId: held }),
          startsAt: { lt: booking.endsAt },
          endsAt: { gt: booking.startsAt },
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        select: { id: true, classId: true },
      });
      if (other) return lessonsError.lessonConflict(resource, other.id, other.classId);
    }
    return lessonsError.lessonConflict(resource, null, null);
  }

  private async read(db: Db, id: string): Promise<LessonDto> {
    const row = await db.lesson.findUniqueOrThrow({ where: { id }, select: LESSON_SELECT });
    return toLessonDto(row, await this.attendanceCounts(db, [id]));
  }

  /** Attendance records per lesson and status for a page of lessons (one grouped query). */
  private async attendanceCounts(db: Db, lessonIds: readonly string[]): Promise<AttendanceCounts> {
    if (lessonIds.length === 0) return {};
    const groups = await db.attendanceRecord.groupBy({ by: ['lessonId', 'status'], where: { lessonId: { in: [...lessonIds] } }, _count: { _all: true } });
    const counts: AttendanceCounts = {};
    for (const group of groups) {
      const entry = (counts[group.lessonId] ??= { ...EMPTY_COUNTS });
      entry.recorded += group._count._all;
      entry[group.status as AttendanceStatus] += group._count._all;
    }
    return counts;
  }
}
