// «مقرّر الدورة» in the edit form of the course drawer (J-F67, Jallal's request): the course's own materials — its
// textbook — as a list of a title and an https address (at most 20), saved with the course in the same single PATCH
// (`planCoursePatch()` sends them whole and only when they differ). The learner sees them as «المقرّر» on the course's
// card in «دوراتي»; a lesson's own attachments stay on the lesson (the curriculum editor). The rules mirror the server's
// (learning.content.ts `resourcesSchema`): an Arabic title of at most 300 characters and an absolute https address.
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Flex, Form, Input, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { isResourceUrl } from './courses.form'

const RESOURCES_MAX = 20
const TITLE_MAX = 300

export function CourseResourcesField() {
  const { t } = useTranslation()
  return (
    <Form.Item label={t('courses.fields.resources')} extra={t('courses.hints.resources')}>
      <Form.List name="resources">
        {(fields, { add, remove }) => (
          <Flex vertical gap={8}>
            {fields.map((field) => (
              <Flex key={field.key} gap={8} align="start" wrap>
                <Form.Item
                  name={[field.name, 'titleAr']}
                  style={{ flex: '1 1 200px', marginBottom: 0 }}
                  rules={[
                    { required: true, whitespace: true, message: t('courses.validation.resourceTitle') },
                    { max: TITLE_MAX, message: t('courses.validation.maxLength', { max: TITLE_MAX }) },
                  ]}
                >
                  <Input placeholder={t('courses.fields.resourceTitle')} aria-label={t('courses.fields.resourceTitle')} />
                </Form.Item>
                <Form.Item
                  name={[field.name, 'url']}
                  style={{ flex: '2 1 260px', marginBottom: 0 }}
                  rules={[
                    {
                      validator: (_, value: string | undefined) =>
                        isResourceUrl(value) ? Promise.resolve() : Promise.reject(new Error(t('courses.validation.resourceUrl'))),
                    },
                  ]}
                >
                  <Input dir="ltr" placeholder="https://" aria-label={t('courses.fields.resourceUrl')} />
                </Form.Item>
                <Button icon={<DeleteOutlined aria-hidden />} onClick={() => remove(field.name)} aria-label={t('courses.resources.remove')} />
              </Flex>
            ))}
            {fields.length < RESOURCES_MAX ? (
              <Button type="dashed" icon={<PlusOutlined aria-hidden />} onClick={() => add({ titleAr: '', url: '' })} style={{ alignSelf: 'flex-start' }}>
                {t('courses.resources.add')}
              </Button>
            ) : (
              <Typography.Text type="secondary">{t('courses.resources.full', { max: RESOURCES_MAX })}</Typography.Text>
            )}
          </Flex>
        )}
      </Form.List>
    </Form.Item>
  )
}
