// The grade schemes tab of the settings page (J-F44 — MOD-09-T08 part a,
// API-122..API-125; owner decision D-R46): the list the server orders (the
// default first, then by creation) with each scheme's bands from their minimum,
// its final-grade count and its state; create/edit through GradeSchemeModal;
// and the row actions — make default (API-124 `isDefault: true`; an inactive
// scheme is activated in the same request), activate/deactivate (the default
// cannot be deactivated — the button is disabled with the reason, as the
// server would answer `grade_scheme_is_default`), and delete behind a
// confirmation (never the default, never a scheme final grades use — the
// server's `grade_scheme_in_use` covers a grade fixed meanwhile). Every write
// is followed by a re-read of the list: a promotion makes another scheme step
// down, and the order and the counts come from the server. The tab is
// management-only by design, like the branches and rooms tabs: the route
// (`guarded('gradeSchemes')`), the nav entry and SettingsPage (`RequireAccess
// permission="academy.settings.manage"`) mount it for holders of
// `academy.settings.manage` only; the server stays the boundary.
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, StarFilled, StarOutlined, StopOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteGradeScheme, updateGradeScheme } from '../api/gradeSchemes'
import type { GradeScheme, GradeSchemeBand } from '../api/gradeSchemes'
import { StatusTag } from '../components/StatusTag'
import type { Language } from '../i18n/language'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { GradeSchemeModal } from './GradeSchemeModal'
import { describeGradeSchemesFailure, failureMessage } from './gradeSchemes.errors'
import { deactivateRefusalOf, deleteBlockerOf, promoteSchemeBody } from './gradeSchemes.form'
import { useGradeSchemes } from './useGradeSchemes'

const EMPTY = '—'

/** The bands from their minimum, as the server sends them (ascending): label, letter, and pass/fail by colour, icon and title. */
function BandTags({ bands, language }: { bands: readonly GradeSchemeBand[]; language: Language }) {
  const { t } = useTranslation()
  return (
    <Flex wrap gap={4} style={{ maxWidth: 560 }}>
      {bands.map((band) => (
        <Tag
          key={band.minPercent}
          color={band.isPass ? 'green' : 'red'}
          icon={band.isPass ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
          title={t(band.isPass ? 'gradeSchemes.pass' : 'gradeSchemes.fail')}
          data-testid="grade-band"
        >
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

export function GradeSchemesManager() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { schemes, loading, error, reload } = useGradeSchemes()
  const [editing, setEditing] = useState<GradeScheme | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  const nameOf = (scheme: GradeScheme) => localizedLabel(scheme.name, language)

  /** Runs one write, then re-reads the list — after a refusal too (the list may be stale). */
  const run = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await task()
      message.success(success)
    } catch (caught) {
      message.error(failureMessage(t, describeGradeSchemesFailure(caught)))
    } finally {
      setBusy(false)
      reload()
    }
  }

  const promote = (scheme: GradeScheme) => run(() => updateGradeScheme(scheme.id, promoteSchemeBody(scheme)), t('gradeSchemes.promoted', { name: nameOf(scheme) }))
  const activate = (scheme: GradeScheme) => run(() => updateGradeScheme(scheme.id, { isActive: true }), t('gradeSchemes.activated', { name: nameOf(scheme) }))
  const deactivate = (scheme: GradeScheme) => run(() => updateGradeScheme(scheme.id, { isActive: false }), t('gradeSchemes.deactivated', { name: nameOf(scheme) }))
  const remove = (scheme: GradeScheme) => run(() => deleteGradeScheme(scheme.id), t('gradeSchemes.deleted', { name: nameOf(scheme) }))

  const saved = (scheme: GradeScheme, created: boolean) => {
    setEditing(null)
    message.success(created ? t('gradeSchemes.created', { name: nameOf(scheme) }) : t('gradeSchemes.saved'))
    reload()
  }

  const columns: TableProps<GradeScheme>['columns'] = [
    {
      title: t('gradeSchemes.columns.name'),
      key: 'name',
      render: (_, row) => (
        <Space size={6} wrap>
          <Typography.Text strong>{nameOf(row)}</Typography.Text>
          {row.isDefault ? (
            <Tag color="gold" icon={<StarFilled />}>
              {t('gradeSchemes.default')}
            </Tag>
          ) : null}
        </Space>
      ),
    },
    { title: t('gradeSchemes.columns.bands'), key: 'bands', render: (_, row) => <BandTags bands={row.bands} language={language} /> },
    { title: t('gradeSchemes.columns.finalGrades'), key: 'finalGrades', render: (_, row) => (row.finalGradeCount === null ? EMPTY : row.finalGradeCount) },
    { title: t('gradeSchemes.columns.status'), key: 'status', render: (_, row) => <StatusTag value={row.isActive ? 'active' : 'inactive'} /> },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => {
        const name = nameOf(row)
        const deleteLabel = `${t('gradeSchemes.actions.delete')}: ${name}`
        const deactivateLabel = `${t('gradeSchemes.actions.deactivate')}: ${name}`
        const deleteBlocker = deleteBlockerOf(row)
        return (
          <Space size={4} wrap>
            <Button size="small" icon={<EditOutlined />} aria-label={`${t('common.edit')}: ${name}`} disabled={busy} onClick={() => setEditing(row)} />
            {row.isDefault ? null : (
              <Popconfirm
                title={t(row.isActive ? 'gradeSchemes.actions.setDefaultConfirm' : 'gradeSchemes.actions.setDefaultConfirmInactive', { name })}
                okText={t('gradeSchemes.actions.setDefault')}
                cancelText={t('common.cancel')}
                onConfirm={() => promote(row)}
              >
                <Button size="small" icon={<StarOutlined />} aria-label={`${t('gradeSchemes.actions.setDefault')}: ${name}`} disabled={busy} />
              </Popconfirm>
            )}
            {row.isActive ? (
              deactivateRefusalOf(row) ? (
                <Tooltip title={t('gradeSchemes.actions.deactivateDefaultHint')}>
                  <span>
                    <Button size="small" icon={<StopOutlined />} aria-label={deactivateLabel} disabled />
                  </span>
                </Tooltip>
              ) : (
                <Popconfirm
                  title={t('gradeSchemes.actions.deactivateConfirm', { name })}
                  okText={t('gradeSchemes.actions.deactivate')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => deactivate(row)}
                >
                  <Button size="small" icon={<StopOutlined />} aria-label={deactivateLabel} disabled={busy} />
                </Popconfirm>
              )
            ) : (
              <Button
                size="small"
                icon={<CheckCircleOutlined />}
                aria-label={`${t('gradeSchemes.actions.activate')}: ${name}`}
                disabled={busy}
                onClick={() => void activate(row)}
              />
            )}
            {deleteBlocker ? (
              <Tooltip
                title={
                  deleteBlocker === 'default'
                    ? t('gradeSchemes.actions.deleteDefaultHint')
                    : t('gradeSchemes.actions.deleteInUseHint', { count: row.finalGradeCount ?? 0 })
                }
              >
                <span>
                  <Button size="small" danger icon={<DeleteOutlined />} aria-label={deleteLabel} disabled />
                </span>
              </Tooltip>
            ) : (
              <Popconfirm
                title={t('gradeSchemes.actions.deleteConfirm', { name })}
                okText={t('gradeSchemes.actions.delete')}
                okButtonProps={{ danger: true }}
                cancelText={t('common.cancel')}
                onConfirm={() => remove(row)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} aria-label={deleteLabel} disabled={busy} />
              </Popconfirm>
            )}
          </Space>
        )
      },
    },
  ]

  return (
    <Card>
      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary">{t('gradeSchemes.hint')}</Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={reload} aria-label={t('gradeSchemes.refresh')} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {t('gradeSchemes.add')}
          </Button>
        </Space>
      </Flex>

      {error ? (
        <Alert
          type="error"
          showIcon
          title={t('gradeSchemes.loadFailed')}
          description={failureMessage(t, describeGradeSchemesFailure(error))}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={reload} loading={loading}>
              {t('gradeSchemes.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Table<GradeScheme>
        rowKey="id"
        columns={columns}
        dataSource={schemes}
        loading={loading || busy}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('gradeSchemes.empty') }}
      />

      {/* Mounted per session: its form starts from the chosen scheme, never from the values of an earlier session (KI-049). */}
      {editing !== null ? (
        <GradeSchemeModal
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.updatedAt}`}
          scheme={editing === 'new' ? null : editing}
          firstScheme={!loading && !error && schemes.length === 0}
          onClose={() => setEditing(null)}
          onSaved={saved}
          onStale={reload}
        />
      ) : null}
    </Card>
  )
}
