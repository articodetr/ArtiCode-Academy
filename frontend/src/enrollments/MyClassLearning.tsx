// What «فصولي» shows of a class's course (J-F61, API-229): the learner's progress and the one way into its lessons.
// Every number and the action are the server's (`cardActionOf()`): a guardian follows a child's progress and never
// gets a button (D-R132).
import { Button, Progress, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { MyLearningCourse } from '../api/learning'
import { cardActionOf, learnPath } from '../mySchool/mySchool.view'

export function ClassLearningProgress({ item }: { item: MyLearningCourse }) {
  const { t } = useTranslation()
  const { progress } = item
  if (progress.total === 0) return <Typography.Text type="secondary">{t('mySchool.card.noLessons')}</Typography.Text>
  if (progress.percent === null) return <Typography.Text type="secondary">{t('mySchool.card.noRequired')}</Typography.Text>
  const doneKey = item.relation === 'child' ? 'mySchool.card.childLessonsDone' : 'mySchool.card.lessonsDone'
  return (
    <div style={{ minWidth: 150 }} data-testid={`class-progress-${item.enrollmentId}`}>
      <Progress
        percent={progress.percent}
        size="small"
        status={progress.isComplete ? 'success' : 'normal'}
        format={(percent) => <bdi dir="ltr">{`${percent}%`}</bdi>}
        aria-label={t('mySchool.card.progress')}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t(doneKey, { count: progress.required, completed: progress.completedRequired })}
      </Typography.Text>
    </div>
  )
}

export function ClassLearnButton({ item }: { item: MyLearningCourse }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const action = cardActionOf(item)
  if (!action) return null
  // A course without a published lesson only opens (its class sessions live there); reviewing is the quieter step.
  const noLessons = item.progress.total === 0
  return (
    <Button size="small" type={action !== 'review' && !noLessons ? 'primary' : 'default'} onClick={() => navigate(learnPath(item.course.id))}>
      {t(noLessons ? 'mySchool.card.actions.open' : `mySchool.card.actions.${action}`)}
    </Button>
  )
}
