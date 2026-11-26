// One class tab of the course drawer: the class drawer's own component for that
// tab (teachers, students, weekly schedule, learning progress, grades,
// certificates), mounted on the course's class that useCourseClass resolved.
// Above it: the read's error with a retry, a selector when the course has more
// than one class to choose from (legacy data of the old classes page), and —
// for our general class created but not opened yet — the button that finishes
// it. Without a class: a published course offers holders of `classes.manage`
// «تجهيز الدورة للمدرسين والطلاب» (courseClasses.ts), anyone else reads why
// there is nothing here. Everything shown is the server's answer.
import { TeamOutlined } from '@ant-design/icons'
import { Alert, App, Button, Empty, Flex, Select, Skeleton, Typography } from 'antd'
import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import type { AcademyClass } from '../api/classes'
import type { Course } from '../api/courses'
import { useAuth } from '../auth/auth-context'
import { ClassCertificatesTab } from '../certificates/ClassCertificatesTab'
import { ClassTeachersTab } from '../classes/ClassTeachersTab'
import { describeClassesFailure, failureMessage } from '../classes/classes.errors'
import { ClassEnrollmentsTab } from '../enrollments/ClassEnrollmentsTab'
import { canReadRoster } from '../enrollments/enrollments.status'
import { ClassGradebookTab } from '../grades/ClassGradebookTab'
import { useLocalized } from '../i18n/useLocalized'
import { ClassLearningProgressTab } from '../learningProgress/ClassLearningProgressTab'
import { ClassScheduleTab } from '../schedule/ClassScheduleTab'
import { localizedLabel } from '../users/users.format'
import { awaitsOpening } from './courses.classScope'
import type { CourseClassEditorTab, CourseClassTab } from './courses.classScope'
import { defaultStartsOn } from './courses.openEnrollment'
import type { CourseClassScope, PrepareFailure } from './useCourseClass'

interface CourseClassTabPaneProps {
  tab: CourseClassTab
  course: Course
  scope: CourseClassScope
  /** A class tab holds unsaved work: switching the class would drop it, so the selector waits. */
  locked: boolean
  /** The course drawer's stable reporters of the editors' unsaved work (KI-052/KI-054). */
  onUnsavedChange: Readonly<Record<CourseClassEditorTab, (unsaved: boolean) => void>>
}

export function CourseClassTabPane({ tab, course, scope, locked, onUnsavedChange }: CourseClassTabPaneProps) {
  const { t } = useTranslation()
  const { user, hasPermission } = useAuth()
  const { classes, failed, selected } = scope

  const content = (cls: AcademyClass): ReactNode => {
    switch (tab) {
      case 'teachers':
        return <ClassTeachersTab cls={cls} onUpdated={scope.replace} onUnsavedChange={onUnsavedChange.teachers} />
      case 'students':
        // The class drawer's gate (D-R16): `enrollments.manage`, or teaching this class — the server answers 404 otherwise.
        return canReadRoster(hasPermission, cls, user?.id) ? (
          <ClassEnrollmentsTab
            cls={cls}
            onClassChanged={scope.replace}
            onStale={() => void scope.refresh()}
            classReadFailed={failed}
            rosterRefresh={scope.rosterRefresh}
            onUnsavedChange={onUnsavedChange.students}
          />
        ) : (
          <Alert type="info" showIcon title={t('courseClass.rosterHidden')} />
        )
      case 'schedule':
        return <ClassScheduleTab cls={cls} onUnsavedChange={onUnsavedChange.schedule} />
      case 'learning':
        return canReadRoster(hasPermission, cls, user?.id) ? <ClassLearningProgressTab cls={cls} /> : <Alert type="info" showIcon title={t('courseClass.rosterHidden')} />
      case 'gradebook':
        return <ClassGradebookTab cls={cls} />
      case 'certificates':
        return <ClassCertificatesTab cls={cls} />
    }
  }

  return (
    <>
      {failed ? (
        <Alert
          type="error"
          showIcon
          title={t('courseClass.loadFailed')}
          action={
            <Button size="small" onClick={scope.retry}>
              {t('courseClass.retry')}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <PrepareFailureAlert failure={scope.prepareFailure} onClose={scope.dismissPrepareFailure} />

      {classes === null && !failed ? <Skeleton active paragraph={{ rows: 4 }} data-testid="course-class-loading" /> : null}

      {classes !== null && scope.showSelector ? <ClassSelector scope={scope} locked={locked} /> : null}

      {classes !== null && selected ? (
        // A class switched in the selector mounts its own components (and their editors) afresh.
        <Fragment key={selected.id}>
          {awaitsOpening(selected) ? <ResumeNotice course={course} scope={scope} /> : null}
          {content(selected)}
        </Fragment>
      ) : null}

      {classes !== null && !selected ? <NoClassState course={course} scope={scope} /> : null}
    </>
  )
}

function ClassSelector({ scope, locked }: { scope: CourseClassScope; locked: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <Flex vertical gap={4} style={{ marginBottom: 12 }} data-testid="course-class-selector">
      <Flex align="center" gap={8} wrap>
        <Typography.Text type="secondary">{t('courseClass.selector.label')}</Typography.Text>
        <Select<string>
          aria-label={t('courseClass.selector.label')}
          value={scope.selected?.id}
          placeholder={t('courseClass.selector.placeholder')}
          onChange={scope.select}
          disabled={locked}
          popupMatchSelectWidth={false}
          options={scope.choices.map((klass) => ({
            value: klass.id,
            label: (
              <span>
                {localizedLabel(klass.name, language)} (<bdi dir="ltr">{klass.code}</bdi>) — {t(`labels.${klass.status}`)}
              </span>
            ),
          }))}
          style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 420 }}
        />
      </Flex>
      {locked ? <Typography.Text type="secondary">{t('courseClass.selector.locked')}</Typography.Text> : null}
    </Flex>
  )
}

function NoClassState({ course, scope }: { course: Course; scope: CourseClassScope }) {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  // A class needs a published course: the server answers `422 course_not_published` otherwise.
  if (course.status !== 'published') return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('courseClass.empty.unpublished')} />
  if (!hasPermission('classes.manage')) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('courseClass.empty.noPermission')} />
  return (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('courseClass.empty.prepare')}>
      <Flex vertical gap={8} align="center">
        <PrepareButton course={course} scope={scope} />
        <Typography.Text type="secondary">{t('courseClass.prepare.hint')}</Typography.Text>
      </Flex>
    </Empty>
  )
}

/** Our general class is still planned (a press stopped half way): the same button opens it. */
function ResumeNotice({ course, scope }: { course: Course; scope: CourseClassScope }) {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  if (course.status !== 'published' || !hasPermission('classes.manage')) return null
  return <Alert type="warning" showIcon title={t('courseClass.prepare.resume')} action={<PrepareButton course={course} scope={scope} size="small" />} style={{ marginBottom: 12 }} />
}

function PrepareButton({ course, scope, size }: { course: Course; scope: CourseClassScope; size?: 'small' }) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  // The new class starts today in the academy's zone, as the panel's: wait for the shared reading.
  const { academy, loading } = useAcademy()
  const waiting = loading && academy === null

  const press = async () => {
    const outcome = await scope.prepare(course, defaultStartsOn(academy))
    if (outcome === 'prepared') message.success(t('courseClass.prepare.done'))
  }

  return (
    <Button type="primary" size={size} icon={<TeamOutlined />} loading={scope.preparing || waiting} onClick={() => void press()}>
      {t('courseClass.prepare.action')}
    </Button>
  )
}

function PrepareFailureAlert({ failure, onClose }: { failure: PrepareFailure | null; onClose: () => void }) {
  const { t } = useTranslation()
  if (!failure) return null
  const text =
    failure.kind === 'unpublished'
      ? t('courseClass.empty.unpublished')
      : failure.kind === 'codes_exhausted'
        ? t('courseClass.prepare.codesExhausted')
        : failureMessage(t, describeClassesFailure(failure.error))
  return <Alert type="error" showIcon closable={{ onClose }} title={text} style={{ marginBottom: 12 }} data-testid="course-class-prepare-failure" />
}
