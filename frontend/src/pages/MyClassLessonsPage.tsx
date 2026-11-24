// The lessons of one class (J-F62, CH-0238): /my-classes/:classId, opened from the class's name in «فصولي». It is the
// list of «دروسي» (API-101 with `classId`) under the class's own header. Ownership decides, as on both pages: the class
// must be among the caller's `active`/`completed` enrollments (API-060), else the page says so and asks for nothing.
// A guardian with two children in the class arrives on the child whose row they opened (`?student=`) and can switch.
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { Alert, Button, Card, ConfigProvider, Empty } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { describeClassesFailure, failureMessage } from '../classes/classes.errors'
import { PageHeader } from '../components/PageHeader'
import { useMyClasses } from '../enrollments/useMyClasses'
import { useLocalized } from '../i18n/useLocalized'
import { HUB_ANTD_THEME } from '../learn/hub/hub.theme'
import '../publicCatalog/publicFonts.css'
import '../learn/hub/hub.css'
import { MyLessonsList } from '../lessons/MyLessonsList'
import { CLASS_LESSONS_STUDENT_PARAM } from '../lessons/myLessons.view'
import { useAcademyZone } from '../lessons/useAcademyZone'
import { localizedLabel } from '../users/users.format'

export function MyClassLessonsPage() {
  const { t, i18n } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const { classId = '' } = useParams()
  const [params] = useSearchParams()
  const zone = useAcademyZone()
  const myClasses = useMyClasses()
  const enrollments = myClasses.items.filter((item) => item.class.id === classId)
  const enrollment = enrollments[0]

  const back = (
    <Button icon={i18n.dir() === 'rtl' ? <ArrowRightOutlined aria-hidden /> : <ArrowLeftOutlined aria-hidden />} onClick={() => navigate('/my-classes')}>
      {t('myClasses.classLessons.back')}
    </Button>
  )

  if (!enrollment) {
    const failure = myClasses.error ? describeClassesFailure(myClasses.error) : null
    return (
      <ConfigProvider theme={HUB_ANTD_THEME}>
        <div className="hub-sessions">
          <PageHeader title={t('myClasses.classLessons.title')} extra={back} />
          {myClasses.loading ? (
            <Card loading />
          ) : failure ? (
            <Alert
              type="error"
              showIcon
              title={failureMessage(t, failure)}
              action={
                <Button size="small" onClick={myClasses.reload}>
                  {t('myClasses.refresh')}
                </Button>
              }
            />
          ) : (
            <Card>
              <Empty description={t('myClasses.classLessons.notFound')} />
            </Card>
          )}
        </div>
      </ConfigProvider>
    )
  }

  const requestedStudent = params.get(CLASS_LESSONS_STUDENT_PARAM)
  const initialStudentId = enrollments.find((item) => item.student.id === requestedStudent)?.student.id
  // The code is isolated so that one starting with digits keeps its order inside the Arabic line.
  const subtitle = `${localizedLabel(enrollment.class.course.name, language)} · ⁦${enrollment.class.code}⁩`

  return (
    <ConfigProvider theme={HUB_ANTD_THEME}>
      <div className="hub-sessions">
        <PageHeader title={localizedLabel(enrollment.class.name, language)} subtitle={subtitle} extra={back} />
        {zone.settled ? (
          <MyLessonsList key={`${classId}:${initialStudentId ?? ''}:${zone.timeZone}`} dayZone={zone.timeZone} myClasses={myClasses} classId={classId} initialStudentId={initialStudentId} />
        ) : (
          <Card loading />
        )}
      </div>
    </ConfigProvider>
  )
}
