// PORTAL-04 phase 1: the course picture field. A Form control whose value stays
// the plain link string (the validation rule and the unsaved-changes guard read
// it as before), with a live preview in the public card's ratio. The preview
// only informs: a picture that fails to load is a warning and never blocks a
// save, because the image host may be down only for now.
import { CloseOutlined, LoadingOutlined, PictureOutlined, WarningOutlined } from '@ant-design/icons'
import { Button, Input, Space } from 'antd'
import type { InputProps, InputRef } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  COVER_PREVIEW_DELAY_MS,
  COVER_RECOMMENDED_HEIGHT,
  COVER_RECOMMENDED_WIDTH,
  NO_COVER_LOAD,
  coverLinkOf,
  coverPreviewState,
  settleCoverLoad,
  startCoverLoad,
} from './courses.cover'
import type { CoverPreviewState } from './courses.cover'
import { COVER_IMAGE_URL_MAX } from './courses.form'
import './courseCover.css'

export interface CourseCoverFieldProps extends Omit<InputProps, 'value' | 'onChange'> {
  value?: string
  onChange?: (value: string) => void
  /** The page's origin, which decides whether an `http:` link can show (default: this page). */
  origin?: string
}

const isPasted = (event: ChangeEvent<HTMLInputElement>) => {
  const { inputType } = event.nativeEvent as InputEvent
  return inputType === 'insertFromPaste' || inputType === 'insertFromDrop'
}

function PreviewIcon({ state }: { state: CoverPreviewState }) {
  if (state === 'loading') return <LoadingOutlined aria-hidden />
  if (state === 'failed' || state === 'mixed') return <WarningOutlined aria-hidden />
  return <PictureOutlined aria-hidden />
}

export function CourseCoverField({ value, onChange, origin, ...inputProps }: CourseCoverFieldProps) {
  const { t } = useTranslation()
  const inputRef = useRef<InputRef>(null)
  const [load, setLoad] = useState(() => {
    const initial = coverLinkOf(value, origin)
    return initial.kind === 'ready' ? startCoverLoad(NO_COVER_LOAD, initial.src) : NO_COVER_LOAD
  })

  const link = coverLinkOf(value, origin)
  const target = link.kind === 'ready' ? link.src : null
  // A link that cannot show drops the picture at once, so it never comes back while the next link waits.
  if (target === null && load.src !== null) setLoad(NO_COVER_LOAD)

  useEffect(() => {
    if (target === null || target === load.src) return
    const timer = setTimeout(() => setLoad((current) => startCoverLoad(current, target)), COVER_PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [target, load.src])

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value
    onChange?.(next)
    if (!isPasted(event)) return
    const pasted = coverLinkOf(next, origin)
    if (pasted.kind === 'ready') setLoad((current) => startCoverLoad(current, pasted.src))
  }

  const clear = () => {
    onChange?.('')
    setLoad(NO_COVER_LOAD)
    // The button leaves with the value: the keyboard stays in the field.
    inputRef.current?.focus()
  }

  const state = coverPreviewState(link, load)
  const shownSrc = load.src
  const warning = state === 'failed' || state === 'mixed'

  return (
    <div className="course-cover-field">
      <div className="course-cover-field__entry">
        <Space.Compact block>
          <Input
            {...inputProps}
            ref={inputRef}
            value={value ?? ''}
            onChange={change}
            dir="ltr"
            maxLength={COVER_IMAGE_URL_MAX}
            placeholder="https://"
            inputMode="url"
          />
          {value ? <Button icon={<CloseOutlined />} aria-label={t('courseCover.clear')} disabled={inputProps.disabled} onClick={clear} /> : null}
        </Space.Compact>
        <span className="course-cover-field__hint">
          {t('courseCover.sizeLabel')}{' '}
          <bdi dir="ltr">
            {COVER_RECOMMENDED_WIDTH} × {COVER_RECOMMENDED_HEIGHT} px
          </bdi>{' '}
          {t('courseCover.sizeNote')}
        </span>
      </div>
      <figure className="course-cover-field__figure">
        <div className="course-cover-field__frame" data-state={state} data-testid="course-cover-preview">
          {/* By the load's own outcome, not `state`: the older picture stays until the new link answers, and a failed one is not retried. */}
          {shownSrc !== null && load.outcome !== 'failed' ? (
            <img
              key={shownSrc}
              className="course-cover-field__image"
              data-outcome={load.outcome}
              src={shownSrc}
              alt=""
              referrerPolicy="no-referrer"
              onLoad={() => setLoad((current) => settleCoverLoad(current, shownSrc, 'loaded'))}
              onError={() => setLoad((current) => settleCoverLoad(current, shownSrc, 'failed'))}
            />
          ) : null}
          {state === 'loaded' ? null : (
            <span className="course-cover-field__placeholder">
              <PreviewIcon state={state} />
            </span>
          )}
        </div>
        <figcaption>
          <span role="status" className="course-cover-field__caption" data-tone={warning ? 'warning' : 'neutral'}>
            {warning ? <WarningOutlined aria-hidden /> : null}
            <span>
              {t(`courseCover.states.${state}`)}
              {state === 'invalid' || state === 'mixed' ? (
                <>
                  {' '}
                  <bdi dir="ltr">https://</bdi>
                </>
              ) : null}
              {state === 'failed' ? ` ${t('courseCover.states.failedNote')}` : null}
            </span>
          </span>
        </figcaption>
      </figure>
    </div>
  )
}
