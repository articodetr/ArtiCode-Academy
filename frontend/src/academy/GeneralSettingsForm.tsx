// The real "general" tab of /settings (MOD-02/MOD-14 minimum — ADR-044):
// reads GET /api/academy for everyone who reaches the screen and saves the
// smallest PATCH /api/academy for holders of `academy.settings.manage`. Local
// rules mirror the server (academy.validation.ts); the server stays the boundary.
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, App, AutoComplete, Button, Card, Flex, Form, Input, Select, Skeleton, Space, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACADEMY_LOCALES, updateAcademy } from '../api/academy'
import type { Academy } from '../api/academy'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { E164_PATTERN } from '../users/users.validation'
import { describeAcademyFailure, failureMessage } from './academy.errors'
import { planAcademyPatch, settingsFormValuesOf } from './academy.patch'
import type { GeneralSettingsFormValues } from './academy.patch'
import { isCurrencyCode, isHttpUrl, isIanaTimeZone, matchTimeZones, normaliseCurrency, TIME_ZONE_MAX_LENGTH } from './academy.validation'
import { MANAGE_ACADEMY_SETTINGS_PERMISSION } from './academy.policy'
import { useAcademy } from './useAcademy'

export function GeneralSettingsForm() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(MANAGE_ACADEMY_SETTINGS_PERMISSION)
  const state = useAcademy()

  const failure = state.error ? describeAcademyFailure(state.error) : null

  return (
    <Card style={{ maxWidth: 720 }}>
      {failure ? (
        <Alert
          type="error"
          showIcon
          message={t('settings.loadFailed')}
          description={failureMessage(t, failure)}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={state.reload} loading={state.loading}>
              {t('settings.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {state.academy ? (
        <AcademyForm
          // Remounting on every server version keeps the form equal to what the server holds.
          key={`${state.academy.id}:${state.academy.updatedAt}`}
          academy={state.academy}
          canManage={canManage}
          onSaved={state.replace}
        />
      ) : state.loading ? (
        <Skeleton active paragraph={{ rows: 6 }} data-testid="settings-loading" />
      ) : null}
    </Card>
  )
}

interface AcademyFormProps {
  academy: Academy
  canManage: boolean
  onSaved: (academy: Academy) => void
}

function AcademyForm({ academy, canManage, onSaved }: AcademyFormProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [form] = Form.useForm<GeneralSettingsFormValues>()
  const [saving, setSaving] = useState(false)
  const [timeZoneQuery, setTimeZoneQuery] = useState('')

  const submit = async (values: GeneralSettingsFormValues) => {
    const body = planAcademyPatch(academy, values)
    if (!body) {
      message.info(t('settings.nothingChanged'))
      return
    }
    setSaving(true)
    try {
      const saved = await updateAcademy(body)
      onSaved(saved)
      message.success(t('settings.saved'))
    } catch (error) {
      message.error(failureMessage(t, describeAcademyFailure(error)))
    } finally {
      setSaving(false)
    }
  }

  const timeZoneOptions = matchTimeZones(timeZoneQuery).map((zone) => ({ value: zone }))

  return (
    <Form<GeneralSettingsFormValues> form={form} layout="vertical" initialValues={settingsFormValuesOf(academy)} onFinish={submit} disabled={!canManage || saving}>
      {!canManage ? <Alert type="info" showIcon message={t('settings.readOnlyHint')} style={{ marginBottom: 16 }} /> : null}

      <Form.Item label={t('settings.slug')} htmlFor="academy-slug">
        <Input id="academy-slug" value={academy.slug} dir="ltr" readOnly />
      </Form.Item>
      <Form.Item name="nameAr" label={t('settings.academyNameAr')} rules={[{ required: true, whitespace: true, message: t('settings.validation.nameArRequired') }, { max: 200 }]}>
        <Input />
      </Form.Item>
      <Form.Item name="nameEn" label={t('settings.academyNameEn')} rules={[{ max: 200 }]}>
        <Input dir="ltr" />
      </Form.Item>
      <Form.Item name="nameTr" label={t('settings.academyNameTr')} rules={[{ max: 200 }]}>
        <Input dir="ltr" />
      </Form.Item>
      <Form.Item
        name="logoUrl"
        label={t('settings.logoUrl')}
        rules={[{ validator: (_, value: string | undefined) => (!value?.trim() || isHttpUrl(value.trim()) ? Promise.resolve() : Promise.reject(new Error(t('settings.validation.url')))) }]}
      >
        <Input dir="ltr" placeholder="https://" />
      </Form.Item>
      <Form.Item name="defaultLocale" label={t('settings.defaultLanguage')} rules={[{ required: true }]}>
        <Select options={ACADEMY_LOCALES.map((code) => ({ value: code, label: t(`users.locales.${code}`) }))} />
      </Form.Item>
      <Form.Item
        name="timezone"
        label={t('settings.timezone')}
        rules={[
          { required: true, whitespace: true },
          { validator: (_, value: string | undefined) => (!value?.trim() || isIanaTimeZone(value.trim()) ? Promise.resolve() : Promise.reject(new Error(t('settings.validation.timezone')))) },
        ]}
      >
        <AutoComplete options={timeZoneOptions} onSearch={setTimeZoneQuery} maxLength={TIME_ZONE_MAX_LENGTH} placeholder="Asia/Riyadh" style={{ direction: 'ltr' }} />
      </Form.Item>
      <Form.Item
        name="currency"
        label={t('settings.currency')}
        normalize={(value: string | undefined) => (value ?? '').toUpperCase()}
        rules={[
          { required: true, whitespace: true },
          { validator: (_, value: string | undefined) => (!value?.trim() || isCurrencyCode(normaliseCurrency(value)) ? Promise.resolve() : Promise.reject(new Error(t('settings.validation.currency')))) },
        ]}
      >
        <Input dir="ltr" maxLength={3} placeholder="SAR" style={{ maxWidth: 120 }} />
      </Form.Item>
      <Form.Item name="contactEmail" label={t('settings.contactEmail')} rules={[{ type: 'email', message: t('settings.validation.email') }, { max: 320 }]}>
        <Input dir="ltr" type="email" />
      </Form.Item>
      <Form.Item
        name="contactPhone"
        label={t('settings.contactPhone')}
        rules={[{ validator: (_, value: string | undefined) => (!value?.trim() || E164_PATTERN.test(value.trim()) ? Promise.resolve() : Promise.reject(new Error(t('settings.validation.phone')))) }]}
      >
        <Input dir="ltr" placeholder="+966500000000" />
      </Form.Item>

      <Flex justify="space-between" align="center" wrap gap={12}>
        <Typography.Text type="secondary">{t('settings.lastUpdated', { date: formatDateTime(academy.updatedAt, language) })}</Typography.Text>
        {canManage ? (
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              {t('common.save')}
            </Button>
          </Space>
        ) : null}
      </Flex>
    </Form>
  )
}
