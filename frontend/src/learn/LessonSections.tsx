// What a lesson carries beside its content (MOD-20), each part shown only when
// the server returned something for it: the description («نظرة عامة»), the
// downloadable resources, and the class assignments and exams whose session
// covers the lesson (D-R136 — they stay MOD-08/MOD-09 work: the learner opens
// them from «my assignments» and «my exams»; they are never part of the
// lesson's progress).
import { LinkOutlined } from '@ant-design/icons'
import { Tag } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { LearningItem } from '../api/learning'
import { useLocalized } from '../i18n/useLocalized'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { isHttpsUrl } from './learn.format'
import { PlainText } from './PlainText'

const ASSIGNMENT_STATUSES = new Set(['open', 'closed'])
const EXAM_STATUSES = new Set(['scheduled', 'published'])
const EXAM_TYPES = new Set(['quiz', 'midterm', 'final', 'project', 'oral', 'practice', 'other'])

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="learn-card learn-section">
      <h2 className="learn-section__title">{title}</h2>
      {children}
    </section>
  )
}

/**
 * `showExams` false leaves the lesson's exams out: the lesson popup of «دوراتي» and «دروسي» shows them as boxes with
 * where each stands (J-F69 — HubLessonBody).
 */
export function LessonSections({ item, examZone, showExams = true }: { item: LearningItem; examZone: string | undefined; showExams?: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const description = item.description ? localizedLabel(item.description, language) : ''
  const resources = item.resources.filter((resource) => isHttpsUrl(resource.url))

  return (
    <>
      {description.trim() ? (
        <Section title={t('learn.sections.overview')}>
          <PlainText text={description} />
        </Section>
      ) : null}
      {resources.length > 0 ? (
        <Section title={t('learn.sections.resources')}>
          <ul className="learn-list">
            {resources.map((resource) => (
              <li key={resource.url} className="learn-list__row">
                <a className="learn-resource" href={resource.url} target="_blank" rel="noopener noreferrer">
                  <LinkOutlined aria-hidden />
                  <bdi dir="auto">{localizedLabel(resource.title, language)}</bdi>
                  <span className="learn-sr-only"> {t('learn.lesson.newTab')}</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {item.assignments.length > 0 ? (
        <Section title={t('learn.sections.assignments')}>
          <ul className="learn-list">
            {item.assignments.map((assignment) => (
              <li key={assignment.id} className="learn-list__row">
                <div className="learn-list__main">
                  <strong>{localizedLabel(assignment.title, language)}</strong>
                  <span className="learn-muted">
                    {assignment.dueAt
                      ? t('learn.sections.due', { date: formatLessonDateTime(assignment.dueAt, language, assignment.timeZone) })
                      : t('learn.sections.noDue')}
                  </span>
                </div>
                {ASSIGNMENT_STATUSES.has(assignment.status) ? <Tag bordered={false}>{t(`learn.sections.assignmentStatus.${assignment.status}`)}</Tag> : null}
              </li>
            ))}
          </ul>
          <Link className="learn-section__link" to="/my-assignments">
            {t('learn.sections.openAssignments')}
          </Link>
        </Section>
      ) : null}
      {showExams && item.exams.length > 0 ? (
        <Section title={t('learn.sections.exams')}>
          <ul className="learn-list">
            {item.exams.map((exam) => (
              <li key={exam.id} className="learn-list__row">
                <div className="learn-list__main">
                  <strong>{localizedLabel(exam.title, language)}</strong>
                  <span className="learn-muted">
                    {EXAM_TYPES.has(exam.type) ? `${t(`learn.sections.examTypes.${exam.type}`)} · ` : null}
                    {exam.scheduledAt
                      ? t('learn.sections.scheduledAt', {
                          date: examZone ? formatLessonDateTime(exam.scheduledAt, language, examZone) : formatDateTime(exam.scheduledAt, language),
                        })
                      : t('learn.sections.noDate')}
                  </span>
                </div>
                {EXAM_STATUSES.has(exam.status) ? <Tag bordered={false}>{t(`learn.sections.examStatus.${exam.status}`)}</Tag> : null}
              </li>
            ))}
          </ul>
          <Link className="learn-section__link" to="/my-exams">
            {t('learn.sections.openExams')}
          </Link>
        </Section>
      ) : null}
    </>
  )
}
