// Presentation of the attendance statuses (J-F25), shared by every screen that
// shows them: the attendance summary of the lesson drawer (J-F09), the
// attendance sheet (J-F10) and «my lessons» (J-F11). One map, so the screens
// never drift apart. The contract (statuses, limits, requests) stays in
// api/attendance.ts and the texts in i18n `lessons.attendance.*`; colours are
// presentation, like USER_STATUS_COLORS in users/users.format.ts.
import type { AttendanceStatus } from '../api/attendance'

/** antd `Tag` preset colours of the four attendance statuses. */
export const ATTENDANCE_STATUS_COLORS: Readonly<Record<AttendanceStatus, string>> = {
  present: 'green',
  absent: 'red',
  late: 'gold',
  excused: 'blue',
}
