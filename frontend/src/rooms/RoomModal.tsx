// Create / edit one room (J-F06, MOD-07-T02 screen): API-085 for a new room,
// API-086 with the smallest PATCH for an existing one (no request when nothing
// changed). Local rules mirror the server: code alphabet, Arabic text first, a
// whole positive capacity, and only an active branch (or the room's current
// one — named from the room itself when the branch list lacks it). A taken code
// lands on the code field, an unknown or inactive branch on the branch field;
// any other refusal shows inside the modal. The parent mounts it per session
// (KI-049: a form instance kept across sessions would bring back an earlier
// room's values), so the form needs no key of its own.
import { Alert, App, Col, Form, Input, InputNumber, Modal, Row, Select, Switch } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Branch } from '../api/branches'
import { createRoom, ROOM_KINDS, updateRoom } from '../api/rooms'
import type { Room } from '../api/rooms'
import { useLocalized } from '../i18n/useLocalized'
import { describeRoomsFailure, failureMessage } from './rooms.errors'
import {
  branchOptionsFor,
  buildCreateRoomInput,
  EMPTY_ROOM_FORM,
  normaliseRoomCode,
  planRoomPatch,
  ROOM_CAPACITY_MAX,
  ROOM_CODE_MAX_LENGTH,
  ROOM_CODE_PATTERN,
  ROOM_TEXT_MAX_LENGTH,
  roomDisplayName,
  roomFormValuesOf,
  SITE_OPTION,
} from './rooms.form'
import type { RoomFormValues } from './rooms.form'

interface RoomModalProps {
  open: boolean
  /** The room to edit; null creates a new one. */
  room: Room | null
  /** The branch list (API-080) the picker offers from: the active ones, plus the room's current branch (see branchOptionsFor). */
  branches: readonly Branch[]
  onClose: () => void
  /** The room as the server returned it; `created` tells a new room from an edit. */
  onSaved: (room: Room, created: boolean) => void
}

export function RoomModal({ open, room, branches, onClose, onSaved }: RoomModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const arabicFirst = {
    validator: (_: unknown, value: string | undefined) =>
      !value?.trim() || (form.getFieldValue('nameAr') as string | undefined)?.trim() ? Promise.resolve() : Promise.reject(new Error(t('rooms.validation.arabicFirst'))),
  }

  const close = () => {
    setError(null)
    onClose()
  }

  const submit = async (values: RoomFormValues) => {
    setError(null)
    const patch = room ? planRoomPatch(room, values) : null
    if (room && !patch) {
      message.info(t('rooms.nothingChanged'))
      close()
      return
    }
    setSaving(true)
    try {
      const saved = room && patch ? await updateRoom(room.id, patch) : await createRoom(buildCreateRoomInput(values))
      onSaved(saved, room === null)
    } catch (caught) {
      const failure = describeRoomsFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else setError(text)
    } finally {
      setSaving(false)
    }
  }

  const branchOptions = [
    { value: SITE_OPTION, label: t('rooms.site') },
    ...branchOptionsFor(branches, room?.branch ?? null, language).map((option) => ({
      value: option.value,
      label: option.inactive ? `${option.label} (${t('labels.inactive')})` : option.label,
    })),
  ]

  return (
    <Modal
      open={open}
      title={room ? t('rooms.editTitle', { name: roomDisplayName(room, language) }) : t('rooms.createTitle')}
      okText={room ? t('common.save') : t('rooms.create')}
      cancelText={t('common.cancel')}
      onOk={() => form.submit()}
      onCancel={close}
      confirmLoading={saving}
      destroyOnHidden
      width={640}
    >
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={room ? roomFormValuesOf(room) : EMPTY_ROOM_FORM}
        onFinish={(values) => void submit(values as RoomFormValues)}
        disabled={saving}
      >
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="code"
              label={t('rooms.fields.code')}
              extra={t('rooms.hints.code')}
              normalize={(value: string | undefined) => (value ?? '').toUpperCase()}
              rules={[
                { required: true, whitespace: true, message: t('rooms.validation.codeRequired') },
                {
                  validator: (_, value: string | undefined) =>
                    !value?.trim() || ROOM_CODE_PATTERN.test(normaliseRoomCode(value)) ? Promise.resolve() : Promise.reject(new Error(t('rooms.validation.codeFormat'))),
                },
              ]}
            >
              <Input dir="ltr" maxLength={ROOM_CODE_MAX_LENGTH} placeholder="LAB-1" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="kind" label={t('rooms.fields.kind')}>
              <Select options={ROOM_KINDS.map((kind) => ({ value: kind, label: t(`rooms.kinds.${kind}`) }))} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="nameAr" label={t('rooms.fields.nameAr')} rules={[{ max: ROOM_TEXT_MAX_LENGTH }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="nameEn" label={t('rooms.fields.nameEn')} dependencies={['nameAr']} rules={[{ max: ROOM_TEXT_MAX_LENGTH }, arabicFirst]}>
              <Input dir="ltr" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="branchId" label={t('rooms.fields.branch')} extra={t('rooms.hints.branch')}>
              <Select options={branchOptions} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="capacity"
              label={t('rooms.fields.capacity')}
              extra={t('rooms.hints.capacity')}
              rules={[
                {
                  validator: (_, value: number | null | undefined) =>
                    value === null || value === undefined || (Number.isInteger(value) && value >= 1 && value <= ROOM_CAPACITY_MAX)
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('rooms.validation.capacity'))),
                },
              ]}
            >
              <InputNumber min={1} max={ROOM_CAPACITY_MAX} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="isActive" label={t('rooms.fields.isActive')} valuePropName="checked" extra={t('rooms.hints.isActive')}>
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  )
}
