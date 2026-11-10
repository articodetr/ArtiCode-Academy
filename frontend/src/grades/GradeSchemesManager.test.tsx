import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { GradeScheme } from '../api/gradeSchemes'
import { ar } from '../i18n/ar'
import { GRADE_SCHEME_IDS, GRADE_SCHEME_MANAGER_PERMISSIONS, makeGradeScheme, THREE_GRADE_SCHEMES } from '../test/gradeSchemes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { GradeSchemesManager } from './GradeSchemesManager'

interface Call {
  method: string
  url: string
  body: unknown
}

/** GET serves `state.current` (re-read on every call); writes answer with `writes(method, url, body)`. */
function mockSchemesApi(initial: GradeScheme[], writes: (method: string, url: string, body: unknown) => Response) {
  const state = { current: initial }
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (method === 'GET') return jsonResponse(200, { items: state.current })
    return writes(method, url, body)
  })
  return { calls, state }
}

/** The tab is management-only (the route, the nav entry and SettingsPage gate it on academy.settings.manage), so it renders for a holder of the key. */
function renderManager() {
  renderWithProviders(<GradeSchemesManager />, { auth: makeAuth({ user: makeUser({ permissions: GRADE_SCHEME_MANAGER_PERMISSIONS }) }), route: '/settings/grade-schemes' })
}

const DEFAULT_NAME = 'السلّم الافتراضي'
const PASS_FAIL = 'ناجح أو راسب'
const OLD = 'السلّم القديم'

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

const namesOf = (rows: HTMLElement[]) => rows.map((row) => within(row).getByText(new RegExp(`^(${DEFAULT_NAME}|${PASS_FAIL}|${OLD}|سلّم المشاريع)$`)).textContent)
const writesOf = (calls: Call[]) => calls.filter((call) => call.method !== 'GET')
const getsOf = (calls: Call[]) => calls.filter((call) => call.method === 'GET')
const button = (container: HTMLElement, text: string) => within(container).getByText(text).closest('button')!

async function findDialog(title: string) {
  return (await screen.findByText(title)).closest('[role="dialog"]') as HTMLElement
}

async function confirmPopup(title: string, okText: string) {
  const popup = (await screen.findByText(title)).closest('.ant-popover') as HTMLElement
  fireEvent.click(button(popup, okText))
}

/** Escape as the browser sends it: the modal listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
/** A click on the area around the modal (rc-dialog closes only when the press started there too). */
function clickMask() {
  const wrap = document.querySelector<HTMLElement>('.ant-modal-wrap')!
  fireEvent.mouseDown(wrap)
  fireEvent.click(wrap)
}

const bandCards = (dialog: HTMLElement) => within(dialog).getAllByTestId('grade-band-editor')

/** The form messages on screen — not those antd is animating away (their leave motion never ends in jsdom). */
const shownErrors = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.ant-form-item-explain-error:not(.ant-form-show-help-item-leave)')).map((element) => element.textContent)

describe('GradeSchemesManager (J-F44 — MOD-09-T08 part a, API-122..API-125)', () => {
  it('lists the schemes as the server orders them: the default tag, the bands from their minimum, the final-grade counts, the status, and the actions each row allows', async () => {
    mockSchemesApi(THREE_GRADE_SCHEMES(), () => jsonResponse(500, {}))
    renderManager()

    expect(await screen.findByText(PASS_FAIL)).toBeInTheDocument()
    const rows = bodyRows()
    expect(namesOf(rows)).toEqual([DEFAULT_NAME, PASS_FAIL, OLD])
    expect(within(rows[0]!).getByText(ar.gradeSchemes.default)).toBeInTheDocument()
    expect(within(rows[1]!).queryByText(ar.gradeSchemes.default)).not.toBeInTheDocument()
    expect(screen.getByText(ar.gradeSchemes.hint)).toBeInTheDocument()
    // The bands as the server sends them (ascending): label, letter and minimum; pass or fail in colour, icon and title.
    const defaultBands = within(rows[0]!).getAllByTestId('grade-band')
    expect(defaultBands.map((tag) => tag.textContent)).toEqual(['راسب (F) ≥ 0%', 'مقبول (D) ≥ 60%', 'جيد (C) ≥ 70%', 'جيد جداً (B) ≥ 80%', 'ممتاز (A) ≥ 90%'])
    expect(defaultBands[0]).toHaveAttribute('title', ar.gradeSchemes.fail)
    expect(defaultBands[1]).toHaveAttribute('title', ar.gradeSchemes.pass)
    expect(within(rows[1]!).getAllByTestId('grade-band').map((tag) => tag.textContent)).toEqual(['لم ينجح ≥ 0%', 'نجح ≥ 50%'])
    expect(within(rows[2]!).getAllByTestId('grade-band').map((tag) => tag.textContent)).toEqual(['ضعيف (E) ≥ 0%', 'متوسط (C) ≥ 65.5%'])
    // The counts come from the server, and so does the state.
    expect(within(rows[0]!).getByText('12')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('0')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('3')).toBeInTheDocument()
    expect(within(rows[2]!).getByText(ar.labels.inactive)).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.labels.active)).toBeInTheDocument()
    // The default can neither be deactivated nor deleted, and has no «make default»; a used scheme cannot be deleted.
    expect(screen.getByLabelText(`${ar.gradeSchemes.actions.deactivate}: ${DEFAULT_NAME}`)).toBeDisabled()
    expect(screen.getByLabelText(`${ar.gradeSchemes.actions.delete}: ${DEFAULT_NAME}`)).toBeDisabled()
    expect(screen.queryByLabelText(`${ar.gradeSchemes.actions.setDefault}: ${DEFAULT_NAME}`)).not.toBeInTheDocument()
    expect(screen.getByLabelText(`${ar.gradeSchemes.actions.setDefault}: ${PASS_FAIL}`)).toBeEnabled()
    expect(screen.getByLabelText(`${ar.gradeSchemes.actions.deactivate}: ${PASS_FAIL}`)).toBeEnabled()
    expect(screen.getByLabelText(`${ar.gradeSchemes.actions.delete}: ${PASS_FAIL}`)).toBeEnabled()
    expect(screen.getByLabelText(`${ar.gradeSchemes.actions.activate}: ${OLD}`)).toBeEnabled()
    expect(screen.getByLabelText(`${ar.gradeSchemes.actions.setDefault}: ${OLD}`)).toBeEnabled()
    expect(screen.getByLabelText(`${ar.gradeSchemes.actions.delete}: ${OLD}`)).toBeDisabled()
  })

  it('shows the empty state, and a load failure with a retry that re-reads the list', async () => {
    let failures = 1
    const calls: string[] = []
    mockFetch((url) => {
      calls.push(url)
      if (failures > 0) {
        failures -= 1
        return jsonResponse(503, { statusCode: 503, message: 'down' })
      }
      return jsonResponse(200, { items: [] })
    })
    renderManager()

    expect(await screen.findByText(ar.gradeSchemes.loadFailed)).toBeInTheDocument()
    expect(screen.getByText(ar.login.errors.server)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.gradeSchemes.retry).closest('button')!)
    expect(await screen.findByText(ar.gradeSchemes.empty)).toBeInTheDocument()
    expect(screen.queryByText(ar.gradeSchemes.loadFailed)).not.toBeInTheDocument()
    expect(calls).toEqual(['/api/grade-schemes', '/api/grade-schemes'])
  })

  it('creates a scheme through the modal — labels filled in, a band added, made the default — with the bands sent ascending, then re-reads the list', async () => {
    const created = makeGradeScheme({ id: '0193c000-0000-7000-8000-00000000f009', name: { ar: 'سلّم المشاريع' }, finalGradeCount: 0 })
    const { calls, state } = mockSchemesApi(THREE_GRADE_SCHEMES(), () => jsonResponse(201, created))
    renderManager()
    await screen.findByText(PASS_FAIL)

    fireEvent.click(screen.getByText(ar.gradeSchemes.add).closest('button')!)
    const dialog = await findDialog(ar.gradeSchemes.createTitle)
    // An academy that has schemes chooses whether the new one becomes the default.
    expect(within(dialog).queryByText(ar.gradeSchemes.hints.firstScheme)).not.toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(ar.gradeSchemes.fields.nameAr), 'سلّم المشاريع')
    let cards = bandCards(dialog)
    expect(cards).toHaveLength(2)
    expect(within(cards[0]!).getByLabelText(ar.gradeSchemes.fields.minPercent)).toHaveValue('0')
    expect(within(cards[1]!).getByLabelText(ar.gradeSchemes.fields.minPercent)).toHaveValue('60')
    await userEvent.type(within(cards[0]!).getByLabelText(ar.gradeSchemes.fields.labelAr), 'غير مكتمل')
    await userEvent.type(within(cards[1]!).getByLabelText(ar.gradeSchemes.fields.labelAr), 'مكتمل')
    // A third band below the passing one: it fails by default, and it is typed last.
    fireEvent.click(button(dialog, ar.gradeSchemes.addBand))
    cards = bandCards(dialog)
    expect(cards).toHaveLength(3)
    await userEvent.type(within(cards[2]!).getByLabelText(ar.gradeSchemes.fields.minPercent), '40')
    await userEvent.type(within(cards[2]!).getByLabelText(ar.gradeSchemes.fields.labelAr), 'ضعيف')
    await userEvent.type(within(cards[2]!).getByLabelText(ar.gradeSchemes.fields.letter), ' E ')
    fireEvent.click(within(dialog).getByLabelText(ar.gradeSchemes.fields.isDefault))
    state.current = [created, ...THREE_GRADE_SCHEMES().map((scheme) => ({ ...scheme, isDefault: false }))]
    fireEvent.click(button(dialog, ar.gradeSchemes.create))

    expect(await screen.findByText('تم إنشاء السلّم «سلّم المشاريع»')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([
      {
        method: 'POST',
        url: '/api/grade-schemes',
        body: {
          name: { ar: 'سلّم المشاريع' },
          bands: [
            { minPercent: 0, label: { ar: 'غير مكتمل' }, isPass: false },
            { minPercent: 40, label: { ar: 'ضعيف' }, letter: 'E', isPass: false },
            { minPercent: 60, label: { ar: 'مكتمل' }, isPass: true },
          ],
          isDefault: true,
        },
      },
    ])
    // Every write is followed by a re-read: the server orders the list and demotes the previous default.
    await waitFor(() => expect(namesOf(bodyRows())).toEqual(['سلّم المشاريع', DEFAULT_NAME, PASS_FAIL, OLD]))
    expect(getsOf(calls)).toHaveLength(2)
  })

  it('announces the first scheme of the academy as the default (no switch, no isDefault), and shows a refusal the mirror missed above the form', async () => {
    let posts = 0
    const created = makeGradeScheme({ name: { ar: 'الأول' }, finalGradeCount: 0 })
    const { calls } = mockSchemesApi([], () => {
      posts += 1
      return posts === 1
        ? jsonResponse(400, { statusCode: 400, error: 'Bad Request', code: 'grade_scheme_invalid', message: 'bands', problems: ['no_zero_band'], duplicates: [] })
        : jsonResponse(201, created)
    })
    renderManager()
    await screen.findByText(ar.gradeSchemes.empty)

    fireEvent.click(screen.getByText(ar.gradeSchemes.add).closest('button')!)
    const dialog = await findDialog(ar.gradeSchemes.createTitle)
    expect(within(dialog).getByText(ar.gradeSchemes.hints.firstScheme)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(ar.gradeSchemes.fields.isDefault)).not.toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(ar.gradeSchemes.fields.nameAr), 'الأول')
    const cards = bandCards(dialog)
    await userEvent.type(within(cards[0]!).getByLabelText(ar.gradeSchemes.fields.labelAr), 'راسب')
    await userEvent.type(within(cards[1]!).getByLabelText(ar.gradeSchemes.fields.labelAr), 'ناجح')
    fireEvent.click(button(dialog, ar.gradeSchemes.create))

    expect(await within(dialog).findByText('رفض الخادم الشرائح: يجب أن تبدأ إحداها من 0.')).toBeInTheDocument()
    expect(writesOf(calls)[0]?.body).toEqual({
      name: { ar: 'الأول' },
      bands: [
        { minPercent: 0, label: { ar: 'راسب' }, isPass: false },
        { minPercent: 60, label: { ar: 'ناجح' }, isPass: true },
      ],
    })
    // The modal stays with the typed values; a second try goes through.
    expect(within(dialog).getByLabelText(ar.gradeSchemes.fields.nameAr)).toHaveValue('الأول')
    fireEvent.click(button(dialog, ar.gradeSchemes.create))
    expect(await screen.findByText('تم إنشاء السلّم «الأول»')).toBeInTheDocument()
    expect(writesOf(calls)).toHaveLength(2)
  })

  it('edits with the smallest PATCH — the name alone, then the whole band list — keeping the Turkish texts, and sends nothing when the form did not change', async () => {
    const schemes = THREE_GRADE_SCHEMES()
    const { calls } = mockSchemesApi(schemes, (_method, _url, body) => jsonResponse(200, { ...schemes[2]!, ...(body as object) }))
    renderManager()
    await screen.findByText(OLD)

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: ${OLD}`))
    let dialog = await findDialog(`تعديل السلّم «${OLD}»`)
    // Final grades fixed with the scheme keep their snapshot — the modal says so.
    expect(within(dialog).getByText('ثُبِّتت بهذا السلّم 3 درجة نهائية؛ تعديله لا يغيّرها — تبقى بشرائحها وقت التثبيت.')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(ar.gradeSchemes.fields.nameEn), 'Old scale')
    fireEvent.click(button(dialog, ar.common.save))
    expect(await screen.findByText(ar.gradeSchemes.saved)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', url: `/api/grade-schemes/${GRADE_SCHEME_IDS[2]}`, body: { name: { ar: OLD, en: 'Old scale', tr: 'Eski ölçek' } } }])

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: ${OLD}`))
    dialog = await findDialog(`تعديل السلّم «${OLD}»`)
    const label = within(bandCards(dialog)[1]!).getByLabelText(ar.gradeSchemes.fields.labelAr)
    await userEvent.clear(label)
    await userEvent.type(label, 'جيد')
    fireEvent.click(button(dialog, ar.common.save))
    await waitFor(() => expect(writesOf(calls)).toHaveLength(2))
    expect(writesOf(calls)[1]).toEqual({
      method: 'PATCH',
      url: `/api/grade-schemes/${GRADE_SCHEME_IDS[2]}`,
      body: {
        bands: [
          { minPercent: 0, label: { ar: 'ضعيف', tr: 'Zayıf' }, letter: 'E', isPass: false },
          { minPercent: 65.5, label: { ar: 'جيد', tr: 'Orta' }, letter: 'C', isPass: true },
        ],
      },
    })

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: ${DEFAULT_NAME}`))
    dialog = await findDialog(`تعديل السلّم «${DEFAULT_NAME}»`)
    fireEvent.click(button(dialog, ar.common.save))
    expect(await screen.findByText(ar.gradeSchemes.nothingChanged)).toBeInTheDocument()
    expect(writesOf(calls)).toHaveLength(2)
  })

  it('refuses the server’s band rules inside the modal before any request, and the messages follow the edits (mirror of grade_scheme_invalid)', async () => {
    const { calls } = mockSchemesApi(THREE_GRADE_SCHEMES(), () => jsonResponse(500, {}))
    renderManager()
    await screen.findByText(PASS_FAIL)

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: ${PASS_FAIL}`))
    const dialog = await findDialog(`تعديل السلّم «${PASS_FAIL}»`)
    const cards = bandCards(dialog)
    // Two bands is the minimum: neither can be removed.
    expect(within(cards[0]!).getByLabelText('حذف الشريحة 1')).toBeDisabled()
    // No band at 0 any more, and nothing passes.
    const first = within(cards[0]!).getByLabelText(ar.gradeSchemes.fields.minPercent)
    await userEvent.clear(first)
    await userEvent.type(first, '10')
    fireEvent.click(within(cards[1]!).getByRole('switch'))
    fireEvent.click(button(dialog, ar.common.save))
    await waitFor(() => expect(shownErrors(dialog)).toEqual([ar.gradeSchemes.validation.no_zero_band, ar.gradeSchemes.validation.no_passing_band]))

    // The rules follow each change.
    await userEvent.clear(first)
    await userEvent.type(first, '0')
    await waitFor(() => expect(shownErrors(dialog)).toEqual([ar.gradeSchemes.validation.no_passing_band]))
    fireEvent.click(within(cards[0]!).getByRole('switch'))
    await waitFor(() => expect(shownErrors(dialog)).toEqual([ar.gradeSchemes.validation.pass_not_ascending]))
    const second = within(cards[1]!).getByLabelText(ar.gradeSchemes.fields.minPercent)
    await userEvent.clear(second)
    await userEvent.type(second, '0')
    await waitFor(() => expect(shownErrors(dialog)).toEqual(['حدّ أدنى مكرر: 0 — لكل شريحة حدّ أدنى مختلف', ar.gradeSchemes.validation.pass_not_ascending]))
    // A minimum with three decimals is its field's message; the band rules wait for a valid one.
    await userEvent.clear(second)
    await userEvent.type(second, '50.125')
    fireEvent.click(button(dialog, ar.common.save))
    await waitFor(() => expect(shownErrors(dialog)).toEqual([ar.gradeSchemes.validation.minPercent]))
    expect(writesOf(calls)).toHaveLength(0)
  })

  it('makes a scheme the default after confirmation; an inactive one is activated in the same request, and the list is re-read after each', async () => {
    const { calls } = mockSchemesApi(THREE_GRADE_SCHEMES(), () => jsonResponse(200, makeGradeScheme()))
    renderManager()
    await screen.findByText(PASS_FAIL)

    fireEvent.click(screen.getByLabelText(`${ar.gradeSchemes.actions.setDefault}: ${PASS_FAIL}`))
    await confirmPopup(`جعل «${PASS_FAIL}» السلّم الافتراضي؟ يتوقف السلّم الافتراضي الحالي عن كونه افتراضياً.`, ar.gradeSchemes.actions.setDefault)
    expect(await screen.findByText(`صار «${PASS_FAIL}» السلّم الافتراضي`)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', url: `/api/grade-schemes/${GRADE_SCHEME_IDS[1]}`, body: { isDefault: true } }])

    fireEvent.click(screen.getByLabelText(`${ar.gradeSchemes.actions.setDefault}: ${OLD}`))
    await confirmPopup(`جعل «${OLD}» السلّم الافتراضي؟ سيُفعَّل في الطلب نفسه، ويتوقف السلّم الافتراضي الحالي عن كونه افتراضياً.`, ar.gradeSchemes.actions.setDefault)
    await waitFor(() => expect(writesOf(calls)).toHaveLength(2))
    expect(writesOf(calls)[1]).toEqual({ method: 'PATCH', url: `/api/grade-schemes/${GRADE_SCHEME_IDS[2]}`, body: { isDefault: true, isActive: true } })
    await waitFor(() => expect(getsOf(calls)).toHaveLength(3))
  })

  it('deactivates after confirmation and activates directly; a refusal is the server’s message, and the list is re-read', async () => {
    let patches = 0
    const { calls } = mockSchemesApi(THREE_GRADE_SCHEMES(), () => {
      patches += 1
      return patches < 3 ? jsonResponse(200, makeGradeScheme()) : jsonResponse(409, { statusCode: 409, code: 'grade_scheme_is_default', message: 'default', schemeId: GRADE_SCHEME_IDS[1], action: 'deactivate' })
    })
    renderManager()
    await screen.findByText(PASS_FAIL)

    fireEvent.click(screen.getByLabelText(`${ar.gradeSchemes.actions.deactivate}: ${PASS_FAIL}`))
    await confirmPopup(`إيقاف السلّم «${PASS_FAIL}»؟ لن يُختار لتثبيت الدرجات النهائية، والدرجات المثبَّتة به تبقى كما هي.`, ar.gradeSchemes.actions.deactivate)
    expect(await screen.findByText(`تم إيقاف السلّم «${PASS_FAIL}»`)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(`${ar.gradeSchemes.actions.activate}: ${OLD}`))
    expect(await screen.findByText(`تم تفعيل السلّم «${OLD}»`)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([
      { method: 'PATCH', url: `/api/grade-schemes/${GRADE_SCHEME_IDS[1]}`, body: { isActive: false } },
      { method: 'PATCH', url: `/api/grade-schemes/${GRADE_SCHEME_IDS[2]}`, body: { isActive: true } },
    ])

    // Made the default elsewhere meanwhile: the server refuses with its own reason.
    fireEvent.click(screen.getByLabelText(`${ar.gradeSchemes.actions.deactivate}: ${PASS_FAIL}`))
    await confirmPopup(`إيقاف السلّم «${PASS_FAIL}»؟ لن يُختار لتثبيت الدرجات النهائية، والدرجات المثبَّتة به تبقى كما هي.`, ar.gradeSchemes.actions.deactivate)
    expect(await screen.findByText(ar.gradeSchemes.errors.grade_scheme_is_default_deactivate)).toBeInTheDocument()
    await waitFor(() => expect(getsOf(calls)).toHaveLength(4))
  })

  it('deletes a scheme after confirmation; a scheme a final grade took meanwhile gets the server message with its count, and the list is re-read', async () => {
    let deletes = 0
    const { calls } = mockSchemesApi(THREE_GRADE_SCHEMES(), () => {
      deletes += 1
      return deletes === 1 ? jsonResponse(204) : jsonResponse(409, { statusCode: 409, code: 'grade_scheme_in_use', message: 'used', finalGradeCount: 1 })
    })
    renderManager()
    await screen.findByText(PASS_FAIL)

    fireEvent.click(screen.getByLabelText(`${ar.gradeSchemes.actions.delete}: ${PASS_FAIL}`))
    await confirmPopup(`حذف السلّم «${PASS_FAIL}» وشرائحه نهائياً؟`, ar.gradeSchemes.actions.delete)
    expect(await screen.findByText(`تم حذف السلّم «${PASS_FAIL}»`)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'DELETE', url: `/api/grade-schemes/${GRADE_SCHEME_IDS[1]}`, body: undefined }])

    // The re-read still lists it (the mock keeps it): a second delete meets a final grade fixed meanwhile.
    await waitFor(() => expect(getsOf(calls)).toHaveLength(2))
    fireEvent.click(screen.getByLabelText(`${ar.gradeSchemes.actions.delete}: ${PASS_FAIL}`))
    const popups = await screen.findAllByText(`حذف السلّم «${PASS_FAIL}» وشرائحه نهائياً؟`)
    fireEvent.click(button(popups[popups.length - 1]!.closest('.ant-popover') as HTMLElement, ar.gradeSchemes.actions.delete))
    expect(await screen.findByText('لا يُحذف هذا السلّم: ثُبِّتت به 1 درجة نهائية. أوقفه بدلاً من ذلك.')).toBeInTheDocument()
    await waitFor(() => expect(getsOf(calls)).toHaveLength(3))
  })

  it('closes an untouched modal on Escape and on a mask click; once a band is edited Escape and the mask keep it and its work — cancel still closes', async () => {
    const { calls } = mockSchemesApi(THREE_GRADE_SCHEMES(), () => jsonResponse(500, {}))
    renderManager()
    await screen.findByText(PASS_FAIL)
    const title = `تعديل السلّم «${PASS_FAIL}»`
    const open = async () => {
      fireEvent.click(screen.getByLabelText(`${ar.common.edit}: ${PASS_FAIL}`))
      return findDialog(title)
    }

    await open()
    pressEscape()
    await waitFor(() => expect(screen.queryByText(title)).not.toBeInTheDocument())
    await open()
    clickMask()
    await waitFor(() => expect(screen.queryByText(title)).not.toBeInTheDocument())

    const dialog = await open()
    const english = within(bandCards(dialog)[0]!).getByLabelText(ar.gradeSchemes.fields.labelEn)
    await userEvent.type(english, 'Not yet')
    pressEscape()
    clickMask()
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(english).toHaveValue('Not yet')
    fireEvent.click(button(dialog, ar.common.cancel))
    await waitFor(() => expect(screen.queryByText(title)).not.toBeInTheDocument())
    expect(writesOf(calls)).toHaveLength(0)
  })
})
