// Form fields shared by the creation wizard and the edit drawer (MOD-03-T11).
// Field names follow the API bodies (API-014 / API-018), so a submitted form
// maps onto the request without renaming; nested profile fields use name paths.
import { Form, Input, Select } from 'antd'
import type { FormRule } from 'antd'
import { useTranslation } from 'react-i18next'
import { USER_LOCALES } from '../api/users'
import {
  E164_PATTERN,
  EMAIL_MAX_LENGTH,
  HTTP_URL_PATTERN,
  REFERENCE_NUMBER_PATTERN,
  isCalendarDate,
  isValidUsername,
} from './users.validation'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Empty values pass; anything else must satisfy `test`. */
function optionalRule(test: (value: string) => boolean, message: string): FormRule {
  return {
    validator: (_rule, value: unknown) => {
      if (typeof value !== 'string' || value.trim() === '') return Promise.resolve()
      return test(value.trim()) ? Promise.resolve() : Promise.reject(new Error(message))
    },
  }
}

function minTwoIfPresent(t: Translate): FormRule {
  return optionalRule((value) => value.length >= 2, t('users.validation.minTwo'))
}

function calendarDateRule(t: Translate): FormRule {
  return optionalRule(isCalendarDate, t('users.validation.date'))
}

function referenceNumberRule(t: Translate): FormRule {
  return optionalRule((value) => REFERENCE_NUMBER_PATTERN.test(value), t('users.validation.referenceNumber'))
}

interface IdentityFieldsProps {
  /** Whether the caller sees and edits contact identifiers (`users.read_contact`). */
  contact: boolean
  /** The avatar URL is editable only on an existing account (API-018). */
  mode: 'create' | 'edit'
}

export function IdentityFields({ contact, mode }: IdentityFieldsProps) {
  const { t } = useTranslation()

  // Either identifier is enough; both fields re-validate when the other changes.
  const identifierRule: FormRule = ({ getFieldValue }) => ({
    validator: () => {
      const email = String(getFieldValue('email') ?? '').trim()
      const username = String(getFieldValue('username') ?? '').trim()
      return email || username ? Promise.resolve() : Promise.reject(new Error(t('users.validation.identifierRequired')))
    },
  })

  return (
    <>
      <Form.Item
        name="fullName"
        label={t('users.fields.fullName')}
        rules={[
          { required: true, whitespace: true, message: t('users.validation.fullName') },
          { min: 2, transform: (value: unknown) => (typeof value === 'string' ? value.trim() : value), message: t('users.validation.fullName') },
        ]}
      >
        <Input maxLength={200} autoComplete="off" />
      </Form.Item>
      <Form.Item name="fullNameLatin" label={t('users.fields.fullNameLatin')} rules={[minTwoIfPresent(t)]}>
        <Input dir="ltr" maxLength={200} autoComplete="off" />
      </Form.Item>
      <Form.Item name="displayName" label={t('users.fields.displayName')}>
        <Input maxLength={120} autoComplete="off" />
      </Form.Item>

      {contact ? (
        <>
          <Form.Item
            name="email"
            label={t('users.fields.email')}
            dependencies={['username']}
            validateFirst
            rules={[{ type: 'email', message: t('users.validation.email') }, identifierRule]}
          >
            <Input type="email" dir="ltr" maxLength={EMAIL_MAX_LENGTH} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="username"
            label={t('users.fields.username')}
            dependencies={['email']}
            validateFirst
            rules={[optionalRule(isValidUsername, t('users.validation.username')), identifierRule]}
          >
            <Input dir="ltr" maxLength={64} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="phone"
            label={t('users.fields.phone')}
            rules={[optionalRule((value) => E164_PATTERN.test(value), t('users.validation.phone'))]}
          >
            <Input dir="ltr" inputMode="tel" placeholder="+905551234567" autoComplete="off" />
          </Form.Item>
        </>
      ) : null}

      <Form.Item name="locale" label={t('users.fields.locale')}>
        <Select
          allowClear
          placeholder={t('users.locales.academyDefault')}
          options={USER_LOCALES.map((code) => ({ value: code, label: t(`users.locales.${code}`) }))}
        />
      </Form.Item>

      {mode === 'edit' ? (
        <Form.Item
          name="avatarUrl"
          label={t('users.fields.avatarUrl')}
          rules={[optionalRule((value) => HTTP_URL_PATTERN.test(value) && value.length <= 2048, t('users.validation.url'))]}
        >
          <Input dir="ltr" autoComplete="off" />
        </Form.Item>
      ) : null}
    </>
  )
}

/** Student profile fields; `notes` exists only on creation (the API never returns it, so it cannot be diffed). */
export function StudentProfileFields({ withNotes }: { withNotes: boolean }) {
  const { t } = useTranslation()
  return (
    <>
      <Form.Item name={['studentProfile', 'studentNumber']} label={t('users.fields.studentNumber')} rules={[referenceNumberRule(t)]}>
        <Input dir="ltr" maxLength={32} autoComplete="off" />
      </Form.Item>
      <Form.Item name={['studentProfile', 'dateOfBirth']} label={t('users.fields.dateOfBirth')} rules={[calendarDateRule(t)]}>
        <Input type="date" dir="ltr" />
      </Form.Item>
      <Form.Item name={['studentProfile', 'enrolledOn']} label={t('users.fields.enrolledOn')} rules={[calendarDateRule(t)]}>
        <Input type="date" dir="ltr" />
      </Form.Item>
      {withNotes ? (
        <Form.Item
          name={['studentProfile', 'notes']}
          label={t('users.fields.notes')}
          rules={[{ max: 2000, message: t('users.validation.maxLength', { max: 2000 }) }]}
        >
          <Input.TextArea rows={3} maxLength={2000} showCount />
        </Form.Item>
      ) : null}
    </>
  )
}

export function EmployeeProfileFields() {
  const { t } = useTranslation()
  return (
    <>
      <Form.Item name={['employeeProfile', 'employeeNumber']} label={t('users.fields.employeeNumber')} rules={[referenceNumberRule(t)]}>
        <Input dir="ltr" maxLength={32} autoComplete="off" />
      </Form.Item>
      <Form.Item
        name={['employeeProfile', 'jobTitle']}
        label={t('users.fields.jobTitle')}
        rules={[{ max: 120, message: t('users.validation.maxLength', { max: 120 }) }]}
      >
        <Input maxLength={120} autoComplete="off" />
      </Form.Item>
      <Form.Item
        name={['employeeProfile', 'specialization']}
        label={t('users.fields.specialization')}
        rules={[{ max: 120, message: t('users.validation.maxLength', { max: 120 }) }]}
      >
        <Input maxLength={120} autoComplete="off" />
      </Form.Item>
      <Form.Item name={['employeeProfile', 'hiredOn']} label={t('users.fields.hiredOn')} rules={[calendarDateRule(t)]}>
        <Input type="date" dir="ltr" />
      </Form.Item>
    </>
  )
}
