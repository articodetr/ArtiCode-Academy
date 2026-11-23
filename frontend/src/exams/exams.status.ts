// Exam actions menu and field locks of the exam drawer (J-F45): a manual
// mirror of the backend state machine (backend/src/exams/exams.status.ts) and
// of the class rules of backend/src/exams/exams.policy.ts — keep the two in
// sync. The server stays the boundary (409 invalid_transition / exam_has_results
// / exam_locked / exam_not_deletable / class_closed).
//
//   schedule    draft     → scheduled  (the learners see the exam; refused for a cancelled class)
//   unschedule  scheduled → draft      (only while the exam holds no result — exam_has_results)
//   publish     scheduled → published  (sets publishedAt; the learners see their results; refused for a cancelled class)
//   unpublish   published → scheduled  (clears publishedAt; the results are hidden again)
//   delete      a draft or scheduled exam without any result (API-118), whatever the class status
//
// Editing: every field in every status unless the class is cancelled (a
// completed class keeps its exams open for corrections — the D-R33 pattern);
// `maxScore` is locked once a result exists. A new exam needs a planned, open
// or running class.
//
// MOD-09 phase 2 — an ONLINE exam (a manual one goes through the lines above
// unchanged). The four actions keep their names and their transitions (D-R151):
//
//   schedule    makes the exam available inside its window; the server checks that it is ready (exam_not_ready) and
//               freezes a copy of its questions
//   unschedule  not once somebody has started (exam_has_attempts)
//   publish     releases the results after the window has closed (exam_window_open — decided at the server's clock,
//               so the menu still offers it)
//   delete      not once somebody has started (exam_not_deletable with attemptCount), even without a result
//
// and the field locks of its settings are lockedOnlineFields() below, a mirror
// of the function of the same name in backend/src/exams/exams.online.ts — keep
// the two in sync.
import type { ClassStatus } from '../api/classes'
import { EXAM_STATUS_ACTIONS } from '../api/exams'
import type { Exam, ExamDelivery, ExamOnlineSummary, ExamStatus, ExamStatusAction, UpdateExamInput } from '../api/exams'

export type ExamMenuAction = ExamStatusAction | 'delete'

const TRANSITIONS: Readonly<Record<ExamStatusAction, Partial<Readonly<Record<ExamStatus, ExamStatus>>>>> = {
  schedule: { draft: 'scheduled' },
  unschedule: { scheduled: 'draft' },
  publish: { scheduled: 'published' },
  unpublish: { published: 'scheduled' },
}

/** A new exam is created for a class in one of these states (`EXAM_CREATE_CLASS_STATUSES`). */
export const EXAM_CREATE_CLASS_STATUSES: readonly ClassStatus[] = ['planned', 'open', 'running']

/** True when a new exam may be created for the class. */
export function isClassOpenForNewExam(status: ClassStatus): boolean {
  return EXAM_CREATE_CLASS_STATUSES.includes(status)
}

/** An exam of a cancelled class takes no edit, no `schedule`/`publish` and no result (`isClassFrozenForExams()`). */
export function isClassFrozenForExams(status: ClassStatus): boolean {
  return status === 'cancelled'
}

/** The status the action leads to from `from`, or null when not allowed. */
export function nextExamStatus(action: ExamStatusAction, from: ExamStatus): ExamStatus | null {
  return TRANSITIONS[action][from] ?? null
}

/** Actions allowed from a status, in catalogue order (the `allowed` detail of `invalid_transition`). */
export function allowedExamActions(from: ExamStatus): ExamStatusAction[] {
  return EXAM_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined)
}

/** `schedule` and `publish` move an exam forward — refused for a cancelled class. */
export function actionNeedsLiveClass(action: ExamStatusAction): boolean {
  return action === 'schedule' || action === 'publish'
}

/** Only a draft or scheduled exam without any result may be deleted — and, for an online exam, one nobody has started. */
export function isExamDeletable(status: ExamStatus, resultCount: number, attemptCount = 0): boolean {
  return (status === 'draft' || status === 'scheduled') && resultCount === 0 && attemptCount === 0
}

/**
 * How many students have started an online exam (0 for a manual one). The
 * server counts `exam_attempts` rows; the DTO's `online.attempts.students`
 * counts the students holding one — both are zero together, which is all the
 * rules ask («has somebody started?»).
 */
export function startedStudentsOf(exam: { online?: ExamOnlineSummary | null }): number {
  return exam.online?.attempts.students ?? 0
}

/** The fields a recorded result relies on — locked once a result exists (`EXAM_RESULT_LOCKED_FIELDS`). */
export const EXAM_RESULT_LOCKED_FIELDS = ['maxScore'] as const

/** Which of the requested fields the exam refuses: `maxScore` once a result exists, nothing otherwise (mirror of `lockedExamFields()`). */
export function lockedExamFields(resultCount: number, requested: readonly string[]): string[] {
  if (resultCount === 0) return []
  return requested.filter((field) => (EXAM_RESULT_LOCKED_FIELDS as readonly string[]).includes(field))
}

/**
 * The number of recorded results. The server counts `exam_results` rows; the
 * DTO's `results.students` counts the students holding one — one row per
 * student, so the two are the same number.
 */
export function resultCountOf(exam: Pick<Exam, 'results'>): number {
  return exam.results.students
}

export interface ExamEditability {
  /** The edit form may open at all (needs `exams.manage` and a class that is not cancelled). */
  editable: boolean
  /** `maxScore` is read-only (a result exists). */
  maxScoreLocked: boolean
}

export function examEditability(exam: Pick<Exam, 'class' | 'results'>, canManage: boolean): ExamEditability {
  const maxScoreLocked = resultCountOf(exam) > 0
  return { editable: canManage && !isClassFrozenForExams(exam.class.status), maxScoreLocked }
}

/**
 * What the menu offers: nothing without `exams.manage`; the status actions the
 * state machine allows — `schedule`/`publish` not for a cancelled class,
 * `unschedule` only without results (`exam_has_results`) — then `delete` for a
 * draft or scheduled exam without results, of a cancelled class too. An online
 * exam somebody has started offers neither `unschedule` (`exam_has_attempts`)
 * nor `delete`.
 */
export function availableExamActions(exam: Pick<Exam, 'status' | 'class' | 'results'> & { online?: ExamOnlineSummary | null }, canManage: boolean): ExamMenuAction[] {
  if (!canManage) return []
  const frozen = isClassFrozenForExams(exam.class.status)
  const results = resultCountOf(exam)
  const started = startedStudentsOf(exam)
  const actions: ExamMenuAction[] = allowedExamActions(exam.status).filter(
    (action) => !(frozen && actionNeedsLiveClass(action)) && !(action === 'unschedule' && (results > 0 || started > 0)),
  )
  if (isExamDeletable(exam.status, results, started)) actions.push('delete')
  return actions
}

/** Actions shown in red and confirmed as dangerous: deleting cannot be undone (the others can be reversed). */
export function isDangerousExamAction(action: ExamMenuAction): boolean {
  return action === 'delete'
}

// ---------------------------------------------------------------------------
// MOD-09 phase 2 — the locks of an online exam's settings (API-116)
// ---------------------------------------------------------------------------

export interface OnlineLockState {
  status: ExamStatus
  /** The delivery stored now. */
  delivery: ExamDelivery
  /** Attempts of any status (here: students who have started — zero together). */
  attemptCount: number
}

export interface OnlineLockValues {
  scheduledAt: string | null
  closesAt: string | null
  durationMinutes: number | null
  attemptsAllowed: number
}

/** The fields the lock rules look at; `undefined` = the request leaves the field alone. */
export interface OnlineLockRequest {
  delivery?: ExamDelivery
  maxScore?: number
  scheduledAt?: string | null
  closesAt?: string | null
  durationMinutes?: number | null
  attemptsAllowed?: number
}

/**
 * Which of the changing fields an exam refuses for its online side (`409
 * exam_locked { fields }`) — the mirror of `lockedOnlineFields()`:
 *   - `delivery` outside a draft (and that is the whole refusal);
 *   - for an online exam the learners can see (scheduled or published):
 *     `maxScore` (frozen with the questions' points) and clearing the opening,
 *     the closing or the time limit;
 *   - once somebody has started: the opening, the time limit, fewer attempts
 *     and an earlier closing.
 * A manual exam is refused nothing here (lockedExamFields() locks its
 * `maxScore` once a result exists).
 */
export function lockedOnlineFields(state: OnlineLockState, current: OnlineLockValues, changes: OnlineLockRequest): string[] {
  if (changes.delivery !== undefined && state.status !== 'draft') return ['delivery']
  const locked = new Set<string>()
  if (state.delivery === 'online' && state.status !== 'draft') {
    if (changes.maxScore !== undefined) locked.add('maxScore')
    if (changes.scheduledAt === null) locked.add('scheduledAt')
    if (changes.closesAt === null) locked.add('closesAt')
    if (changes.durationMinutes === null) locked.add('durationMinutes')
  }
  if (state.delivery === 'online' && state.attemptCount > 0) {
    if (changes.scheduledAt !== undefined) locked.add('scheduledAt')
    if (changes.durationMinutes !== undefined) locked.add('durationMinutes')
    if (changes.attemptsAllowed !== undefined && changes.attemptsAllowed < current.attemptsAllowed) locked.add('attemptsAllowed')
    if (typeof changes.closesAt === 'string' && current.closesAt !== null && Date.parse(changes.closesAt) < Date.parse(current.closesAt)) locked.add('closesAt')
  }
  const order = ['delivery', 'scheduledAt', 'closesAt', 'durationMinutes', 'maxScore', 'attemptsAllowed']
  return order.filter((field) => locked.has(field))
}

type LockableExam = Pick<Exam, 'status' | 'delivery' | 'scheduledAt' | 'closesAt' | 'durationMinutes' | 'attemptsAllowed'> & { online?: ExamOnlineSummary | null }

/**
 * The fields of a planned PATCH the server would refuse for the exam's online
 * side: lockedOnlineFields() fed with the exam as loaded and the fields the
 * smallest PATCH names (it names only what changes, as the server's own plan).
 */
export function lockedOnlineFieldsOf(exam: LockableExam, body: UpdateExamInput): string[] {
  const changes: OnlineLockRequest = {}
  if (body.delivery !== undefined) changes.delivery = body.delivery
  if (body.maxScore !== undefined) changes.maxScore = body.maxScore
  if (body.scheduledAt !== undefined) changes.scheduledAt = body.scheduledAt
  if (body.closesAt !== undefined) changes.closesAt = body.closesAt
  if (body.durationMinutes !== undefined) changes.durationMinutes = body.durationMinutes
  if (body.attemptsAllowed !== undefined) changes.attemptsAllowed = body.attemptsAllowed
  return lockedOnlineFields(
    { status: exam.status, delivery: exam.delivery, attemptCount: startedStudentsOf(exam) },
    { scheduledAt: exam.scheduledAt, closesAt: exam.closesAt, durationMinutes: exam.durationMinutes, attemptsAllowed: exam.attemptsAllowed },
    changes,
  )
}

/** What the edit form of an exam locks or guards for its online side — the three situations lockedOnlineFields() tells apart. */
export interface OnlineExamLocks {
  /** `delivery` no longer changes: the exam is not a draft. */
  deliveryFixed: boolean
  /** An online exam the learners can see: `maxScore` is frozen, and the opening, the closing and the time limit cannot be cleared. */
  visible: boolean
  /** Somebody has started: the opening and the time limit are fixed, the closing only moves later and the attempts only rise. */
  started: boolean
}

export const NO_ONLINE_LOCKS: OnlineExamLocks = { deliveryFixed: false, visible: false, started: false }

export function onlineExamLocks(exam: Pick<Exam, 'status' | 'delivery'> & { online?: ExamOnlineSummary | null }): OnlineExamLocks {
  const online = exam.delivery === 'online'
  return { deliveryFixed: exam.status !== 'draft', visible: online && exam.status !== 'draft', started: online && startedStudentsOf(exam) > 0 }
}
