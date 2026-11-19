// Why the course player cannot open a course (MOD-20 — D-R132), worded for
// the learner with the one way forward: an own enrollment waiting for payment
// or approval → «my enrollment requests»; no own enrollment → the course in
// the catalog; an unknown course → back to «مدرستي».
import { Button, Result } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { AccessFailure } from './learn.errors'

export function LearnAccessNotice({ failure, courseId }: { failure: AccessFailure; courseId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  let status: 'info' | 'warning' = 'warning'
  let title: string
  let text: string
  let action: { label: string; to: string }
  if (failure.kind === 'pending') {
    status = 'info'
    title = t('learn.access.pendingTitle')
    text = t('learn.access.pendingText')
    action = { label: t('learn.access.pendingLink'), to: '/my-school?section=requests' }
  } else if (failure.kind === 'not_enrolled') {
    title = t('learn.access.notEnrolledTitle')
    text = t('learn.access.notEnrolledText')
    action = { label: t('learn.access.notEnrolledLink'), to: `/catalog/${encodeURIComponent(courseId)}` }
  } else {
    title = t('learn.access.notFoundTitle')
    text = t('learn.access.notFoundText')
    action = { label: t('learn.header.backToMySchool'), to: '/my-school' }
  }
  return (
    <Result
      className="learn-card learn-access"
      status={status}
      title={<h1 className="learn-access__title">{title}</h1>}
      subTitle={text}
      extra={
        <Button
          type="primary"
          href={action.to}
          onClick={(event) => {
            // A real link that looks like a button: a plain click stays in the app, a modified one opens a tab.
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            navigate(action.to)
          }}
        >
          {action.label}
        </Button>
      }
    />
  )
}
