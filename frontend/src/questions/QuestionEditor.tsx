// The question editor (MOD-09 phase 2 — OEX-T07): API-266 for a new question
// of the bank on screen, API-268 with the smallest PATCH for an existing one.
// The parent mounts it per session (KI-049: a form instance kept across
// sessions would bring back an earlier question's values), in a drawer whose
// footer keeps the save buttons in view however long the question is.
//
//   - The type is chosen at creation only; an existing question shows it, fixed.
//   - Two ways to save: «حفظ كمسودة» (status `draft` — the type and an Arabic
//     prompt are enough) and «حفظ وجعله جاهزاً» (status `ready` — every rule of
//     the type). An archived question has one save and stays archived.
//   - Before any request the field rules run (the Arabic prompt, the lengths,
//     the points, the tags, each written option), then the server's rules for
//     the status the save asks for, mirrored in questions.rules.ts; what they
//     find is listed above the form — where the focus goes — and shown again
//     where it is fixed, under the options or on the true/false key, and it
//     follows the edits. A server `question_invalid { problems }` lands on the
//     same places, problem by problem.
//   - An edit sends only what changed (planQuestionPatch()): the options as the
//     whole ordered list and only when they differ; nothing changed sends
//     nothing.
//   - Unsaved work is never dropped silently: while the form holds any, Escape
//     and a mask click do nothing, × and «cancel» ask first (common.unsaved.*),
//     a browser back/forward asks the same question (NavigationBlocker) and a
//     reload or a tab close gets the browser's own prompt.
//   - A question or a bank that is gone (404) ends the session's saving — the
//     form stays, so its text can be copied — and the page re-reads its lists.
//
// The page shows answer keys: nothing here is a learner's view, and there is no
// preview or share link.
//
// CH-0376: `forExam` — opened from an online exam's «كتابة سؤال جديد»: a new question only, ONE save
// («حفظ وإضافة إلى الاختبار» = ready, since a draft cannot be linked to an exam) and a line saying the
// question is also kept in the bank; the exam's tab adds the saved question to its list.
import { Alert, App, Button, Col, Drawer, Flex, Form, Input, InputNumber, Radio, Row, Select, Space, Tag, Typography } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QUESTION_DIFFICULTIES, QUESTION_TAGS_MAX, QUESTION_TAG_MAX_LENGTH, QUESTION_TEXT_MAX_LENGTH, QUESTION_TYPES, createQuestion, updateQuestion } from '../api/questionBanks'
import type { Question, QuestionBank, QuestionProblem, QuestionStatus, QuestionType } from '../api/questionBanks'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { QuestionOptionsField } from './QuestionOptionsField'
import { describeQuestionsFailure, failureMessage, isGoneFailure, isQuestionsFailure } from './questions.errors'
import { NO_DIFFICULTY, buildCreateQuestionInput, formProblems, newQuestionForm, problemsAt, questionFormValuesOf } from './questions.form'
import type { QuestionFormValues } from './questions.form'
import { QUESTION_STATUS_COLORS } from './questions.format'
import { planQuestionPatch, questionFormHasChanges, statusAfterSave } from './questions.patch'
import type { SaveTarget } from './questions.patch'
import { normalizeTags } from './questions.rules'
import { isQuestionPointsValid, tagsProblemOf } from './questions.validation'

interface QuestionEditorProps {
  /** The bank on screen: a new question goes into it. */
  bank: QuestionBank
  /** The question to edit; null writes a new one. */
  question: Question | null
  onClose: () => void
  /** The question as the server returned it; `created` tells a new question from an edit. */
  onSaved: (question: Question, created: boolean) => void
  /** The question or its bank is gone (404): the page re-reads what it shows. */
  onStale: (gone: 'question' | 'bank') => void
  /** CH-0376: written from an exam — one «save and add» button (status `ready`). */
  forExam?: boolean
}

/** What a refused save found: the problems, the status they were checked for, and who found them. */
interface Refusal {
  problems: QuestionProblem[]
  status: QuestionStatus
  fromServer: boolean
}

/** Tags are separated by Enter, a comma (Latin or Arabic) or a semicolon. */
const TAG_SEPARATORS = [',', '،', ';', '؛']

export function QuestionEditor({ bank, question, onClose, onSaved, onStale, forExam = false }: QuestionEditorProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  // Untyped so setFields and the list name paths are accepted as they are.
  const [form] = Form.useForm()
  const [initialValues] = useState<QuestionFormValues>(() => (question ? questionFormValuesOf(question) : newQuestionForm()))
  const [type, setType] = useState<QuestionType>(initialValues.type)
  const [saving, setSaving] = useState<SaveTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  // A 404 ended this session's saving; the form stays so its text can be copied.
  const [stopped, setStopped] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  // One save at a time — from the click, before the buttons show it.
  const busy = useRef(false)
  const problemsBox = useRef<HTMLDivElement>(null)

  const archived = question?.status === 'archived'

  /** The whole store: the rows keep what no field registers (`isCorrect`, a Turkish text), which getFieldsValue() without `true` drops. */
  const read = () => form.getFieldsValue(true) as QuestionFormValues

  const close = () => {
    setUnsaved(false)
    onClose()
  }

  // × and «cancel» (Escape and the mask too while nothing is unsaved) ask first while the form holds unsaved work, and so
  // does a browser back/forward (NavigationBlocker below) — one question; a reload or a tab close gets the browser's prompt.
  const { requestClose, holdNavigation } = useUnsavedChangesGuard(unsaved, close)

  /** After every change: what the form holds, and what is left of a refused save's problems. */
  const changed = () => {
    const values = read()
    setUnsaved(questionFormHasChanges(question, values))
    setRefusal((current) => {
      if (!current) return null
      const problems = formProblems(values, current.status)
      return problems.length > 0 ? { problems, status: current.status, fromServer: false } : null
    })
  }

  /** One save: the field rules, then the server's rules for the status asked for, then the request. */
  const attempt = async (target: SaveTarget) => {
    setError(null)
    try {
      await form.validateFields()
    } catch (caught) {
      const first = (caught as { errorFields?: { name: (string | number)[] }[] }).errorFields?.[0]
      if (first) form.scrollToField(first.name, { block: 'center', focus: true })
      return
    }
    const values = read()
    const status = statusAfterSave(question, target)
    // The server's rules for that status, before any request.
    const problems = formProblems(values, status)
    if (problems.length > 0) {
      setRefusal({ problems, status, fromServer: false })
      problemsBox.current?.focus()
      return
    }
    setRefusal(null)
    const patch = question ? planQuestionPatch(question, values, target) : null
    if (question && !patch) {
      message.info(t('questionBanks.editor.nothingChanged'))
      close()
      return
    }
    setSaving(target)
    try {
      const saved = question && patch ? await updateQuestion(question.id, patch) : await createQuestion(bank.id, buildCreateQuestionInput(values, target === 'ready' ? 'ready' : 'draft'))
      // Saved: nothing is left to lose, even before the page closes the editor.
      setUnsaved(false)
      onSaved(saved, question === null)
    } catch (caught) {
      const failure = describeQuestionsFailure(caught)
      if (failure.problems?.length) setRefusal({ problems: failure.problems, status, fromServer: true })
      else setError(failureMessage(t, failure))
      if (isGoneFailure(failure)) {
        setStopped(true)
        onStale(isQuestionsFailure(failure, 'question_bank_not_found') ? 'bank' : 'question')
      }
      setSaving(null)
      problemsBox.current?.focus()
    }
  }

  /** A second click while a save is being checked or sent does nothing. */
  const save = async (target: SaveTarget) => {
    if (busy.current || stopped) return
    busy.current = true
    try {
      await attempt(target)
    } finally {
      busy.current = false
    }
  }

  const maxLength = (max: number) => ({ max, message: t('questionBanks.editor.validation.maxLength', { max }) })

  /** An English text needs the Arabic one: the server requires `ar` in every localized object. */
  const arabicFirst = (arField: string) => ({
    validator: (_: unknown, value: string | undefined) =>
      !value?.trim() || (form.getFieldValue(arField) as string | undefined)?.trim() ? Promise.resolve() : Promise.reject(new Error(t('questionBanks.editor.validation.arabicFirst'))),
  })

  // Every problem is listed above the form (the save buttons are in the footer, the options may be far below) and
  // shown again where it is fixed: under the options, or on the true/false key.
  const shown = refusal?.problems ?? []
  const optionProblems = problemsAt(type, shown, 'options')
  const answerProblems = problemsAt(type, shown, 'answer')
  const headline = error ?? (refusal ? t(refusal.fromServer ? 'questionBanks.editor.serverRefused' : 'questionBanks.editor.refused') : null)

  return (
    <Drawer
      open
      onClose={() => {
        if (saving === null) requestClose()
      }}
      // Unsaved work turns off the Escape key and the mask click; a Select open on top still closes on Escape.
      keyboard={!unsaved}
      mask={{ closable: !unsaved }}
      title={
        <Space wrap>
          <span>{question ? t('questionBanks.editor.editTitle') : t('questionBanks.editor.createTitle')}</span>
          {question ? <Tag color={QUESTION_STATUS_COLORS[question.status]}>{t(`questionBanks.statuses.${question.status}`)}</Tag> : null}
        </Space>
      }
      // antd 6: `size` takes a CSS length; the panel never exceeds a phone viewport.
      size="min(760px, 100vw)"
      destroyOnHidden
      footer={
        <Flex gap={8} justify="flex-end" wrap>
          <Button onClick={requestClose} disabled={saving !== null}>
            {t('common.cancel')}
          </Button>
          {forExam && !question ? (
            <Button type="primary" loading={saving === 'ready'} disabled={stopped} onClick={() => void save('ready')}>
              {t('examOnline.editor.write.saveAndAdd')}
            </Button>
          ) : archived ? (
            <Button type="primary" loading={saving === 'keep'} disabled={stopped} onClick={() => void save('keep')}>
              {t('common.save')}
            </Button>
          ) : (
            <>
              <Button loading={saving === 'draft'} disabled={stopped || saving === 'ready'} onClick={() => void save('draft')}>
                {t('questionBanks.editor.saveDraft')}
              </Button>
              <Button type="primary" loading={saving === 'ready'} disabled={stopped || saving === 'draft'} onClick={() => void save('ready')}>
                {t('questionBanks.editor.saveReady')}
              </Button>
            </>
          )}
        </Flex>
      }
    >
      <NavigationBlocker when={unsaved} onBlocked={holdNavigation} />

      {forExam && !question ? (
        <Alert type="info" showIcon title={t('examOnline.editor.write.hint')} description={t('examOnline.editor.write.bankNote', { name: localizedLabel(bank.name, language) })} style={{ marginBottom: 16 }} />
      ) : (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {t('questionBanks.editor.bank', { name: localizedLabel(bank.name, language) })}
        </Typography.Paragraph>
      )}

      {/* The outcome of a refused save: focused when it appears, so a screen reader reads it and the page shows it. */}
      <div ref={problemsBox} tabIndex={-1} data-testid="question-editor-outcome" style={{ outline: 'none' }}>
        {headline ? (
          <Alert
            type="error"
            showIcon
            title={headline}
            description={
              shown.length > 0 || stopped ? (
                <>
                  {shown.map((problem) => (
                    <div key={problem}>{t(`questionBanks.problems.${problem}`)}</div>
                  ))}
                  {stopped ? <div>{t('questionBanks.editor.stopped')}</div> : null}
                </>
              ) : undefined
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}
      </div>

      {question && question.examCount > 0 ? (
        <Alert
          type="info"
          showIcon
          title={t('questionBanks.questions.usedIn', { count: question.examCount })}
          description={t('questionBanks.editor.inUse')}
          style={{ marginBottom: 16 }}
          data-testid="question-in-use"
        />
      ) : null}
      {archived ? <Alert type="warning" showIcon title={t('questionBanks.editor.hints.archived')} style={{ marginBottom: 16 }} /> : null}

      <Form
        form={form}
        name="question-editor"
        layout="vertical"
        requiredMark={false}
        initialValues={initialValues}
        // Synchronous, so an Escape pressed right after a keystroke already finds the work (J-F23).
        onValuesChange={(changedValues: Partial<QuestionFormValues>) => {
          if (changedValues.type) setType(changedValues.type)
          changed()
        }}
        // Not while `stopped`: the text of a question that can no longer be saved stays selectable, to be copied.
        disabled={saving !== null}
      >
        {question ? (
          <Form.Item label={t('questionBanks.editor.fields.type')} extra={t('questionBanks.editor.hints.typeFixed')}>
            <Tag data-testid="question-type">{t(`questionBanks.types.${question.type}`)}</Tag>
          </Form.Item>
        ) : (
          <Form.Item name="type" label={t('questionBanks.editor.fields.type')} extra={t('questionBanks.editor.hints.type')}>
            <Radio.Group
              name="question-editor-type"
              aria-label={t('questionBanks.editor.fields.type')}
              options={QUESTION_TYPES.map((value) => ({ value, label: t(`questionBanks.types.${value}`) }))}
            />
          </Form.Item>
        )}

        <Form.Item
          name="promptAr"
          label={t('questionBanks.editor.fields.promptAr')}
          rules={[{ required: true, whitespace: true, message: t('questionBanks.editor.validation.promptArRequired') }, maxLength(QUESTION_TEXT_MAX_LENGTH)]}
        >
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} maxLength={QUESTION_TEXT_MAX_LENGTH} />
        </Form.Item>
        <Form.Item hidden name="promptEn" label={t('questionBanks.editor.fields.promptEn')} dependencies={['promptAr']} rules={[maxLength(QUESTION_TEXT_MAX_LENGTH), arabicFirst('promptAr')]}>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} dir="ltr" maxLength={QUESTION_TEXT_MAX_LENGTH} />
        </Form.Item>

        {type === 'single_choice' ? (
          <QuestionOptionsField form={form} problems={optionProblems} onChanged={changed} />
        ) : (
          <Form.Item
            name="correctAnswer"
            label={t('questionBanks.editor.fields.correctAnswer')}
            validateStatus={answerProblems.length > 0 ? 'error' : undefined}
            help={answerProblems.length > 0 ? answerProblems.map((problem) => t(`questionBanks.problems.${problem}`)).join(' ') : undefined}
          >
            <Radio.Group
              name="question-editor-correct-answer"
              aria-label={t('questionBanks.editor.fields.correctAnswer')}
              options={[
                { value: true, label: t('questionBanks.editor.answerTrue') },
                { value: false, label: t('questionBanks.editor.answerFalse') },
              ]}
            />
          </Form.Item>
        )}

        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="points"
              label={t('questionBanks.editor.fields.points')}
              extra={t('questionBanks.editor.hints.points')}
              rules={[
                { required: true, message: t('questionBanks.editor.validation.pointsRequired') },
                {
                  validator: (_: unknown, value: unknown) =>
                    value === null || value === undefined || isQuestionPointsValid(value) ? Promise.resolve() : Promise.reject(new Error(t('questionBanks.editor.validation.points'))),
                },
              ]}
            >
              {/* No min/max: antd would clamp a typed value silently on blur — the rule words the refusal instead. */}
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="difficulty" label={t('questionBanks.editor.fields.difficulty')}>
              <Select<string>
                options={[
                  { value: NO_DIFFICULTY, label: t('questionBanks.difficulties.none') },
                  ...QUESTION_DIFFICULTIES.map((value) => ({ value, label: t(`questionBanks.difficulties.${value}`) })),
                ]}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="tags"
          label={t('questionBanks.editor.fields.tags')}
          extra={t('questionBanks.editor.hints.tags')}
          // As the server stores them: trimmed, lower-cased, without repeats — the field shows what will be saved.
          normalize={(value: string[] | undefined) => normalizeTags(value ?? [])}
          rules={[
            {
              validator: (_: unknown, value: string[] | undefined) => {
                const problem = tagsProblemOf(value)
                if (!problem) return Promise.resolve()
                const max = problem === 'tagsMax' ? QUESTION_TAGS_MAX : QUESTION_TAG_MAX_LENGTH
                return Promise.reject(new Error(t(`questionBanks.editor.validation.${problem}`, { max })))
              },
            },
          ]}
        >
          <Select<string[]> mode="tags" tokenSeparators={TAG_SEPARATORS} maxCount={QUESTION_TAGS_MAX} open={false} suffixIcon={null} />
        </Form.Item>

        <Form.Item name="explanationAr" label={t('questionBanks.editor.fields.explanationAr')} extra={t('questionBanks.editor.hints.explanation')} rules={[maxLength(QUESTION_TEXT_MAX_LENGTH)]}>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} maxLength={QUESTION_TEXT_MAX_LENGTH} />
        </Form.Item>
        <Form.Item hidden
          name="explanationEn"
          label={t('questionBanks.editor.fields.explanationEn')}
          dependencies={['explanationAr']}
          rules={[maxLength(QUESTION_TEXT_MAX_LENGTH), arabicFirst('explanationAr')]}
        >
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} dir="ltr" maxLength={QUESTION_TEXT_MAX_LENGTH} />
        </Form.Item>

        {archived || forExam ? null : (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t('questionBanks.editor.hints.statuses')}
          </Typography.Paragraph>
        )}
      </Form>
    </Drawer>
  )
}
