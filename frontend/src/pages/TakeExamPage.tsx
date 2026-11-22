// MOD-09 phase 2 (roadmap §4r — OEX-T07): the page a learner takes an online
// exam on, /take-exam/:attemptId — outside the app layout and behind sign-in
// (app/router.tsx). The server answers an attempt to its owner alone (API-277:
// anybody else's is 404), so the page has no gate of its own. Everything is in
// src/takeExam/ (TakeExamScreen); the screen is mounted per attempt, so
// opening another attempt of the same exam starts from a clean state.
import { useParams } from 'react-router'
import { TakeExamScreen } from '../takeExam/TakeExamScreen'

export function TakeExamPage() {
  const { attemptId = '' } = useParams<{ attemptId: string }>()
  return <TakeExamScreen key={attemptId} attemptId={attemptId} />
}
