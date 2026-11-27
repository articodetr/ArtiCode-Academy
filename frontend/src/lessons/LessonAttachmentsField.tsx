// The attachments of a lesson in its create and edit forms (J-F77): a list of
// books and links, each with a type, a title and an https link — pasted
// links, the academy stores no file. Rendered inside the caller's <Form> as
// the list field `attachments` (AttachmentFormValue rows); the English and
// Turkish titles of a stored attachment ride along in hidden fields, so an
// edit that does not touch a row sends it back unchanged. Local rules mirror
// backend/src/lessons/lessons.attachments.ts — the server decides
// (400 attachments_invalid).
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Col, Form, Input, Row, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { ATTACHMENT_KINDS, ATTACHMENT_TITLE_MAX_LENGTH, ATTACHMENTS_MAX } from '../api/lessons'
import { isMeetingUrlValid } from './lessons.form'
import type { AttachmentFormValue } from './lessons.form'

/** A new row: a book with nothing typed yet. */
const NEW_ROW: AttachmentFormValue = { kind: 'book', titleAr: '', titleEn: '', titleTr: '', url: '' }

export function LessonAttachmentsField() {
  const { t } = useTranslation()
  return (
    <Form.List name="attachments">
      {(fields, { add, remove }) => (
        <Form.Item label={t('lessons.fields.attachments')} extra={t('lessons.hints.attachments')} style={{ marginBottom: 16 }}>
          {fields.map((field, index) => (
            <Row key={field.key} gutter={8} align="top" wrap={false} data-testid="lesson-attachment-row">
              <Col flex="120px">
                <Form.Item name={[field.name, 'kind']} rules={[{ required: true, message: t('lessons.attachments.kind') }]} style={{ marginBottom: 8 }}>
                  <Select aria-label={`${t('lessons.attachments.kind')} ${index + 1}`} options={ATTACHMENT_KINDS.map((kind) => ({ value: kind, label: t(`lessons.attachments.kinds.${kind}`) }))} />
                </Form.Item>
              </Col>
              <Col flex="1 1 0" style={{ minWidth: 0 }}>
                <Form.Item
                  name={[field.name, 'titleAr']}
                  rules={[
                    { required: true, whitespace: true, message: t('lessons.attachments.titleRequired') },
                    { max: ATTACHMENT_TITLE_MAX_LENGTH, message: t('lessons.validation.maxLength', { max: ATTACHMENT_TITLE_MAX_LENGTH }) },
                  ]}
                  style={{ marginBottom: 8 }}
                >
                  <Input aria-label={`${t('lessons.attachments.title')} ${index + 1}`} placeholder={t('lessons.attachments.titlePlaceholder')} maxLength={ATTACHMENT_TITLE_MAX_LENGTH} />
                </Form.Item>
              </Col>
              <Col flex="1 1 0" style={{ minWidth: 0 }}>
                <Form.Item
                  name={[field.name, 'url']}
                  rules={[
                    { required: true, whitespace: true, message: t('lessons.attachments.urlRequired') },
                    { validator: (_, value: string | undefined) => (isMeetingUrlValid(value) ? Promise.resolve() : Promise.reject(new Error(t('lessons.validation.meetingUrl')))) },
                  ]}
                  style={{ marginBottom: 8 }}
                >
                  <Input dir="ltr" aria-label={`${t('lessons.attachments.url')} ${index + 1}`} placeholder="https://…" />
                </Form.Item>
              </Col>
              <Col flex="none">
                <Button type="text" danger icon={<DeleteOutlined />} aria-label={`${t('lessons.attachments.remove')} ${index + 1}`} onClick={() => remove(field.name)} />
              </Col>
              {/* The other locales of a stored title: kept, never edited here. */}
              <Form.Item name={[field.name, 'titleEn']} hidden>
                <Input />
              </Form.Item>
              <Form.Item name={[field.name, 'titleTr']} hidden>
                <Input />
              </Form.Item>
            </Row>
          ))}
          {fields.length < ATTACHMENTS_MAX ? (
            <Button icon={<PlusOutlined />} onClick={() => add({ ...NEW_ROW })}>
              {t('lessons.attachments.add')}
            </Button>
          ) : null}
        </Form.Item>
      )}
    </Form.List>
  )
}
