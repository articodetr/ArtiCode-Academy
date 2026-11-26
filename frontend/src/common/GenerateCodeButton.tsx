// «توليد رمز» (CH-0372/CH-0373): one button for every code field — it writes a new generated code into the field and
// clears its error. The user may still type their own code.
import { ThunderboltOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'
import { generateUniqueCode } from './codeGenerator'

interface GenerateCodeButtonProps {
  form: FormInstance
  prefix: string
  /** The codes already in the list the screen holds; a generated code is never one of them. */
  takenCodes?: readonly string[]
  bodyLength?: number
  field?: string
}

export function GenerateCodeButton({ form, prefix, takenCodes = [], bodyLength, field = 'code' }: GenerateCodeButtonProps) {
  const { t } = useTranslation()
  return (
    <Button
      size="small"
      icon={<ThunderboltOutlined />}
      onClick={() => form.setFields([{ name: field, value: generateUniqueCode(prefix, takenCodes, undefined, bodyLength), errors: [] }])}
    >
      {t('common.generateCode')}
    </Button>
  )
}
