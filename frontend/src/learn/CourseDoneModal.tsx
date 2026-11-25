// The short confirmation that the course is complete (MOD-20 — D-R135): shown
// only when a completion answer of the server said the course became complete
// (API-233/234 `course.isComplete` with `completedNow`), never because the
// learner opened the last lesson.
import { CheckCircleFilled } from '@ant-design/icons'
import { Button, Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { LearningCertificate } from '../api/learning'

export function CourseDoneModal({ open, onClose, certificate = null }: { open: boolean; onClose: () => void; certificate?: LearningCertificate | null }) {
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
        certificate ? (
          <Button key="certificate" type="primary" onClick={() => navigate('/my-certificates')}>
            {t('learn.done.viewCertificate')}
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
        <span>{certificate ? t('learn.done.certificateText', { serial: certificate.serial }) : t('learn.done.text')}</span>
      </p>
      {/* J-F67: the automatic certificate also waits for the class's exams — say so when none came with this answer. */}
      {certificate ? null : <p className="learn-done__hint">{t('learn.done.examsHint')}</p>}
    </Modal>
  )
}
