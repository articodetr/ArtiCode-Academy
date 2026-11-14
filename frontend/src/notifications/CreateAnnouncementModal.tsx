// A new announcement (API-173): to the people of one class — its students,
// their guardians, its teachers — or, with `classes.manage`, to everyone of
// some roles in the academy. The sender's words reach every recipient as
// typed; `sendEmail` also e-mails those who confirmed an address and kept the
// category on (the title and a link only). The form is mounted per session
// (KI-049); unsaved words turn off Escape and the mask click. The server's
// refusals are worded: audience_invalid with its problems, audience_empty,
// audience_too_large with the count and the maximum, class_not_found.
import { Alert, App, Checkbox, Form, Input, Modal, Radio, Switch } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ANNOUNCEMENT_BODY_MAX_LENGTH, ANNOUNCEMENT_CLASS_GROUPS, ANNOUNCEMENT_ROLE_KEYS, ANNOUNCEMENT_TITLE_MAX_LENGTH, createAnnouncement } from '../api/announcements'
import type { Announcement } from '../api/announcements'
import { listClasses } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import { useAuth } from '../auth/auth-context'
import { RemoteSelect } from '../components/RemoteSelect'
import type { RemoteOption } from '../components/RemoteSelect'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { announcementFormHasChanges, bodyProblem, buildAnnouncementInput, characterCount, initialAnnouncementValues, titleProblem } from './announcements.form'
import type { AnnouncementFormValues, TextProblem } from './announcements.form'
import { describeNotificationsFailure, failureMessage } from './notifications.errors'

const CLASS_OPTIONS_LIMIT = 20

interface CreateAnnouncementModalProps {
  open: boolean
  onClose: () => void
  onCreated: (announcement: Announcement) => void
}

export function CreateAnnouncementModal({ open, onClose, onCreated }: CreateAnnouncementModalProps) {
  return open ? <AnnouncementForm onClose={onClose} onCreated={onCreated} /> : null
}

function AnnouncementForm({ onClose, onCreated }: Omit<CreateAnnouncementModalProps, 'open'>) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canAddressAcademy = hasPermission('classes.manage')
  const canPickClass = hasPermission('classes.read')
  const [form] = Form.useForm<AnnouncementFormValues>()
  const kind = Form.useWatch('kind', form) ?? 'class'
  const [dirty, setDirty] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchClasses = useCallback((q: string, signal: AbortSignal) => listClasses({ q, limit: CLASS_OPTIONS_LIMIT }, signal).then((list) => list.items), [])
  const toOption = (cls: AcademyClass): RemoteOption => ({ value: cls.id, label: `${cls.code} — ${localizedLabel(cls.name, language)}` })

  const textRule = (check: (value: string | undefined) => TextProblem | null, max: number) => ({
    validator: async (_: unknown, value: string | undefined) => {
      const problem = check(value)
      if (problem) throw new Error(t(`notifications.announcements.validation.${problem}`, { max }))
    },
  })

  const submit = async (values: AnnouncementFormValues) => {
    setError(null)
    setSending(true)
    try {
      const created = await createAnnouncement(buildAnnouncementInput(values))
      message.success(t('notifications.announcements.sent', { count: created.recipientCount }))
      onCreated(created)
    } catch (caught) {
      const failure = describeNotificationsFailure(caught, t)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else setError(text)
    } finally {
      setSending(false)
    }
  }

  const titleValue = Form.useWatch('title', form) ?? ''
  const bodyValue = Form.useWatch('body', form) ?? ''

  return (
    <Modal
      open
      title={t('notifications.announcements.create.title')}
      okText={t('notifications.announcements.create.send')}
      cancelText={t('common.cancel')}
      onOk={() => form.submit()}
      onCancel={() => {
        if (!sending) onClose()
      }}
      confirmLoading={sending}
      keyboard={!dirty}
      mask={{ closable: !dirty }}
      destroyOnHidden
      width={640}
    >
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form<AnnouncementFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={initialAnnouncementValues()}
        disabled={sending}
        onFinish={(values) => void submit(values)}
        onValuesChange={(_, all) => {
          setDirty(announcementFormHasChanges(all))
          if (error) setError(null)
        }}
      >
        <Form.Item name="kind" label={t('notifications.announcements.fields.kind')}>
          <Radio.Group
            name="announcement-kind"
            options={[
              { value: 'class', label: t('notifications.announcements.kinds.class') },
              { value: 'academy', label: t('notifications.announcements.kinds.academy'), disabled: !canAddressAcademy },
            ]}
          />
        </Form.Item>
        {!canAddressAcademy ? (
          <Alert type="info" showIcon title={t('notifications.announcements.academyNeedsManage')} style={{ marginBottom: 16 }} />
        ) : null}

        {kind === 'class' ? (
          <>
            <Form.Item
              name="classId"
              label={t('notifications.announcements.fields.class')}
              extra={canPickClass ? undefined : t('notifications.announcements.classNeedsRead')}
              rules={[{ required: true, message: t('notifications.announcements.validation.classRequired') }]}
            >
              <RemoteSelect<AcademyClass>
                fetchOptions={fetchClasses}
                toOption={toOption}
                emptyText={t('notifications.announcements.noClasses')}
                placeholder={t('notifications.announcements.pickClass')}
                aria-label={t('notifications.announcements.fields.class')}
                disabled={!canPickClass || sending}
              />
            </Form.Item>
            <Form.Item
              name="groups"
              label={t('notifications.announcements.fields.groups')}
              rules={[{ type: 'array', min: 1, message: t('notifications.announcements.validation.groupsRequired') }]}
            >
              <Checkbox.Group options={ANNOUNCEMENT_CLASS_GROUPS.map((group) => ({ value: group, label: t(`notifications.announcements.groups.${group}`) }))} />
            </Form.Item>
          </>
        ) : (
          <Form.Item
            name="roleKeys"
            label={t('notifications.announcements.fields.roleKeys')}
            rules={[{ type: 'array', min: 1, message: t('notifications.announcements.validation.roleKeysRequired') }]}
          >
            <Checkbox.Group options={ANNOUNCEMENT_ROLE_KEYS.map((key) => ({ value: key, label: t(`roles.${key}`) }))} />
          </Form.Item>
        )}

        <Form.Item
          name="title"
          label={t('notifications.announcements.fields.title')}
          rules={[textRule(titleProblem, ANNOUNCEMENT_TITLE_MAX_LENGTH)]}
          extra={`${characterCount(titleValue.trim())} / ${ANNOUNCEMENT_TITLE_MAX_LENGTH}`}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="body"
          label={t('notifications.announcements.fields.body')}
          rules={[textRule(bodyProblem, ANNOUNCEMENT_BODY_MAX_LENGTH)]}
          extra={`${characterCount(bodyValue.trim())} / ${ANNOUNCEMENT_BODY_MAX_LENGTH}`}
        >
          <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} />
        </Form.Item>
        <Form.Item name="sendEmail" valuePropName="checked" label={t('notifications.announcements.fields.sendEmail')} extra={t('notifications.announcements.sendEmailHint')}>
          <Switch aria-label={t('notifications.announcements.fields.sendEmail')} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
