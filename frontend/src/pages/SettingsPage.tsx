import { App, Button, Card, Form, Input, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { mockAcademySettings } from '../mock/data'
import type { MockAcademySettings } from '../mock/data'

export function SettingsPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <Card style={{ maxWidth: 640 }}>
        <Form<MockAcademySettings>
          layout="vertical"
          initialValues={mockAcademySettings}
          onFinish={() => message.success(t('settings.savedDemo'))}
        >
          <Form.Item name="nameAr" label={t('settings.academyNameAr')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="nameEn" label={t('settings.academyNameEn')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="defaultLanguage" label={t('settings.defaultLanguage')}>
            <Select
              options={[
                { value: 'ar', label: 'العربية' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Form.Item>
          <Form.Item name="timezone" label={t('settings.timezone')}>
            <Input />
          </Form.Item>
          <Form.Item name="currency" label={t('settings.currency')}>
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            {t('common.save')}
          </Button>
        </Form>
      </Card>
    </>
  )
}
