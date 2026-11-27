// The content of one saved lesson (MOD-20, D-R131): its kind, the content of
// that kind and its resources, written on their own with API-228 — never with
// the structure's PUT. Mounted per editing session by the curriculum tab, so
// every session starts from the lesson as the server holds it (KI-049). The
// local rules mirror the server's (curriculum.content.ts); what it still
// refuses comes back as `400 content_invalid { problems }`, listed under the
// form. Unsaved work turns off the Escape key and the mask click.
import { DeleteOutlined, FieldTimeOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Col, Flex, Form, Input, InputNumber, Modal, Row, Select, Space, Typography } from 'antd'
import type { FormInstance, FormRule as Rule } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CAPTIONS_MAX, CAPTION_LABEL_MAX, CONTENT_SHORT_TEXT_MAX, CONTENT_TEXT_MAX, CONTENT_URL_MAX, FILE_NAME_MAX, LESSON_RESOURCES_MAX, MEDIA_SECONDS_MAX, VIDEO_PROVIDERS, updateLessonContent } from '../api/curriculum'
import type { CurriculumItem, VideoProvider } from '../api/curriculum'
import { LEARNING_ITEM_KINDS } from '../api/learning'
import type { LearningItemKind } from '../api/learning'
import { buildLessonContentInput, contentFormHasChanges, contentFormValuesOf, isHttpsUrl, isMediaMinutes, kindNeedsUrl, MEDIA_MINUTES_MAX, minutesOf, needsDuration, secondsOf, vimeoIdOf, youtubeIdOf } from './curriculum.content'
import type { ContentFormValues } from './curriculum.content'
import { describeCurriculumFailure, failureMessage } from './curriculum.errors'
import { formatMediaDuration } from './curriculum.format'

const CAPTION_LANGUAGES = ['ar', 'en', 'tr'] as const

/** How long the hidden media element may take to read a file's length. */
const PROBE_TIMEOUT_MS = 15_000

interface LessonContentModalProps {
  courseId: string
  item: CurriculumItem
  /** The lesson's title as the editor shows it (its draft may hold an unsaved one). */
  title: string
  /** The lesson as the server holds it after the write. */
  onSaved: (item: CurriculumItem) => void
  onClose: () => void
}

type ProbeState = { status: 'idle' } | { status: 'reading'; url: string; media: 'video' | 'audio' } | { status: 'failed' } | { status: 'read'; seconds: number }

export function LessonContentModal({ courseId, item, title, onSaved, onClose }: LessonContentModalProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  // Untyped so the list name paths of the rules type-check.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' })
  const initialValues = contentFormValuesOf(item)
  const kind = (Form.useWatch('kind', form) as LearningItemKind | undefined) ?? item.kind
  const provider = (Form.useWatch('provider', form) as VideoProvider | undefined) ?? initialValues.provider ?? 'file'
  const url = (Form.useWatch('url', form) as string | undefined) ?? initialValues.url ?? ''

  const allValues = () => form.getFieldsValue(true) as ContentFormValues
  const refreshDirty = () => setDirty(contentFormHasChanges(item, allValues()))

  const textMax = (max: number): Rule => ({ max, message: t('curriculum.validation.maxLength', { max }) })
  const required: Rule = { required: true, whitespace: true, message: t('curriculum.content.validation.required') }
  const httpsRule: Rule = {
    validator: (_, value: string | undefined) => (!value?.trim() || isHttpsUrl(value) ? Promise.resolve() : Promise.reject(new Error(t('curriculum.content.validation.https')))),
  }
  /** An English text needs its Arabic one first (the server keeps `ar` required in every localized value). */
  const arabicFirst = (arabic: (string | number)[]): Rule => ({
    validator: (_, value: string | undefined) =>
      !value?.trim() || (form.getFieldValue(arabic) as string | undefined)?.trim() ? Promise.resolve() : Promise.reject(new Error(t('curriculum.validation.arabicFirst'))),
  })
  const providerRule: Rule = {
    validator: (_, value: string | undefined) => {
      if (kind !== 'video' || provider === 'file' || !value?.trim() || !isHttpsUrl(value)) return Promise.resolve()
      const id = provider === 'youtube' ? youtubeIdOf(value) : vimeoIdOf(value)
      return id ? Promise.resolve() : Promise.reject(new Error(t(`curriculum.content.validation.${provider}`)))
    },
  }
  const durationRule: Rule = {
    validator: (_, value: number | null | undefined) => {
      if (value === null || value === undefined) {
        return needsDuration(kind, provider) ? Promise.reject(new Error(t('curriculum.content.validation.durationRequired'))) : Promise.resolve()
      }
      return isMediaMinutes(value) ? Promise.resolve() : Promise.reject(new Error(t('curriculum.content.validation.duration', { max: MEDIA_MINUTES_MAX })))
    },
  }

  const close = () => {
    if (!saving) onClose()
  }

  const submit = async () => {
    const values = allValues()
    if (!contentFormHasChanges(item, values)) {
      message.info(t('curriculum.content.nothingChanged'))
      onClose()
      return
    }
    setSaving(true)
    setError(null)
    setProblems([])
    try {
      const saved = await updateLessonContent(courseId, item.id, buildLessonContentInput(values, item))
      message.success(t('curriculum.content.saved'))
      onSaved(saved)
    } catch (caught) {
      const failure = describeCurriculumFailure(caught)
      setError(failureMessage(t, failure))
      setProblems(failure.problems ?? [])
      setSaving(false)
    }
  }

  const startProbe = () => {
    const value = (form.getFieldValue('url') as string | undefined)?.trim() ?? ''
    if (!isHttpsUrl(value)) return
    setProbe({ status: 'reading', url: value, media: kind === 'audio' ? 'audio' : 'video' })
  }

  const finishProbe = (seconds: number | null) => {
    if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
      setProbe({ status: 'failed' })
      return
    }
    const whole = Math.min(MEDIA_SECONDS_MAX, Math.max(1, Math.round(seconds)))
    form.setFieldValue('durationMinutes', minutesOf(whole))
    void form.validateFields(['durationMinutes']).catch(() => undefined)
    refreshDirty()
    setProbe({ status: 'read', seconds: whole })
  }

  const showsUrl = kindNeedsUrl(kind)
  const canProbe = needsDuration(kind, provider) && isHttpsUrl(url)

  return (
    <Modal
      open
      title={t('curriculum.content.title', { title })}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      onOk={() => form.submit()}
      onCancel={close}
      confirmLoading={saving}
      // Unsaved work turns off the Escape key and the mask click; the cancel button and × still close.
      keyboard={!dirty}
      mask={{ closable: !dirty }}
      destroyOnHidden
      width={820}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={initialValues}
        onValuesChange={() => {
          refreshDirty()
          setProbe((current) => (current.status === 'reading' ? current : { status: 'idle' }))
        }}
        onFinish={() => void submit()}
        disabled={saving}
      >
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="kind" label={t('curriculum.content.kind')} extra={t(`curriculum.content.kindHints.${kind}`)}>
              <Select options={LEARNING_ITEM_KINDS.map((value) => ({ value, label: t(`curriculum.kinds.${value}`) }))} />
            </Form.Item>
          </Col>
          {kind === 'video' ? (
            <Col xs={24} md={12}>
              <Form.Item name="provider" label={t('curriculum.content.provider')}>
                <Select options={VIDEO_PROVIDERS.map((value) => ({ value, label: t(`curriculum.content.providers.${value}`) }))} />
              </Form.Item>
            </Col>
          ) : null}
        </Row>

        {kind === 'text' ? (
          <>
            <Form.Item name="bodyAr" label={t('curriculum.content.bodyAr')} extra={t('curriculum.content.plainText')} rules={[required, textMax(CONTENT_TEXT_MAX)]}>
              <Input.TextArea rows={8} />
            </Form.Item>
            <Form.Item hidden name="bodyEn" label={t('curriculum.content.bodyEn')} dependencies={['bodyAr']} rules={[textMax(CONTENT_TEXT_MAX), arabicFirst(['bodyAr'])]}>
              <Input.TextArea rows={4} dir="ltr" />
            </Form.Item>
          </>
        ) : null}

        {showsUrl ? (
          <Form.Item
            name="url"
            label={t('curriculum.content.url')}
            extra={t(`curriculum.content.urlHints.${kind === 'video' ? `video_${provider}` : kind}`)}
            dependencies={['provider']}
            rules={[required, textMax(CONTENT_URL_MAX), httpsRule, providerRule]}
          >
            <Input dir="ltr" inputMode="url" placeholder="https://" />
          </Form.Item>
        ) : null}

        {kind === 'video' || kind === 'audio' ? (
          <Form.Item
            label={t('curriculum.content.durationMinutes')}
            extra={needsDuration(kind, provider) ? t('curriculum.content.durationRequiredHint') : t('curriculum.content.durationOptionalHint')}
            required={false}
          >
            <Flex gap={8} wrap align="center">
              <Form.Item name="durationMinutes" noStyle dependencies={['provider', 'kind']} rules={[durationRule]}>
                {/* No min/max/precision on the input: antd would round or clamp a typed value silently — the rule says why. */}
                <InputNumber style={{ width: 180 }} step={1} inputMode="decimal" aria-label={t('curriculum.content.durationMinutes')} />
              </Form.Item>
              <DurationPreview form={form} />
              {needsDuration(kind, provider) ? (
                <Button icon={<FieldTimeOutlined />} onClick={startProbe} disabled={!canProbe || probe.status === 'reading'} loading={probe.status === 'reading'}>
                  {t('curriculum.content.detectDuration')}
                </Button>
              ) : null}
            </Flex>
            {probe.status === 'failed' ? (
              <Typography.Text type="warning">{t('curriculum.content.detectFailed')}</Typography.Text>
            ) : probe.status === 'read' ? (
              <Typography.Text type="success">
                {t('curriculum.content.detected')} <bdi dir="ltr">{formatMediaDuration(probe.seconds)}</bdi>
              </Typography.Text>
            ) : null}
          </Form.Item>
        ) : null}

        {probe.status === 'reading' ? <DurationProbe key={probe.url} url={probe.url} media={probe.media} onDone={finishProbe} /> : null}

        {kind === 'video' && provider === 'file' ? (
          <Form.List name="captions">
            {(fields, { add, remove }) => (
              <Flex vertical gap={8} style={{ marginBottom: 16 }}>
                <Typography.Text strong>{t('curriculum.content.captions')}</Typography.Text>
                {fields.map((field, index) => (
                  <Row key={field.key} gutter={8} align="top" data-testid="caption-row">
                    <Col xs={24} md={5}>
                      <Form.Item name={[field.name, 'language']} label={t('curriculum.content.captionLanguage')} rules={[{ required: true, message: t('curriculum.content.validation.required') }]}>
                        <Select options={CAPTION_LANGUAGES.map((value) => ({ value, label: t(`curriculum.content.captionLanguages.${value}`) }))} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={11}>
                      <Form.Item name={[field.name, 'url']} label={t('curriculum.content.captionUrl')} rules={[required, textMax(CONTENT_URL_MAX), httpsRule]}>
                        <Input dir="ltr" placeholder="https://" />
                      </Form.Item>
                    </Col>
                    <Col xs={20} md={6}>
                      <Form.Item name={[field.name, 'label']} label={t('curriculum.content.captionLabel')} rules={[textMax(CAPTION_LABEL_MAX)]}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={4} md={2}>
                      <Form.Item label=" " colon={false}>
                        <Button danger icon={<DeleteOutlined />} aria-label={`${t('curriculum.content.removeCaption')} ${index + 1}`} onClick={() => remove(field.name)} />
                      </Form.Item>
                    </Col>
                  </Row>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ language: 'ar', url: '', label: '' })}
                  disabled={fields.length >= CAPTIONS_MAX}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {t('curriculum.content.addCaption')}
                </Button>
              </Flex>
            )}
          </Form.List>
        ) : null}

        {kind === 'image' ? (
          <Row gutter={12}>
            <Col xs={24}>
              <Form.Item name="altAr" label={t('curriculum.content.altAr')} extra={t('curriculum.content.altHint')} rules={[textMax(CONTENT_SHORT_TEXT_MAX)]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={0}>
              <Form.Item name="altEn" label={t('curriculum.content.altEn')} dependencies={['altAr']} rules={[textMax(CONTENT_SHORT_TEXT_MAX), arabicFirst(['altAr'])]}>
                <Input dir="ltr" />
              </Form.Item>
            </Col>
          </Row>
        ) : null}

        {kind === 'file' ? (
          <Form.Item name="fileName" label={t('curriculum.content.fileName')} rules={[textMax(FILE_NAME_MAX)]}>
            <Input dir="ltr" />
          </Form.Item>
        ) : null}

        {kind === 'live' ? (
          <>
            <Form.Item name="noteAr" label={t('curriculum.content.noteAr')} extra={t('curriculum.content.plainText')} rules={[textMax(CONTENT_TEXT_MAX)]}>
              <Input.TextArea rows={4} />
            </Form.Item>
            <Form.Item hidden name="noteEn" label={t('curriculum.content.noteEn')} dependencies={['noteAr']} rules={[textMax(CONTENT_TEXT_MAX), arabicFirst(['noteAr'])]}>
              <Input.TextArea rows={3} dir="ltr" />
            </Form.Item>
          </>
        ) : null}

        <Form.List name="resources">
          {(fields, { add, remove }) => (
            <Flex vertical gap={8}>
              <Space orientation="vertical" size={0}>
                <Typography.Text strong>{t('curriculum.content.resources')}</Typography.Text>
                <Typography.Text type="secondary">{t('curriculum.content.resourcesHint', { max: LESSON_RESOURCES_MAX })}</Typography.Text>
              </Space>
              {fields.map((field, index) => (
                <Row key={field.key} gutter={8} align="top" data-testid="resource-row">
                  <Col xs={24} md={13}>
                    <Form.Item name={[field.name, 'titleAr']} label={t('curriculum.content.resourceTitleAr')} rules={[required, textMax(CONTENT_SHORT_TEXT_MAX)]}>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={0}>
                    <Form.Item
                      name={[field.name, 'titleEn']}
                      label={t('curriculum.content.resourceTitleEn')}
                      dependencies={[['resources', field.name, 'titleAr']]}
                      rules={[textMax(CONTENT_SHORT_TEXT_MAX), arabicFirst(['resources', field.name, 'titleAr'])]}
                    >
                      <Input dir="ltr" />
                    </Form.Item>
                  </Col>
                  <Col xs={20} md={9}>
                    <Form.Item name={[field.name, 'url']} label={t('curriculum.content.resourceUrl')} rules={[required, textMax(CONTENT_URL_MAX), httpsRule]}>
                      <Input dir="ltr" placeholder="https://" />
                    </Form.Item>
                  </Col>
                  <Col xs={4} md={2}>
                    <Form.Item label=" " colon={false}>
                      <Button danger icon={<DeleteOutlined />} aria-label={`${t('curriculum.content.removeResource')} ${index + 1}`} onClick={() => remove(field.name)} />
                    </Form.Item>
                  </Col>
                </Row>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => add({ titleAr: '', titleEn: '', url: '' })}
                disabled={fields.length >= LESSON_RESOURCES_MAX}
                style={{ alignSelf: 'flex-start' }}
              >
                {t('curriculum.content.addResource')}
              </Button>
            </Flex>
          )}
        </Form.List>
      </Form>

      {error ? (
        <Alert
          type="error"
          showIcon
          title={error}
          description={
            problems.length > 0 ? (
              <ul style={{ margin: 0, paddingInlineStart: 20 }} data-testid="content-problems">
                {problems.map((problem) => (
                  <li key={problem}>
                    <bdi dir="ltr">{problem}</bdi>
                  </li>
                ))}
              </ul>
            ) : undefined
          }
          style={{ marginTop: 16 }}
        />
      ) : null}
    </Modal>
  )
}

/** The typed minutes as `m:ss` beside the field (12.5 → 12:30). */
function DurationPreview({ form }: { form: FormInstance }) {
  const minutes = Form.useWatch('durationMinutes', form) as number | null | undefined
  if (typeof minutes !== 'number' || !isMediaMinutes(minutes)) return null
  return (
    <Typography.Text type="secondary">
      <bdi dir="ltr">{formatMediaDuration(secondsOf(minutes))}</bdi>
    </Typography.Text>
  )
}

interface DurationProbeProps {
  url: string
  media: 'video' | 'audio'
  /** The length in seconds the browser read from the file's metadata, or null when it could not. */
  onDone: (seconds: number | null) => void
}

/** A hidden media element that loads only the file's metadata (`preload="metadata"`) and reports its length; a server that never answers ends as a failure. */
function DurationProbe({ url, media, onDone }: DurationProbeProps) {
  // The latest callback, so the timeout below is set once per probe.
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])
  useEffect(() => {
    const timer = window.setTimeout(() => onDoneRef.current(null), PROBE_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [])
  const props = {
    src: url,
    preload: 'metadata' as const,
    muted: true,
    hidden: true,
    'data-testid': 'duration-probe',
    onLoadedMetadata: (event: { currentTarget: HTMLMediaElement }) => onDone(event.currentTarget.duration),
    onError: () => onDone(null),
  }
  return media === 'audio' ? <audio {...props} /> : <video {...props} />
}
