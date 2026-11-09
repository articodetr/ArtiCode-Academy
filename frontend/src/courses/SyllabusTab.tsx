// The syllabus tab of the course drawer (MOD-04-T06): the ordered items of
// API-048 for every reader of the course; for holders of `courses.manage` an
// editor (add / edit / delete / move up-down) that saves the complete list in
// ONE PUT (API-049) — only when it differs from the stored syllabus (AC1).
// The list shown always comes from the server's answer, never from the form.
// Since J-F23 an editor whose list differs from the stored one reports it
// through `onUnsavedChange`, so the course drawer keeps it on Escape (KI-054),
// and every length rule words its own message (courses.validation.maxLength).
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Col, Empty, Flex, Form, Input, InputNumber, Row, Skeleton, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SYLLABUS_ITEMS_MAX, SYLLABUS_MINUTES_MAX, getSyllabus, replaceSyllabus } from '../api/syllabus'
import type { Syllabus, SyllabusItem } from '../api/syllabus'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { COURSE_TEXT_MAX_LENGTH } from './courses.form'
import { describeCoursesFailure, failureMessage } from './courses.errors'
import { emptySyllabusDraft, planSyllabusReplacement, syllabusDraftsOf, syllabusHasChanges, totalMinutes } from './syllabus.form'
import type { SyllabusFormValues } from './syllabus.form'

interface SyllabusTabProps {
  courseId: string
  canManage: boolean
  /** Whether the editor's list differs from the stored syllabus (KI-054): the course drawer then keeps Escape and a mask click from dropping it. */
  onUnsavedChange?: (unsaved: boolean) => void
}

export function SyllabusTab({ courseId, canManage, onUnsavedChange }: SyllabusTabProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [syllabus, setSyllabus] = useState<Syllabus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getSyllabus(courseId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSyllabus(loaded)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(failureMessage(t, describeCoursesFailure(error)))
      })
    return () => controller.abort()
  }, [courseId, reloadTick, t])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  const save = async (values: SyllabusFormValues) => {
    if (!syllabus) return
    const items = planSyllabusReplacement(syllabus.items, values.items ?? [])
    if (!items) {
      message.info(t('courses.syllabus.nothingChanged'))
      setEditing(false)
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      setSyllabus(await replaceSyllabus(courseId, items))
      setEditing(false)
      message.success(t('courses.syllabus.saved'))
    } catch (caught) {
      const failure = describeCoursesFailure(caught)
      setNotice(failureMessage(t, failure))
      // Changed elsewhere meanwhile (an item id is gone): show the syllabus as the server holds it now.
      if (failure.key.endsWith('syllabus_invalid') || failure.key.endsWith('course_not_found')) {
        setEditing(false)
        reload()
      }
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <Alert
        type="error"
        showIcon
        message={loadError}
        action={
          <Button size="small" onClick={reload}>
            {t('courses.refresh')}
          </Button>
        }
      />
    )
  }
  if (!syllabus) return <Skeleton active paragraph={{ rows: 4 }} />

  const noticeAlert = notice ? <Alert type="error" showIcon message={notice} closable onClose={() => setNotice(null)} style={{ marginBottom: 12 }} /> : null

  if (editing) {
    return (
      <>
        {noticeAlert}
        <SyllabusEditor
          items={syllabus.items}
          saving={saving}
          onSubmit={(values) => void save(values)}
          onCancel={() => setEditing(false)}
          onUnsavedChange={onUnsavedChange}
        />
      </>
    )
  }

  const columns: TableProps<SyllabusItem>['columns'] = [
    { title: t('courses.syllabus.columns.number'), key: 'number', width: 56, render: (_, _row, index) => index + 1 },
    {
      title: t('courses.syllabus.columns.title'),
      key: 'title',
      render: (_, row) => (
        <Flex vertical>
          <Typography.Text strong>{localizedLabel(row.title, language)}</Typography.Text>
          {row.description ? <Typography.Text type="secondary">{localizedLabel(row.description, language)}</Typography.Text> : null}
        </Flex>
      ),
    },
    {
      title: t('courses.syllabus.columns.minutes'),
      key: 'minutes',
      width: 120,
      render: (_, row) => (row.estimatedMinutes === null ? '—' : <Tag>{t('courses.syllabus.minutes', { count: row.estimatedMinutes })}</Tag>),
    },
  ]

  return (
    <>
      {noticeAlert}
      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">
          {syllabus.items.length > 0
            ? t('courses.syllabus.summary', { count: syllabus.items.length, minutes: totalMinutes(syllabus.items) })
            : canManage
              ? t('courses.syllabus.emptyManager')
              : t('courses.syllabus.empty')}
        </Typography.Text>
        {canManage ? (
          <Button
            icon={<EditOutlined />}
            onClick={() => {
              setNotice(null)
              setEditing(true)
            }}
          >
            {t('courses.syllabus.edit')}
          </Button>
        ) : null}
      </Flex>
      {syllabus.items.length > 0 ? <Table<SyllabusItem> rowKey="id" columns={columns} dataSource={syllabus.items} pagination={false} size="small" /> : null}
    </>
  )
}

interface SyllabusEditorProps {
  items: readonly SyllabusItem[]
  saving: boolean
  onSubmit: (values: SyllabusFormValues) => void
  onCancel: () => void
  /** Whether the list differs from the stored syllabus: reported on every edit, false once the editor is left. */
  onUnsavedChange?: (unsaved: boolean) => void
}

/**
 * The editor of one edit session. It owns its form so every session starts
 * from the stored syllabus: a form instance kept across sessions would merge
 * the values typed in a cancelled session over the new initial values.
 */
function SyllabusEditor({ items, saving, onSubmit, onCancel, onUnsavedChange }: SyllabusEditorProps) {
  const { t } = useTranslation()
  const [form] = Form.useForm<SyllabusFormValues>()
  /** The length rule of every text field, worded by the courses dictionary (J-F23). */
  const maxLength = { max: COURSE_TEXT_MAX_LENGTH, message: t('courses.validation.maxLength', { max: COURSE_TEXT_MAX_LENGTH }) }

  useEffect(() => () => onUnsavedChange?.(false), [onUnsavedChange])

  return (
    <Form<SyllabusFormValues>
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={{ items: syllabusDraftsOf(items) }}
      // The comparison the save uses: an item changed back, or added and removed again, holds nothing (KI-054).
      onValuesChange={() => onUnsavedChange?.(syllabusHasChanges(items, (form.getFieldValue('items') as SyllabusFormValues['items']) ?? []))}
      onFinish={onSubmit}
      disabled={saving}
    >
      <Form.List name="items">
        {(fields, { add, remove, move }) => (
          <Flex vertical gap={12}>
            {fields.length === 0 ? <Empty description={t('courses.syllabus.empty')} /> : null}
            {fields.map((field, index) => {
              const number = index + 1
              const arabicFirst = (arField: 'titleAr' | 'descriptionAr') => ({
                validator: (_: unknown, value: string | undefined) =>
                  !value?.trim() || (form.getFieldValue(['items', field.name, arField]) as string | undefined)?.trim()
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('courses.validation.arabicFirst'))),
              })
              return (
                <Card
                  key={field.key}
                  size="small"
                  title={t('courses.syllabus.item', { number })}
                  data-testid="syllabus-item-editor"
                  extra={
                    <Space size={4}>
                      <Button
                        size="small"
                        icon={<ArrowUpOutlined />}
                        aria-label={`${t('courses.syllabus.moveUp')} ${number}`}
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                      />
                      <Button
                        size="small"
                        icon={<ArrowDownOutlined />}
                        aria-label={`${t('courses.syllabus.moveDown')} ${number}`}
                        disabled={index === fields.length - 1}
                        onClick={() => move(index, index + 1)}
                      />
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={`${t('courses.syllabus.remove')} ${number}`}
                        onClick={() => remove(field.name)}
                      />
                    </Space>
                  }
                >
                  <Form.Item name={[field.name, 'id']} hidden>
                    <Input />
                  </Form.Item>
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name={[field.name, 'titleAr']}
                        label={t('courses.syllabus.fields.titleAr')}
                        rules={[
                          { required: true, whitespace: true, message: t('courses.syllabus.validation.titleArRequired') },
                          maxLength,
                        ]}
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name={[field.name, 'titleEn']}
                        label={t('courses.syllabus.fields.titleEn')}
                        dependencies={[['items', field.name, 'titleAr']]}
                        rules={[maxLength, arabicFirst('titleAr')]}
                      >
                        <Input dir="ltr" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name={[field.name, 'descriptionAr']} label={t('courses.syllabus.fields.descriptionAr')} rules={[maxLength]}>
                        <Input.TextArea rows={2} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name={[field.name, 'descriptionEn']}
                        label={t('courses.syllabus.fields.descriptionEn')}
                        dependencies={[['items', field.name, 'descriptionAr']]}
                        rules={[maxLength, arabicFirst('descriptionAr')]}
                      >
                        <Input.TextArea rows={2} dir="ltr" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name={[field.name, 'estimatedMinutes']} label={t('courses.syllabus.fields.estimatedMinutes')} style={{ marginBottom: 0 }}>
                    <InputNumber min={1} max={SYLLABUS_MINUTES_MAX} precision={0} style={{ width: 160 }} />
                  </Form.Item>
                </Card>
              )
            })}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => add(emptySyllabusDraft())}
              disabled={fields.length >= SYLLABUS_ITEMS_MAX}
              title={fields.length >= SYLLABUS_ITEMS_MAX ? t('courses.syllabus.maxReached', { max: SYLLABUS_ITEMS_MAX }) : undefined}
            >
              {t('courses.syllabus.add')}
            </Button>
          </Flex>
        )}
      </Form.List>
      <Flex gap={8} justify="flex-end" style={{ marginTop: 16 }}>
        <Button onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" htmlType="submit" loading={saving}>
          {t('courses.syllabus.save')}
        </Button>
      </Flex>
    </Form>
  )
}
