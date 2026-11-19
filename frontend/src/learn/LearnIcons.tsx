// The small pictograms of the course player: a lesson's content kind, and its
// state (not started = a dashed ring, in progress = a solid ring, completed =
// a check). Decorative where a text says the same; the state carries its own
// accessible name, as no text beside it does.
import {
  CheckCircleFilled,
  FileOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  SoundOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import type { LearningItemKind, LearningState } from '../api/learning'

export function KindIcon({ kind }: { kind: LearningItemKind }) {
  const props = { className: 'learn-kind-icon', 'aria-hidden': true } as const
  switch (kind) {
    case 'video':
      return <PlayCircleOutlined {...props} />
    case 'audio':
      return <SoundOutlined {...props} />
    case 'pdf':
      return <FilePdfOutlined {...props} />
    case 'image':
      return <PictureOutlined {...props} />
    case 'file':
      return <FileOutlined {...props} />
    case 'live':
      return <VideoCameraOutlined {...props} />
    default:
      return <FileTextOutlined {...props} />
  }
}

/** A lesson's (or a level's: `completed` = complete) state, named by `label`. */
export function StateIcon({ state, label }: { state: LearningState; label: string }) {
  if (state === 'completed') {
    return (
      <span className="learn-state learn-state--completed" role="img" aria-label={label} title={label}>
        <CheckCircleFilled aria-hidden />
      </span>
    )
  }
  return <span className={`learn-state learn-state--${state}`} role="img" aria-label={label} title={label} />
}
