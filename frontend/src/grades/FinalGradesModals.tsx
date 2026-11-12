// The two confirmations of the gradebook tab (J-F49): finalize (API-127) with a
// picker over the active grade schemes of API-122 — the default preselected —
// and withdraw (API-128). Each is mounted per session by the tab. A success
// hands the gradebook the server answered back to the tab (shown without
// another read). A refusal that means the gradebook changed under the screen
// (`class_not_gradable`, `grades_not_ready`, `grade_scheme_missing`,
// `grades_certified`) or that the class is out of reach (404) goes back to the
// tab, which closes the dialog, says why and re-reads the gradebook; a scheme
// that went away meanwhile (`grade_scheme_not_found`) keeps the dialog open
// and re-reads the schemes; anything retryable (network, 5xx, 403, 429) stays
// in the dialog with its message. The finalization always names the scheme the
// user saw (`schemeId`), so a default changed meanwhile never decides for them.
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { Alert, App, Button, Flex, Form, Modal, Select, Tag, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { finalizeGrades, withdrawFinalGrades } from '../api/gradebook'
import type { Gradebook } from '../api/gradebook'
import type { GradeScheme } from '../api/gradeSchemes'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { describeGradebookFailure, gradebookFailureMessage } from './gradebook.errors'
import type { GradebookFailure } from './gradebook.errors'
import { finalizeSchemeOptions, hasFinalGrades, preselectedSchemeId } from './gradebook.view'
import { describeGradeSchemesFailure, failureMessage as gradeSchemesFailureMessage } from './gradeSchemes.errors'
import { useGradeSchemes } from './useGradeSchemes'

/** The settings tab that manages the grade schemes (J-F44), offered to a holder of its key when no scheme is active. */
const GRADE_SCHEMES_ROUTE = '/settings/grade-schemes'

interface FinalGradesModalProps {
  gradebook: Gradebook
  /** The gradebook the server answered after the write. */
  onDone: (gradebook: Gradebook) => void
  /** The write was refused because the gradebook changed (`stale`) or the class is out of reach (`gone`): the tab takes over. */
  onRefused: (failure: GradebookFailure) => void
  onCancel: () => void
}

/** The bands of the chosen scheme from their minimum, as the server sends them (ascending). */
function SchemeBands({ scheme }: { scheme: GradeScheme }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <Flex wrap gap={4} align="center" data-testid="finalize-scheme-bands">
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('gradebook.finalize.bands')}
      </Typography.Text>
      {scheme.bands.map((band) => (
        <Tag key={band.minPercent} color={band.isPass ? 'green' : 'red'} icon={band.isPass ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
          {localizedLabel(band.label, language)}
          {band.letter ? (
            <>
              {' '}
              <bdi dir="ltr">({band.letter})</bdi>
            </>
          ) : null}{' '}
          <span dir="ltr">≥ {band.minPercent}%</span>
        </Tag>
      ))}
    </Flex>
  )
}

export function FinalizeGradesModal({ gradebook, onDone, onRefused, onCancel }: FinalGradesModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const { schemes, loading, error: schemesError, reload: reloadSchemes } = useGradeSchemes()
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = finalizeSchemeOptions(schemes)
  // The user's choice while it is still offered, else the default (also after a re-read dropped the choice).
  const schemeId = picked !== null && options.some((scheme) => scheme.id === picked) ? picked : preselectedSchemeId(options, gradebook.defaultScheme)
  const selected = options.find((scheme) => scheme.id === schemeId) ?? null
  const again = hasFinalGrades(gradebook)
  const name = localizedLabel(gradebook.class.name, language)
  const noSchemes = !loading && !schemesError && options.length === 0

  const confirm = async () => {
    if (!schemeId) return
    setBusy(true)
    setError(null)
    try {
      const updated = await finalizeGrades(gradebook.class.id, { schemeId })
      message.success(t('gradebook.finalize.done'))
      onDone(updated)
    } catch (caught) {
      setBusy(false)
      const failure = describeGradebookFailure(caught)
      if (failure.next === 'stale' || failure.next === 'gone') {
        onRefused(failure)
        return
      }
      if (failure.next === 'scheme') {
        // The scheme was deactivated or deleted meanwhile: offer the schemes as they are now.
        setPicked(null)
        reloadSchemes()
      }
      setError(gradebookFailureMessage(t, failure))
    }
  }

  return (
    <Modal
      open
      title={t(again ? 'gradebook.finalize.titleAgain' : 'gradebook.finalize.title', { name })}
      okText={t('gradebook.finalize.ok')}
      okButtonProps={{ disabled: !selected || loading }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <Typography.Paragraph>{t('gradebook.finalize.body')}</Typography.Paragraph>
      {again ? <Alert type="info" showIcon title={t('gradebook.finalize.again')} style={{ marginBottom: 12 }} /> : null}
      {schemesError ? (
        <Alert
          type="error"
          showIcon
          title={`${t('gradebook.finalize.schemesFailed')}: ${gradeSchemesFailureMessage(t, describeGradeSchemesFailure(schemesError))}`}
          action={
            <Button size="small" onClick={reloadSchemes}>
              {t('gradebook.retry')}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {noSchemes ? (
        <Alert
          type="warning"
          showIcon
          title={t('gradebook.finalize.noSchemes')}
          description={hasPermission('academy.settings.manage') ? <Link to={GRADE_SCHEMES_ROUTE}>{t('gradebook.finalize.openSchemes')}</Link> : t('gradebook.finalize.askForSchemes')}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Form layout="vertical" disabled={busy}>
        <Form.Item label={t('gradebook.finalize.scheme')} htmlFor="finalize-grade-scheme" extra={selected ? <SchemeBands scheme={selected} /> : null}>
          <Select
            id="finalize-grade-scheme"
            value={schemeId ?? undefined}
            loading={loading}
            disabled={loading || options.length === 0}
            placeholder={t('gradebook.finalize.schemePlaceholder')}
            onChange={(value: string) => setPicked(value)}
            options={options.map((scheme) => ({
              value: scheme.id,
              label: scheme.isDefault ? `${localizedLabel(scheme.name, language)} — ${t('gradebook.finalize.defaultTag')}` : localizedLabel(scheme.name, language),
            }))}
          />
        </Form.Item>
      </Form>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  )
}

export function WithdrawFinalGradesModal({ gradebook, onDone, onRefused, onCancel }: FinalGradesModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = localizedLabel(gradebook.class.name, language)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const updated = await withdrawFinalGrades(gradebook.class.id)
      message.success(t('gradebook.withdraw.done'))
      onDone(updated)
    } catch (caught) {
      setBusy(false)
      const failure = describeGradebookFailure(caught)
      if (failure.next === 'stale' || failure.next === 'gone') {
        onRefused(failure)
        return
      }
      setError(gradebookFailureMessage(t, failure))
    }
  }

  return (
    <Modal
      open
      title={t('gradebook.withdraw.title', { name })}
      okText={t('gradebook.withdraw.ok')}
      okButtonProps={{ danger: true }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <Typography.Paragraph>{t('gradebook.withdraw.body')}</Typography.Paragraph>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  )
}
