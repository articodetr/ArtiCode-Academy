// A failed read of one «My School» source, with its own «try again» (the other sources keep their content).
import { Alert, Button } from 'antd'
import { useTranslation } from 'react-i18next'

export function SourceAlert({ title, description, onRetry }: { title: string; description: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <Alert
      type="error"
      showIcon
      title={title}
      description={description}
      action={
        <Button size="small" onClick={onRetry}>
          {t('mySchool.retry')}
        </Button>
      }
    />
  )
}
