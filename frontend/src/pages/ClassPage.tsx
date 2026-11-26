// CH-0374: one class as its own page (/classes/:classId) — the class drawer's tabs (details, teachers, students,
// schedule, grades, certificates) plus the class's lessons, homework and exams, so a teacher manages a class from
// one place. «رجوع» goes back to the list; unsaved work is guarded like a browser back.
import { useNavigate, useParams } from 'react-router'
import { ClassDrawer } from '../classes/ClassDrawer'
import { CLASSES_PAGE_PATH } from '../classes/classPage'

export function ClassPage() {
  const { classId = null } = useParams()
  const navigate = useNavigate()
  const back = () => void navigate(CLASSES_PAGE_PATH)
  return <ClassDrawer key={classId ?? ''} variant="page" classId={classId} onClose={back} onUpdated={() => undefined} onDeleted={back} />
}
