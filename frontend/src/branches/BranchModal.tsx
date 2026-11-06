// Create / edit one branch (MOD-02-T06 screen): API-081 for a new branch,
// API-082 with the smallest PATCH for an existing one (no request when nothing
// changed). Local rules mirror the server: code alphabet, Arabic text first,
// E.164 phone, a known IANA time zone, and "a main branch is always active"
// (`branch_is_main`). A taken code lands on the code field, a main-but-inactive
// refusal on the active switch; any other refusal shows inside the modal. The
// parent mounts it per session (KI-049: a form instance kept across sessions
// would bring back an earlier branch's values).
import { Alert, App, AutoComplete, Col, Form, Input, Modal, Row, Switch } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isIanaTimeZone, matchTimeZones, TIME_ZONE_MAX_LENGTH } from '../academy/academy.validation'
import { createBranch, updateBranch } from '../api/branches'
import type { Branch } from '../api/branches'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { E164_PATTERN } from '../users/users.validation'
import { describeBranchesFailure, failureMessage } from './branches.errors'
import {
  BRANCH_CODE_MAX_LENGTH,
  BRANCH_CODE_PATTERN,
  BRANCH_TEXT_MAX_LENGTH,
  branchFormValuesOf,
  buildCreateBranchInput,
  EMPTY_BRANCH_FORM,
  mainInactiveReason,
  normaliseBranchCode,
  planBranchPatch,
} from './branches.form'
import type { BranchFormValues } from './branches.form'

interface BranchModalProps {
  open: boolean
  /** The branch to edit; null creates a new one. */
  branch: Branch | null
  onClose: () => void
  /** The branch as the server returned it; `created` tells a new branch from an edit. */
  onSaved: (branch: Branch, created: boolean) => void
}

export function BranchModal({ open, branch, onClose, onSaved }: BranchModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeZoneQuery, setTimeZoneQuery] = useState('')

  const arabicFirst = (arField: string) => ({
    validator: (_: unknown, value: string | undefined) =>
      !value?.trim() || (form.getFieldValue(arField) as string | undefined)?.trim()
        ? Promise.resolve()
        : Promise.reject(new Error(t('branches.validation.arabicFirst'))),
  })

  const close = () => {
    setError(null)
    onClose()
  }

  const submit = async (values: BranchFormValues) => {
    setError(null)
    const patch = branch ? planBranchPatch(branch, values) : null
    if (branch && !patch) {
      message.info(t('branches.nothingChanged'))
      close()
      return
    }
    setSaving(true)
    try {
      const saved = branch && patch ? await updateBranch(branch.id, patch) : await createBranch(buildCreateBranchInput(values))
      onSaved(saved, branch === null)
    } catch (caught) {
      const failure = describeBranchesFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else setError(text)
    } finally {
      setSaving(false)
    }
  }

  const timeZoneOptions = matchTimeZones(timeZoneQuery).map((zone) => ({ value: zone }))

  return (
    <Modal
      open={open}
      title={branch ? t('branches.editTitle', { name: localizedLabel(branch.name, language) }) : t('branches.createTitle')}
      okText={branch ? t('common.save') : t('branches.create')}
      cancelText={t('common.cancel')}
      onOk={() => form.submit()}
      onCancel={close}
      confirmLoading={saving}
      destroyOnHidden
      width={680}
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Form
        key={branch ? `${branch.id}:${branch.updatedAt}` : 'new'}
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={branch ? branchFormValuesOf(branch) : EMPTY_BRANCH_FORM}
        onFinish={(values) => void submit(values as BranchFormValues)}
        disabled={saving}
      >
        <Form.Item
          name="code"
          label={t('branches.fields.code')}
          extra={t('branches.hints.code')}
          normalize={(value: string | undefined) => (value ?? '').toUpperCase()}
          rules={[
            { required: true, whitespace: true, message: t('branches.validation.codeRequired') },
            {
              validator: (_, value: string | undefined) =>
                !value?.trim() || BRANCH_CODE_PATTERN.test(normaliseBranchCode(value))
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('branches.validation.codeFormat'))),
            },
          ]}
        >
          <Input dir="ltr" maxLength={BRANCH_CODE_MAX_LENGTH} placeholder="MAIN" style={{ maxWidth: 200 }} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="nameAr"
              label={t('branches.fields.nameAr')}
              rules={[{ required: true, whitespace: true, message: t('branches.validation.nameArRequired') }, { max: BRANCH_TEXT_MAX_LENGTH }]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="nameEn" label={t('branches.fields.nameEn')} rules={[{ max: BRANCH_TEXT_MAX_LENGTH }]}>
              <Input dir="ltr" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="addressAr" label={t('branches.fields.addressAr')} rules={[{ max: BRANCH_TEXT_MAX_LENGTH }]}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="addressEn"
              label={t('branches.fields.addressEn')}
              dependencies={['addressAr']}
              rules={[{ max: BRANCH_TEXT_MAX_LENGTH }, arabicFirst('addressAr')]}
            >
              <Input.TextArea rows={2} dir="ltr" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="phone"
              label={t('branches.fields.phone')}
              rules={[
                {
                  validator: (_, value: string | undefined) =>
                    !value?.trim() || E164_PATTERN.test(value.trim()) ? Promise.resolve() : Promise.reject(new Error(t('branches.validation.phone'))),
                },
              ]}
            >
              <Input dir="ltr" placeholder="+966500000000" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="timezone"
              label={t('branches.fields.timezone')}
              extra={t('branches.hints.timezone')}
              rules={[
                {
                  validator: (_, value: string | undefined) =>
                    !value?.trim() || isIanaTimeZone(value.trim()) ? Promise.resolve() : Promise.reject(new Error(t('branches.validation.timezone'))),
                },
              ]}
            >
              <AutoComplete
                options={timeZoneOptions}
                onSearch={setTimeZoneQuery}
                maxLength={TIME_ZONE_MAX_LENGTH}
                allowClear
                placeholder={t('branches.academyTimezone')}
                style={{ direction: 'ltr' }}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="isMain" label={t('branches.fields.isMain')} valuePropName="checked" extra={t('branches.hints.isMain')}>
              <Switch />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="isActive"
              label={t('branches.fields.isActive')}
              valuePropName="checked"
              extra={t('branches.hints.isActive')}
              dependencies={['isMain']}
              rules={[
                {
                  validator: (_, isActive: boolean | undefined) => {
                    const isMain = Boolean(form.getFieldValue('isMain'))
                    const reason = mainInactiveReason(branch, { isMain, isActive: Boolean(isActive) })
                    return reason ? Promise.reject(new Error(t(`branches.validation.${reason}`))) : Promise.resolve()
                  },
                },
              ]}
            >
              <Switch />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  )
}
