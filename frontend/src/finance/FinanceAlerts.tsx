// The two error alerts of the finance forms (J-F52): a refused request with
// every problem the server named listed under its message
// (`fee_plan_invalid` / `invoice_invalid { problems }` — each worded on its
// own), and the problems the mirrored rules found before any request.
import { Alert } from 'antd'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { failureTitle, problemTexts } from './finance.errors'
import type { FinanceFailure } from './finance.errors'

function ProblemList({ items }: { items: readonly string[] }) {
  return (
    <ul style={{ margin: 0, paddingInlineStart: 20 }}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

export function FinanceFailureAlert({ failure, style }: { failure: FinanceFailure; style?: CSSProperties }) {
  const { t } = useTranslation()
  const problems = problemTexts(t, failure)
  return (
    <Alert
      type="error"
      showIcon
      title={failureTitle(t, failure)}
      description={problems.length > 0 ? <ProblemList items={problems} /> : undefined}
      style={style}
      data-testid="finance-failure"
    />
  )
}

/** The problems (finance.problems.<name>) the mirrored rules found in the form, under one title. */
export function FormProblemsAlert({ problems, style }: { problems: readonly string[]; style?: CSSProperties }) {
  const { t } = useTranslation()
  if (problems.length === 0) return null
  return (
    <Alert
      type="error"
      showIcon
      title={t('finance.problemsTitle')}
      description={<ProblemList items={problems.map((problem) => t(`finance.problems.${problem}`))} />}
      style={style}
      data-testid="finance-problems"
    />
  )
}
