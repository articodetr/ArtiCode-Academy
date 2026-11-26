// The short confirmation that the course is complete (MOD-20 — D-R135): shown
// only when a completion answer of the server said the course became complete
// (API-233/234 `course.isComplete` with `completedNow`), never because the
// learner opened the last lesson.
import { CheckCircleFilled } from '@ant-design/icons'
import { Button, Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export interface CourseDoneModalProps {
  open: boolean
  onClose: () => void
  /** What comes next where the page has its own step (J-F67: the exams and the certificate of «دروسي»); «back to my classes» otherwise. */
  next?: { label: string; onClick: () => void }
}

export function CourseDoneModal({ open, onClose, next }: CourseDoneModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('learn.done.title')}
      footer={[
        <Button key="review" onClick={onClose}>
          {t('learn.done.keepReviewing')}
        </Button>,
        next ? (
          <Button key="next" type="primary" onClick={next.onClick}>
            {next.label}
          </Button>
        ) : (
          <Button key="school" type="primary" onClick={() => navigate('/my-classes')}>
            {t('learn.done.backToMySchool')}
          </Button>
        ),
      ]}
      destroyOnHidden
    >
      <p className="learn-done">
        <CheckCircleFilled className="learn-done__icon" aria-hidden />
        <span>{t('learn.done.text')}</span>
      </p>
    </Modal>
  )
}
