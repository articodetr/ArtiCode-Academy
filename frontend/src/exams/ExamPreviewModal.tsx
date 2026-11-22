// «معاينة كطالب» of the «الأسئلة» tab (MOD-09 phase 2): the questions of an
// online exam as a learner will see them — their order, each prompt with its
// points, and the choices as radio buttons nobody can press — built from the
// API-270 data the tab already holds, without a request. It records nothing,
// and it shows neither the key nor an explanation nor a correction: the dialog
// renders previewQuestionsOf() only, a projection that carries none of them
// (examQuestions.view.ts).
import { Alert, Button, Empty, Flex, Modal, Radio, Tag, Typography, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ExamQuestionItem } from '../api/examQuestions'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { previewQuestionsOf } from './examQuestions.view'

interface ExamPreviewModalProps {
  /** The exam's title in the active language. */
  title: string
  /** The questions as API-270 answered them, in display order. */
  items: readonly ExamQuestionItem[]
  onClose: () => void
}

export function ExamPreviewModal({ title, items, onClose }: ExamPreviewModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { token } = theme.useToken()
  const questions = previewQuestionsOf(items)

  return (
    <Modal
      open
      title={t('examOnline.preview.title', { title })}
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          {t('examOnline.preview.close')}
        </Button>
      }
      width={720}
      destroyOnHidden
    >
      <Alert type="info" showIcon title={t('examOnline.preview.note')} style={{ marginBottom: 16 }} />
      {questions.length === 0 ? (
        <Empty description={t('examOnline.preview.empty')} />
      ) : (
        <Flex vertical gap={12}>
          {questions.map((question, index) => {
            const promptId = `exam-preview-prompt-${question.id}`
            return (
              <section key={question.id} data-testid="exam-preview-question" style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius, padding: 12 }}>
                <Flex justify="space-between" align="center" wrap gap={8}>
                  <Typography.Text type="secondary">{t('examOnline.preview.question', { number: index + 1, total: questions.length })}</Typography.Text>
                  <Tag>{t('examOnline.questions.points', { points: question.points })}</Tag>
                </Flex>
                {/* A plain element: antd Typography's RTL class would override dir="auto". */}
                <div id={promptId} dir="auto" style={{ fontWeight: 600, whiteSpace: 'pre-wrap', margin: '8px 0' }}>
                  {localizedLabel(question.prompt, language)}
                </div>
                <Radio.Group
                  // One group per question: a shared generated name would make the whole preview one group.
                  name={`exam-preview-${question.id}`}
                  orientation="vertical"
                  disabled
                  aria-labelledby={promptId}
                  options={question.choices.map((choice) => ({
                    value: choice.value,
                    label: choice.text ? localizedLabel(choice.text, language) : t(`examOnline.answers.${choice.answer}`),
                  }))}
                />
              </section>
            )
          })}
        </Flex>
      )}
    </Modal>
  )
}
