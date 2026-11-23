import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Button, Form } from 'antd'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { renderWithProviders } from '../test/render'
import { CourseCoverField } from './CourseCoverField'
import { COVER_PREVIEW_DELAY_MS } from './courses.cover'
import { isCoverImageUrl } from './courses.form'

const HTTP_PAGE = 'http://localhost:5173'
const HTTPS_PAGE = 'https://academy.example.org'
const A = 'https://cdn.example.org/a.jpg'
const B = 'https://cdn.example.org/b.jpg'
const text = ar.courseCover.states

function Controlled({ initial = '', origin = HTTP_PAGE, onValue }: { initial?: string; origin?: string; onValue?: (value: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <CourseCoverField
      id="cover"
      aria-label="cover"
      value={value}
      origin={origin}
      onChange={(next) => {
        setValue(next)
        onValue?.(next)
      }}
    />
  )
}

const input = () => screen.getByLabelText('cover')
const frame = () => screen.getByTestId('course-cover-preview')
const image = () => frame().querySelector('img')
const status = () => screen.getByRole('status')
const type = (value: string) => fireEvent.change(input(), { target: { value } })
const paste = (value: string) => fireEvent.input(input(), { target: { value }, inputType: 'insertFromPaste' })
const settle = () => act(() => vi.advanceTimersByTime(COVER_PREVIEW_DELAY_MS))

describe('CourseCoverField', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('words the empty state, with the recommended size and no picture', () => {
    renderWithProviders(<Controlled />)
    expect(status()).toHaveTextContent(text.empty)
    expect(image()).toBeNull()
    expect(screen.getByText('1200 × 780 px')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ar.courseCover.clear })).toBeNull()
  })

  it('follows typing after the delay, then shows the loaded picture', () => {
    renderWithProviders(<Controlled />)
    type(A)
    expect(image()).toBeNull()
    expect(status()).toHaveTextContent(text.loading)
    act(() => vi.advanceTimersByTime(COVER_PREVIEW_DELAY_MS - 1))
    expect(image()).toBeNull()
    act(() => vi.advanceTimersByTime(1))

    const picture = image()!
    expect(picture).toHaveAttribute('src', A)
    expect(picture).toHaveAttribute('alt', '')
    expect(picture).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(frame()).toHaveAttribute('data-state', 'loading')

    fireEvent.load(picture)
    expect(frame()).toHaveAttribute('data-state', 'loaded')
    expect(status()).toHaveTextContent(text.loaded)
  })

  it('shows a pasted link at once', () => {
    renderWithProviders(<Controlled />)
    paste(A)
    expect(image()).toHaveAttribute('src', A)
  })

  it('shows a saved link at once when the form opens', () => {
    renderWithProviders(<Controlled initial={A} />)
    expect(image()).toHaveAttribute('src', A)
  })

  it('words a failed picture as a warning and keeps the value', () => {
    const onValue = vi.fn()
    renderWithProviders(<Controlled onValue={onValue} />)
    paste(A)
    fireEvent.error(image()!)

    expect(status()).toHaveTextContent(text.failed)
    expect(status()).toHaveAttribute('data-tone', 'warning')
    expect(image()).toBeNull()
    expect(input()).toHaveValue(A)
    expect(onValue).toHaveBeenLastCalledWith(A)
  })

  it('warns about an http link on an https page and does not load it', () => {
    renderWithProviders(<Controlled origin={HTTPS_PAGE} />)
    paste('http://cdn.example.org/a.jpg')
    settle()
    expect(frame()).toHaveAttribute('data-state', 'mixed')
    expect(status()).toHaveTextContent(text.mixed)
    expect(status()).toHaveAttribute('data-tone', 'warning')
    expect(image()).toBeNull()
  })

  it('loads an http link on an http page without a warning', () => {
    renderWithProviders(<Controlled origin={HTTP_PAGE} />)
    paste('http://cdn.example.org/a.jpg')
    expect(image()).toHaveAttribute('src', 'http://cdn.example.org/a.jpg')
    expect(status()).not.toHaveAttribute('data-tone', 'warning')
  })

  it('never loads a value that fails the URL rule', () => {
    renderWithProviders(<Controlled />)
    for (const value of ['javascript:alert(1)', '/uploads/a.jpg', 'cdn.example.org/a.jpg']) {
      paste(value)
      settle()
      expect(image()).toBeNull()
      expect(frame()).toHaveAttribute('data-state', 'invalid')
    }
  })

  it('drops the picture at once when the link stops being valid', () => {
    renderWithProviders(<Controlled initial={A} />)
    fireEvent.load(image()!)
    type('https://')
    expect(image()).toBeNull()
    expect(frame()).toHaveAttribute('data-state', 'invalid')
  })

  it('clears the value and the preview, and keeps the keyboard in the field', () => {
    const onValue = vi.fn()
    renderWithProviders(<Controlled initial={A} onValue={onValue} />)
    fireEvent.load(image()!)

    fireEvent.click(screen.getByRole('button', { name: ar.courseCover.clear }))
    expect(onValue).toHaveBeenLastCalledWith('')
    expect(input()).toHaveValue('')
    expect(image()).toBeNull()
    expect(status()).toHaveTextContent(text.empty)
    expect(input()).toHaveFocus()
  })

  it('lets only the latest link decide when links change quickly', () => {
    renderWithProviders(<Controlled />)
    paste(A)
    const older = image()!
    paste(B)
    const newer = image()!
    expect(newer).not.toBe(older)
    expect(newer).toHaveAttribute('src', B)

    // The first link answers late, with a failure and then a success: neither is about B.
    fireEvent.error(older)
    expect(frame()).toHaveAttribute('data-state', 'loading')
    fireEvent.load(older)
    expect(frame()).toHaveAttribute('data-state', 'loading')

    fireEvent.load(newer)
    expect(frame()).toHaveAttribute('data-state', 'loaded')
    expect(image()).toHaveAttribute('src', B)
  })

  it('keeps the older picture during the delay without claiming a result for the new link', () => {
    renderWithProviders(<Controlled initial={A} />)
    fireEvent.load(image()!)
    expect(frame()).toHaveAttribute('data-state', 'loaded')

    type(B)
    expect(frame()).toHaveAttribute('data-state', 'loading')
    expect(status()).toHaveTextContent(text.loading)
    expect(image()).toHaveAttribute('src', A)
    expect(image()).toHaveAttribute('data-outcome', 'loaded')

    settle()
    expect(image()).toHaveAttribute('src', B)
    expect(image()).toHaveAttribute('data-outcome', 'loading')
    expect(frame()).toHaveAttribute('data-state', 'loading')
  })

  it('does not report or retry an older failure during the delay', () => {
    renderWithProviders(<Controlled initial={A} />)
    fireEvent.error(image()!)
    expect(status()).toHaveTextContent(text.failed)

    type(B)
    expect(frame()).toHaveAttribute('data-state', 'loading')
    expect(status()).toHaveTextContent(text.loading)
    expect(image()).toBeNull()
  })

  it('asks for one load when typing stops, not one per keystroke', () => {
    renderWithProviders(<Controlled />)
    type('https://cdn.example.org/a')
    act(() => vi.advanceTimersByTime(COVER_PREVIEW_DELAY_MS - 100))
    type(A)
    act(() => vi.advanceTimersByTime(COVER_PREVIEW_DELAY_MS - 100))
    expect(image()).toBeNull()
    act(() => vi.advanceTimersByTime(100))
    expect(image()).toHaveAttribute('src', A)
  })
})

describe('CourseCoverField inside a Form', () => {
  function CoverForm({ onFinish }: { onFinish: (values: { coverImageUrl?: string }) => void }) {
    return (
      <Form initialValues={{ coverImageUrl: A }} onFinish={onFinish}>
        <Form.Item
          name="coverImageUrl"
          label="الصورة"
          rules={[{ validator: (_, value: string | undefined) => (isCoverImageUrl(value) ? Promise.resolve() : Promise.reject(new Error('bad'))) }]}
        >
          <CourseCoverField origin={HTTP_PAGE} />
        </Form.Item>
        <Button htmlType="submit">send</Button>
      </Form>
    )
  }

  it('is reached by its label and saves a picture that failed to load', async () => {
    const onFinish = vi.fn()
    const { container } = renderWithProviders(<CoverForm onFinish={onFinish} />)
    expect(screen.getByLabelText('الصورة')).toHaveValue(A)

    fireEvent.error(within(frame()).getByRole('presentation', { hidden: true }))
    expect(status()).toHaveTextContent(text.failed)

    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith({ coverImageUrl: A }))
  })

  it('hands the form an empty string when cleared', async () => {
    const onFinish = vi.fn()
    const { container } = renderWithProviders(<CoverForm onFinish={onFinish} />)
    fireEvent.click(screen.getByRole('button', { name: ar.courseCover.clear }))
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith({ coverImageUrl: '' }))
  })
})
