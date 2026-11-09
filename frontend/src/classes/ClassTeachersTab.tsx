// Teachers tab of the class drawer (J-F01 on API-056). Everyone who can read
// the class sees its teachers (lead first). Holders of
// `classes.teachers.assign` edit a draft list — add through the teacher search
// (API-012 `role=teacher`, needs `users.read`), change a role, remove — and save
// it as ONE `PUT /api/classes/:id/teachers` with the whole list, only when it
// differs from the server's. At most one lead and no ineligible user are
// refused here first; the server stays the boundary. A draft row shows the
// full name, as the server's list does after the save (J-F14).
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { Alert, App, Button, Empty, Flex, List, Select, Space, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CLASS_TEACHER_ROLES, replaceClassTeachers } from '../api/classes'
import type { AcademyClass, ClassTeacherRole } from '../api/classes'
import type { UserListItem } from '../api/users'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { TeacherPicker } from './ClassPickers'
import { describeClassesFailure, failureMessage } from './classes.errors'
import { CLASS_TEACHERS_MAX, candidateRefusal, planTeachersReplacement, teacherDraftOf, teacherDraftsOf, teacherListProblems } from './classes.teachers'
import type { TeacherDraft } from './classes.teachers'

interface ClassTeachersTabProps {
  cls: AcademyClass
  /** The class the server returned after the replacement. */
  onUpdated: (cls: AcademyClass) => void
  /** Whether the editor is open (KI-052): the class drawer then keeps Escape and a mask click from dropping the draft. */
  onEditingChange?: (open: boolean) => void
}

export function ClassTeachersTab({ cls, onUpdated, onEditingChange }: ClassTeachersTabProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canAssign = hasPermission('classes.teachers.assign')
  const canSearch = hasPermission('users.read')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    onEditingChange?.(editing)
    return () => onEditingChange?.(false)
  }, [editing, onEditingChange])

  if (editing) {
    // Mounted per edit session, so the draft always starts from the server's list.
    return (
      <TeachersEditor
        cls={cls}
        onSaved={(updated) => {
          onUpdated(updated)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <>
      {canAssign ? (
        <Flex justify="flex-end" style={{ marginBottom: 12 }}>
          <Button icon={<EditOutlined />} onClick={() => setEditing(true)} disabled={!canSearch}>
            {t('classes.teachers.edit')}
          </Button>
        </Flex>
      ) : null}
      {canAssign && !canSearch ? <Alert type="info" showIcon message={t('classes.teachers.searchNeedsUsersRead')} style={{ marginBottom: 12 }} /> : null}
      {cls.teachers.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('classes.teachers.empty')} />
      ) : (
        <List
          dataSource={cls.teachers}
          rowKey="userId"
          renderItem={(teacher) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space>
                    {teacher.fullName}
                    <Tag color={teacher.role === 'lead' ? 'blue' : 'default'}>{t(`classes.teacherRoles.${teacher.role}`)}</Tag>
                  </Space>
                }
                description={t('classes.teachers.assignedAt', { date: formatDateTime(teacher.assignedAt, language) })}
              />
            </List.Item>
          )}
        />
      )}
    </>
  )
}

interface TeachersEditorProps {
  cls: AcademyClass
  onSaved: (cls: AcademyClass) => void
  onCancel: () => void
}

function TeachersEditor({ cls, onSaved, onCancel }: TeachersEditorProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [drafts, setDrafts] = useState<TeacherDraft[]>(() => teacherDraftsOf(cls.teachers))
  // A new key remounts the search after each addition, so it starts empty again
  // (`value={undefined}` alone would leave antd's Select uncontrolled).
  const [pickerKey, setPickerKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const problems = teacherListProblems(drafts)
  const full = drafts.length >= CLASS_TEACHERS_MAX

  const refusalOf = (candidate: UserListItem): string | undefined => {
    const refusal = candidateRefusal(candidate, drafts)
    return refusal ? t(`classes.teachers.refusals.${refusal}`) : undefined
  }

  const add = (candidate: UserListItem | undefined) => {
    if (!candidate || candidateRefusal(candidate, drafts) || full) return
    setDrafts((current) => [...current, teacherDraftOf(candidate, current)])
    setPickerKey((key) => key + 1)
  }

  const setRole = (userId: string, role: ClassTeacherRole) =>
    setDrafts((current) => current.map((draft) => (draft.userId === userId ? { ...draft, role } : draft)))

  const remove = (userId: string) => setDrafts((current) => current.filter((draft) => draft.userId !== userId))

  const save = async () => {
    if (problems) return
    const body = planTeachersReplacement(cls.teachers, drafts)
    if (!body) {
      message.info(t('classes.teachers.nothingChanged'))
      onCancel()
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updated = await replaceClassTeachers(cls.id, body)
      message.success(t('classes.teachers.saved'))
      onSaved(updated)
    } catch (caught) {
      const names = new Map(drafts.map((draft) => [draft.userId, draft.fullName]))
      setError(failureMessage(t, describeClassesFailure(caught, (userId) => names.get(userId))))
      setSaving(false)
    }
  }

  return (
    <>
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
      {problems && problems.leadCount > 1 ? <Alert type="warning" showIcon message={t('classes.teachers.oneLead')} style={{ marginBottom: 12 }} /> : null}
      <TeacherPicker
        key={pickerKey}
        onChange={(_value, candidate) => add(candidate)}
        refusalOf={refusalOf}
        disabled={saving || full}
        placeholder={full ? t('classes.teachers.maxReached', { max: CLASS_TEACHERS_MAX }) : t('classes.teachers.searchPlaceholder')}
        aria-label={t('classes.teachers.add')}
        style={{ width: '100%', marginBottom: 12 }}
      />
      {drafts.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('classes.teachers.emptyDraft')} />
      ) : (
        <List
          dataSource={drafts}
          rowKey="userId"
          renderItem={(draft) => (
            <List.Item
              actions={[
                <Select<ClassTeacherRole>
                  key="role"
                  size="small"
                  value={draft.role}
                  disabled={saving}
                  aria-label={`${t('classes.teachers.role')}: ${draft.fullName}`}
                  onChange={(role) => setRole(draft.userId, role)}
                  options={CLASS_TEACHER_ROLES.map((role) => ({ value: role, label: t(`classes.teacherRoles.${role}`) }))}
                  style={{ minWidth: 120 }}
                />,
                <Button
                  key="remove"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={saving}
                  aria-label={`${t('classes.teachers.remove')}: ${draft.fullName}`}
                  onClick={() => remove(draft.userId)}
                />,
              ]}
            >
              <Typography.Text>{draft.fullName}</Typography.Text>
            </List.Item>
          )}
        />
      )}
      <Flex gap={8} justify="flex-end" style={{ marginTop: 12 }}>
        <Button onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" onClick={() => void save()} loading={saving} disabled={problems !== null}>
          {t('classes.teachers.save')}
        </Button>
      </Flex>
    </>
  )
}
