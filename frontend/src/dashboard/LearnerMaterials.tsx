// «Educational content» on the learner home (J-F63): the books and files of the student's course, each opened or saved
// from here; its title leads to the lesson it belongs to. Only for a student's own course (`canLearn`): a guardian
// follows and has no access to the lessons (D-R132).
import { DownloadOutlined, ExportOutlined, FilePdfOutlined, LinkOutlined, PaperClipOutlined } from '@ant-design/icons'
import { Alert, Button, Select } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { MyLearningCourse } from '../api/learning'
import { useLocalized } from '../i18n/useLocalized'
import { learnPath } from '../mySchool/mySchool.view'
import { labelIn } from './dashboard.data'
import { materialCoursesOf } from './learner.materials'
import type { MaterialKind, MaterialRow } from './learner.materials'
import { Loading, Panel } from './LearnerPanel'
import { useCourseMaterials } from './useCourseMaterials'
import type { Reloadable } from './useLoad'

const KIND_ICONS: Record<MaterialKind, typeof FilePdfOutlined> = { pdf: FilePdfOutlined, file: PaperClipOutlined, link: LinkOutlined }

function MaterialCard({ row, courseId }: { row: MaterialRow; courseId: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const Icon = KIND_ICONS[row.kind]
  const title = labelIn(row.title ?? row.lessonTitle, language)
  const lesson = labelIn(row.lessonTitle, language)
  const detail = row.title ? lesson : row.fileName
  return (
    <li className="lh-file">
      <span className={`lh-file__icon lh-file__icon--${row.kind}`}>
        <Icon aria-hidden />
      </span>
      <span className="lh-file__body">
        <Link to={`${learnPath(courseId)}/${encodeURIComponent(row.lessonId)}`} title={t('dashboard.learner.openLesson', { title: lesson })}>
          <bdi dir="auto">{title}</bdi>
        </Link>
        <small>
          {t(`dashboard.learner.materialKind.${row.kind}`)}
          {detail ? (
            <>
              {' · '}
              <bdi dir="auto">{detail}</bdi>
            </>
          ) : null}
        </small>
      </span>
      <span className="lh-file__actions">
        <Button size="small" icon={<ExportOutlined aria-hidden />} href={row.url} target="_blank" rel="noopener noreferrer">
          {t('dashboard.learner.openFile')}
          <span className="lh-sr-only">
            {' '}
            {title} {t('learn.lesson.newTab')}
          </span>
        </Button>
        {row.downloadable ? (
          <Button size="small" type="primary" ghost icon={<DownloadOutlined aria-hidden />} href={row.url} download={row.fileName ?? ''} target="_blank" rel="noopener noreferrer">
            {t('dashboard.learner.downloadFile')}
            <span className="lh-sr-only"> {title}</span>
          </Button>
        ) : null}
      </span>
    </li>
  )
}

export function MaterialsPanel({ learning, studentId, ready }: { learning: Reloadable<MyLearningCourse[]>; studentId: string | undefined; ready: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [chosen, setChosen] = useState<string | null>(null)
  const courses = materialCoursesOf(learning.data ?? [], studentId)
  const course = courses.find((item) => item.course.id === chosen) ?? courses[0] ?? null
  // Read after the lessons and exams, so the panel never competes with what the student came for.
  const materials = useCourseMaterials(ready && course ? course.course.id : null)

  if (!learning.loading && !learning.error && courses.length === 0) return null
  return (
    <Panel
      className="lh-materials"
      title={t('dashboard.learner.materials')}
      extra={course ? <Link to={learnPath(course.course.id)}>{t('dashboard.learner.allContent')}</Link> : null}
    >
      <Loading loaded={learning}>
        {() => (
          <>
            {courses.length > 1 && course ? (
              <Select
                className="lh-materials__course"
                aria-label={t('dashboard.learner.materialsCourse')}
                value={course.course.id}
                onChange={setChosen}
                options={courses.map((item) => ({ value: item.course.id, label: labelIn(item.course.name, language) }))}
              />
            ) : null}
            <Loading loaded={ready ? materials : { data: null, loading: true, error: null }}>
              {(found) => (
                <>
                  {found.failed > 0 ? (
                    <Alert
                      className="lh-materials__notice"
                      type="warning"
                      showIcon
                      title={t('dashboard.learner.materialsPartial')}
                      action={
                        <Button size="small" onClick={materials.retry}>
                          {t('dashboard.retry')}
                        </Button>
                      }
                    />
                  ) : null}
                  {found.rows.length ? (
                    <ul className="lh-files">
                      {found.rows.map((row) => (
                        <MaterialCard key={row.key} row={row} courseId={course!.course.id} />
                      ))}
                    </ul>
                  ) : found.failed === 0 ? (
                    <p className="db-muted">{t(found.truncated ? 'dashboard.learner.materialsNoneYet' : 'dashboard.learner.materialsEmpty')}</p>
                  ) : null}
                  {found.rows.length > 0 && found.truncated ? <p className="db-muted lh-materials__hint">{t('dashboard.learner.materialsMore')}</p> : null}
                </>
              )}
            </Loading>
          </>
        )}
      </Loading>
    </Panel>
  )
}
