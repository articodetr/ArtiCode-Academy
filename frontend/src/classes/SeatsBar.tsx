// Seats taken over capacity as a bar (J-F01): shared by the classes list, the
// class drawer and the roster tab (J-F04) — in its own file so the roster tab
// does not import the drawer that mounts it.
import { Progress } from 'antd'
import type { AcademyClass } from '../api/classes'

export function SeatsBar({ cls }: { cls: Pick<AcademyClass, 'enrolledCount' | 'capacity'> }) {
  const percent = cls.capacity > 0 ? Math.round((cls.enrolledCount / cls.capacity) * 100) : 0
  return (
    <Progress
      percent={percent}
      size="small"
      status={cls.enrolledCount >= cls.capacity ? 'exception' : 'normal'}
      format={() => <span dir="ltr">{`${cls.enrolledCount} / ${cls.capacity}`}</span>}
      style={{ minWidth: 120, marginBottom: 0 }}
    />
  )
}
