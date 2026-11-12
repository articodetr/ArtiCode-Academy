// The announcement composer (MOD-12-T07 — J-F54): POST /api/announcements
// (API-173) for a holder of `notifications.send`. The audience is a class —
// one the caller teaches, or any with `classes.manage` (the class list of
// API-050 already shows only the classes the caller may read, D-R16) — with
// its students, their guardians and/or its teachers, or, with `classes.manage`
// only, the academy by role. The title (≤ 200) and the body (≤ 4,000) are
// plain text, counted in characters after trimming as the server counts them
// (announcements.form.ts mirrors the DTO and the audience rules, so nothing the
// server would refuse is sent); the e-mail copy is optional and carries the
// title and a link only. Sending asks first — an announcement can be neither
// edited nor withdrawn — and the button stays disabled while the request runs
// (API-173 has no idempotency key). The body is mounted per session (KI-049);
// while it holds unsaved work, Escape and the mask do not close the drawer, the
// close button and «cancel» ask first, a browser back/forward asks the same
// question and a reload gets the browser's prompt (useUnsavedChangesGuard).
import { Alert, App, Button, Checkbox, Drawer, Flex, Form, Input, Radio, Switch, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ANNOUNCEMENT_BODY_MAX_LENGTH,
  ANNOUNCEMENT_CLASS_GROUPS,
  ANNOUNCEMENT_MAX_RECIPIENTS,
  ANNOUNCEMENT_ROLE_KEYS,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
  createAnnouncement,
} from '../api/announcements'
import type { Announcement, AnnouncementClass, CreateAnnouncementInput } from '../api/announcements'
import type { AcademyClass } from '../api/classes'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { useLocalized } from '../i18n/useLocalized'
import { ClassPicker } from '../timetable/TimetablePickers'
import {
  announcementFormHasChanges,
  bodyProblem,
  buildCreateAnnouncementInput,
  characterCount,
  initialAnnouncementValues,
  titleProblem,
} from './announcements.form'
import type { AnnouncementFormValues, AnnouncementKind, TextProblem } from './announcements.form'
import { audienceSummary } from './announcements.format'
import { describeNotificationsFailure, failureMessage } from './notifications.errors'

interface AnnouncementComposerProps {
  open: boolean
  /** The caller holds `classes.manage`: any class, and the academy by role. */
  canManageClasses: boolean
  /** The caller holds `classes.read`: the class list (API-050) behind the class picker. */
  canReadClasses: boolean
  onClose: () => void
  /** The announcement as the server stored it (201). */
  onSent: (announcement: Announcement) => void
}

export function AnnouncementComposer({ open, canManageClasses, canReadClasses, onClose, onSent }: AnnouncementComposerProps) {
  const { t } = useTranslation()
  const [unsaved, setUnsaved] = useState(false)
  const [sending, setSending] = useState(false)

  const close = () => {
    setUnsaved(false)
    onClose()
  }
  // Unsaved work: the close button asks first (common.unsaved.*), and so does a browser back/forward.
  const { requestClose, holdNavigation } = useUnsavedChangesGuard(unsaved, close)
  const locked = unsaved || sending

  return (
    <Drawer
      open={open}
      onClose={() => {
        if (!sending) requestClose()
      }}
      keyboard={!locked}
      mask={{ closable: !locked }}
      title={t('announcements.composer.title')}
      size="min(640px, 100vw)"
      destroyOnHidden
    >
      <NavigationBlocker when={unsaved} onBlocked={holdNavigation} />
      {open ? (
        <ComposerBody
          canManageClasses={canManageClasses}
          canReadClasses={canReadClasses}
          onUnsavedChange={setUnsaved}
          onSending={setSending}
          onCancel={requestClose}
          onSent={(announcement) => {
            setUnsaved(false)
            onSent(announcement)
          }}
        />
      ) : null}
    </Drawer>
  )
}

interface ComposerBodyProps {
  canManageClasses: boolean
  canReadClasses: boolean
  onUnsavedChange: (unsaved: boolean) => void
  onSending: (sending: boolean) => void
  /** «Cancel»: asks first while unsaved, like the close button. */
  onCancel: () => void
  onSent: (announcement: Announcement) => void
}

const PROBLEM_KEYS: Readonly<Record<TextProblem, string>> = { required: 'Required', max: 'Max', nul: 'Nul' }

function ComposerBody({ canManageClasses, canReadClasses, onUnsavedChange, onSending, onCancel, onSent }: ComposerBodyProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { modal } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  // A class audience needs the class list; without classes.read only a holder of classes.manage can compose (the academy).
  const [initial] = useState<AnnouncementFormValues>(() => initialAnnouncementValues(canReadClasses || !canManageClasses ? 'class' : 'academy'))
  const kind = (Form.useWatch('kind', form) as AnnouncementKind | undefined) ?? initial.kind
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The class chosen in the picker, for the confirmation's wording.
  const [chosenClass, setChosenClass] = useState<AnnouncementClass | null>(null)
  // A confirmation is on screen: a second submit (a double click) opens none.
  const confirming = useRef(false)

  // The body left (sent, discarded, closed): nothing is held any more.
  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])

  const send = async (input: CreateAnnouncementInput) => {
    setSending(true)
    onSending(true)
    setError(null)
    try {
      onSent(await createAnnouncement(input))
    } catch (caught) {
      const failure = describeNotificationsFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else setError(text)
    } finally {
      setSending(false)
      onSending(false)
    }
  }

  const submit = () => {
    if (sending || confirming.current) return
    // Every value of the store — a field of the other audience kind is kept, not mounted (getFieldsValue(true)).
    const values = form.getFieldsValue(true) as AnnouncementFormValues
    // Null while a rule is broken — the form's own rules, run before onFinish, have said which.
    const input = buildCreateAnnouncementInput(values)
    if (!input) return
    confirming.current = true
    const audience = audienceSummary({ audience: input.audience, class: input.audience.kind === 'class' ? chosenClass : null }, t, language)
    modal.confirm({
      title: t('announcements.composer.confirm.title'),
      content: t('announcements.composer.confirm.content', { title: input.title, audience }),
      okText: t('announcements.composer.confirm.ok'),
      cancelText: t('announcements.composer.confirm.cancel'),
      onOk: () => {
        confirming.current = false
        void send(input)
      },
      onCancel: () => {
        confirming.current = false
      },
    })
  }

  const textRule = (problemOf: (value: string | undefined) => TextProblem | null, prefix: 'title' | 'body', max: number) => ({
    validator: (_: unknown, value: string | undefined) => {
      const problem = problemOf(value)
      return problem === null
        ? Promise.resolve()
        : Promise.reject(new Error(problem === 'nul' ? t('announcements.composer.validation.nul') : t(`announcements.composer.validation.${prefix}${PROBLEM_KEYS[problem]}`, { max })))
    },
  })

  const nothingToAddress = !canReadClasses && !canManageClasses

  return (
    <>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      {nothingToAddress ? <Alert type="warning" showIcon title={t('announcements.composer.classesUnreadable')} style={{ marginBottom: 16 }} /> : null}

      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={initial}
        disabled={sending}
        onFinish={submit}
        // The whole store, so a field of the kind not shown still counts (owner's note 2 on #108).
        onValuesChange={() => onUnsavedChange(announcementFormHasChanges(initial, form.getFieldsValue(true) as AnnouncementFormValues))}
      >
        <Form.Item name="kind" label={t('announcements.composer.kind')} extra={canManageClasses ? undefined : t('announcements.composer.kindAcademyHint')}>
          <Radio.Group
            name="announcement-kind"
            options={[
              { value: 'class', label: t('announcements.composer.kindClass'), disabled: !canReadClasses },
              { value: 'academy', label: t('announcements.composer.kindAcademy'), disabled: !canManageClasses },
            ]}
          />
        </Form.Item>

        {kind === 'class' ? (
          <>
            <Form.Item
              name="classId"
              label={t('announcements.composer.class')}
              extra={canReadClasses ? undefined : t('announcements.composer.classesUnreadable')}
              rules={[{ required: true, message: t('announcements.composer.validation.classRequired') }]}
            >
              {canReadClasses ? (
                <ClassPicker
                  allowClear
                  placeholder={t('announcements.composer.classPlaceholder')}
                  onChange={(_value: string | undefined, item: AcademyClass | undefined) => setChosenClass(item ? { id: item.id, code: item.code, name: item.name } : null)}
                  style={{ maxWidth: 480 }}
                />
              ) : (
                <Input disabled placeholder={t('announcements.composer.noClasses')} />
              )}
            </Form.Item>
            <Form.Item
              name="groups"
              label={t('announcements.composer.groups')}
              rules={[{ type: 'array', min: 1, message: t('announcements.composer.validation.groupsRequired') }]}
            >
              <Checkbox.Group options={ANNOUNCEMENT_CLASS_GROUPS.map((group) => ({ value: group, label: t(`announcements.groups.${group}`) }))} />
            </Form.Item>
          </>
        ) : (
          <Form.Item
            name="roleKeys"
            label={t('announcements.composer.roleKeys')}
            rules={[{ type: 'array', min: 1, message: t('announcements.composer.validation.roleKeysRequired') }]}
          >
            <Checkbox.Group options={ANNOUNCEMENT_ROLE_KEYS.map((key) => ({ value: key, label: t(`announcements.roleGroups.${key}`) }))} />
          </Form.Item>
        )}

        <Form.Item name="title" label={t('announcements.composer.titleLabel')} rules={[textRule(titleProblem, 'title', ANNOUNCEMENT_TITLE_MAX_LENGTH)]}>
          <Input dir="auto" count={{ show: true, max: ANNOUNCEMENT_TITLE_MAX_LENGTH, strategy: characterCount }} />
        </Form.Item>
        <Form.Item
          name="body"
          label={t('announcements.composer.body')}
          extra={t('announcements.composer.bodyHint')}
          rules={[textRule(bodyProblem, 'body', ANNOUNCEMENT_BODY_MAX_LENGTH)]}
        >
          <Input.TextArea dir="auto" autoSize={{ minRows: 6, maxRows: 16 }} count={{ show: true, max: ANNOUNCEMENT_BODY_MAX_LENGTH, strategy: characterCount }} />
        </Form.Item>
        <Form.Item name="sendEmail" label={t('announcements.composer.sendEmail')} valuePropName="checked" extra={t('announcements.composer.sendEmailHint')}>
          <Switch aria-label={t('announcements.composer.sendEmail')} />
        </Form.Item>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('announcements.composer.recipientsHint', { max: ANNOUNCEMENT_MAX_RECIPIENTS })}
        </Typography.Paragraph>
        <Alert type="info" showIcon title={t('announcements.composer.immutable')} style={{ marginBottom: 16 }} />

        <Flex justify="flex-end" gap={8}>
          <Button onClick={onCancel} disabled={sending}>
            {t('common.cancel')}
          </Button>
          <Button type="primary" htmlType="submit" loading={sending} disabled={nothingToAddress}>
            {t('announcements.composer.send')}
          </Button>
        </Flex>
      </Form>
    </>
  )
}
