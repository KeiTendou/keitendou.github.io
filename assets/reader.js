// 리더: foliate-js로 EPUB을 열고 쪽 넘김, 목차, 보기 설정, 읽던 위치 저장을 처리한다.
import '../vendor/foliate-js/view.js'

const KEY_SETTINGS = 'kt-reader:settings:v2'
const KEY_SETTINGS_V1 = 'kt-reader:settings'
const keyPos = id => `kt-reader:pos:${id}`
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
  },
}

// 기본값은 구글 Play 북(글꼴 원본, 크기 100%, 행 간격 100%, 왼쪽 정렬)에서 잰 화면에 맞췄다(2026-10-04).
// Play 북은 같은 글자 크기에서 줄 사이가 글자 크기의 약 2.5배였다.
const DEFAULTS = { fontSize: 100, lineHeight: 2.5, align: 'left', theme: 'light', font: 'serif', flow: 'paginated', spread: 'auto' }
const loadSettings = () => {
  const saved = store.get(KEY_SETTINGS)
  if (saved) return saved
  // 예전 설정은 줄 간격만 새 기본값으로 바꾸고 나머지(배경, 글자 크기 등)는 이어 쓴다.
  const old = store.get(KEY_SETTINGS_V1) || {}
  delete old.lineHeight
  return old
}
const settings = { ...DEFAULTS, ...loadSettings() }

const $ = sel => document.querySelector(sel)
const page = document.body
const params = new URLSearchParams(location.search)
// 사이트 루트(assets/의 상위). 책별 공유 주소(/fall/ 등)에서 열려도 같은 파일을 찾게 한다.
const ROOT = new URL('../', import.meta.url)
const bookId = params.get('book') || document.body.dataset.book
// ?part=2처럼 열면 그 편(목차 항목)부터 시작한다.
const startPart = Number.parseInt(params.get('part') ?? '', 10)
const embedded = window.self !== window.top

const THEMES = {
  light: { bg: '#ffffff', fg: '#1f1f1f' },
  sepia: { bg: '#f4ecd8', fg: '#4a3b2c' },
  dark: { bg: '#1d1b20', fg: '#e4ded8' },
}
const FONTS = {
  serif: '"Noto Serif KR", "KoPub Batang", "Nanum Myeongjo", "Batang", serif',
  sans: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
}
// 휴대폰: 갤럭시 Play 북 앱 캡처(1080x2340, 2026-10-04) 실측에 맞춘다.
// - 글꼴: Noto Serif KR 굵기 540(사용자가 비교 주소 500, 550, 600을 보고 정함). Play 북 획 두께는 굵기 550~600에 가까웠다(글자 높이 대비 0.101).
//   휴대폰 기본 글꼴(sans-serif, system-ui), 마루 부리, 리디바탕은 비교에서 더 멀었다.
// - 글자: 약 1.105배(15.2px에서 16.8px, 사용자 요청으로 18.4px, 17.4px, 16.4px, 16.6px를 거쳐 정함), 줄 사이는 38px 그대로(줄 간격 배수 x0.9049, 2.5에서 약 2.26)
// - 밝은 테마 글자색: 완전한 검정(Play 북 글자 픽셀의 약 3분의 2가 #000)
const PHONE = { scale: 1.1053, lineFactor: 0.9049, weight: 540, fg: '#000000' }

// 책 문서(iframe) 안에 넣는 CSS. 책 자체 CSS는 그대로 두고 필요한 것만 덮어쓴다.
const bookCSS = settingsNow => {
  const phone = layoutMode() === 'phone'
  const s = phone ? { ...settingsNow, fontSize: +(settingsNow.fontSize * PHONE.scale).toFixed(1), lineHeight: +(settingsNow.lineHeight * PHONE.lineFactor).toFixed(3) } : settingsNow
  const t = THEMES[s.theme] ?? THEMES.light
  const dark = s.theme === 'dark'
  const serif = s.font !== 'sans'
  const weight = phone && serif ? PHONE.weight : null
  const fg = phone && s.theme === 'light' ? PHONE.fg : t.fg
  return `
@import url("https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@${weight && weight % 100 ? '400..700' : '400;500;600'}&display=swap");
html { color-scheme: ${dark ? 'dark' : 'light'}; background: ${t.bg} !important; color: ${fg} !important; font-size: ${s.fontSize}% !important; }
body { font-family: ${FONTS[s.font] ?? FONTS.serif} !important; color: inherit !important; text-align: ${s.align === 'justify' ? 'justify' : 'left'} !important; }
${weight ? `body { font-weight: ${weight} !important; }` : ''}
${phone && phoneLine.pitch ? `body, p, .dialogue { line-height: ${phoneLine.pitch}px !important; }
.gap { height: ${phoneLine.pitch}px !important; }
.gap-2 { height: ${phoneLine.pitch * 2}px !important; }
.gap-3 { height: ${phoneLine.pitch * 3}px !important; }` : `body, p, .dialogue { line-height: ${s.lineHeight} !important; }
.gap { height: ${s.lineHeight}em !important; }
.gap-2 { height: ${s.lineHeight * 2}em !important; }
.gap-3 { height: ${s.lineHeight * 3}em !important; }`}
p { widows: ${layoutMode() === 'desk' ? 2 : 1}; orphans: ${layoutMode() === 'desk' ? 2 : 1}; }
.illustration-cont { text-indent: 0 !important; }
.illustration { box-sizing: border-box; height: calc(100vh - 2px); display: flex; flex-direction: column; justify-content: center; align-items: center; }
.illustration img { max-width: 100%; max-height: calc(100vh - 2px); width: auto; height: auto; }
${embedded ? 'html { touch-action: pan-y pinch-zoom; }' : ''}
${dark ? `
.cover h1, .author, .toc a, a { color: #d9b8df !important; }
.edition, .original-title { color: #b49cb8 !important; }
.ornament { color: #c39bc0 !important; }
.cover-card { border-color: #5d4b61 !important; }
.author-note { color: #b5aea7 !important; }` : ''}
${s.theme === 'sepia' ? '.author-note { color: #6f5f4d !important; }' : ''}
`
}

let view
let book
let chromeTimer
let saveTimer

// 화면 종류. desk: 넓은 화면에서 직접 연 경우(Play 북 PC처럼 위아래 막대를 늘 보임),
// phone: 휴대폰 등 좁은 화면(Play 북 앱처럼 글만 보이고 가운데를 누르면 막대가 나옴), embed: 블로그 글 안.
const layoutMode = () => {
  const w = window.innerWidth
  const h = window.innerHeight
  if (embedded) return w < 600 ? 'phone' : 'embed'
  return w >= 900 && h >= 560 ? 'desk' : 'phone'
}
const chromeFixed = () => page.classList.contains('chrome-fixed')

const setChrome = visible => {
  page.classList.toggle('chrome-hidden', !visible && !chromeFixed())
  clearTimeout(chromeTimer)
}
const toggleChrome = () => setChrome(page.classList.contains('chrome-hidden'))

const anySheetOpen = () => !$('#toc-sheet').hidden || !$('#settings-sheet').hidden
const closeSheets = () => {
  $('#toc-sheet').hidden = true
  $('#settings-sheet').hidden = true
  $('#backdrop').hidden = true
}
const openSheet = id => {
  closeSheets()
  $(id).hidden = false
  $('#backdrop').hidden = false
}

const applyStyles = () => {
  document.documentElement.dataset.theme = settings.theme
  view?.renderer.setStyles?.(bookCSS(settings))
  if (view) fitPage()
}
// 쪽 여백. Play 북 PC 화면은 한 쪽 글 너비 약 600px, 두 쪽 사이 약 100px, 위아래 막대 아래 넉넉한 여백이었다.
// foliate의 좌우 여백은 화면 폭 x gap(바깥 여백과 단 안쪽 여백의 합)이다. 휴대폰은 7%로 390px 폭에서 약 27px씩.
const LAYOUT = {
  desk: { margin: '96px', gap: '7%' },
  embed: { margin: '40px', gap: '9%' },
  phone: { margin: '28px', gap: '7%' },
}
const setAttr = (el, name, value) => {
  if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name) }
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value)
}
// 한 줄 높이(px). 책 문서가 열려 있으면 실제 계산값, 아니면 설정에서 계산한다.
const linePitch = () => {
  const doc = view?.renderer?.getContents?.()?.[0]?.doc
  const lh = doc?.body ? parseFloat(doc.defaultView.getComputedStyle(doc.body).lineHeight) : NaN
  const phone = layoutMode() === 'phone'
  return lh > 0 ? lh : 16 * 0.95 * (settings.fontSize / 100) * settings.lineHeight * (phone ? PHONE.scale * PHONE.lineFactor : 1)
}
// 휴대폰과 블로그 글 안: 글 영역 높이를 한 줄 높이의 배수로 맞추고 남는 공간을 위아래에 똑같이 나눈다.
// (예전에는 남는 공간이 모두 아래로 가서 휴대폰에서 글이 위아래로 눌린 듯 보였다. 2026-10-04)
// 휴대폰: 위아래 여백을 줄인 만큼 한 쪽에 줄을 더 넣는다(2026-10-04 사용자 요청 "한줄이라도 더 넣으려고").
// - 위는 8px, 아래는 쪽 번호와 겹치지 않을 만큼(26px)만 비운다. 그래도 남는 공간은 아래(쪽 번호 쪽)로 간다.
// - 기본 줄 사이(보통 38px)로 n줄이 들어가는 화면에서, 줄 사이를 최대 6.5% 좁혀 n+1줄이 들어가면 그렇게 한다.
// - foliate의 margin은 위아래가 같으므로, 글 영역을 그대로 두고 리더 전체를 위로 올려 위를 줄이고 아래를 늘린다.
const PHONE_EDGE = { top: 8, bottom: 26, minPitchRatio: 0.935 }
let phoneLine = { pitch: 0, lines: 0 }
const phoneBasePitch = () => {
  const doc = view?.renderer?.getContents?.()?.[0]?.doc
  const fontPx = doc?.body ? parseFloat(doc.defaultView.getComputedStyle(doc.body).fontSize) : NaN
  const ratio = settings.lineHeight * PHONE.lineFactor
  return (fontPx > 0 ? fontPx : 16 * 0.95 * (settings.fontSize / 100) * PHONE.scale) * ratio
}
const phoneLayout = height => {
  const base = phoneBasePitch()
  const avail = height - PHONE_EDGE.top - PHONE_EDGE.bottom
  let lines = Math.floor(avail / base + 0.01)
  if (avail / (lines + 1) >= base * PHONE_EDGE.minPitchRatio) lines += 1
  const pitch = Math.min(base, Math.floor((avail / lines) * 100) / 100)
  return { pitch, lines }
}
const fitMargin = mode => {
  const base = parseFloat(LAYOUT[mode].margin)
  if (mode === 'desk' || settings.flow !== 'paginated') return { margin: base, shift: 0 }
  const height = window.innerHeight
  if (mode === 'phone') {
    const { pitch, lines } = phoneLine
    if (!(pitch > 0) || lines < 4) return { margin: base, shift: 0 }
    const margin = Math.floor((height - lines * pitch) / 2)
    return { margin, shift: Math.max(0, margin - PHONE_EDGE.top) }
  }
  const pitch = linePitch()
  // 줄 높이가 38.0007px처럼 소수점 아래로 조금 넘쳐도 한 줄을 잃지 않게 작은 여유를 둔다.
  const lines = Math.floor((height - 2 * base) / pitch + 0.01)
  if (!(pitch > 0) || lines < 4) return { margin: base, shift: 0 }
  return { margin: Math.floor((height - lines * pitch) / 2), shift: 0 }
}
const fitPage = () => {
  if (layoutMode() === 'phone' && settings.flow === 'paginated') {
    const next = phoneLayout(window.innerHeight)
    if (next.lines !== phoneLine.lines || Math.abs(next.pitch - phoneLine.pitch) > 0.009) {
      phoneLine = next
      view.renderer.setStyles?.(bookCSS(settings))
    }
  } else if (phoneLine.pitch) {
    phoneLine = { pitch: 0, lines: 0 }
    view.renderer.setStyles?.(bookCSS(settings))
  }
  const { margin, shift } = fitMargin(layoutMode())
  setAttr(view.renderer, 'margin', `${margin}px`)
  document.documentElement.style.setProperty('--page-margin', `${margin}px`)
  const viewer = $('#viewer')
  viewer.style.top = shift ? `${-shift}px` : ''
  viewer.style.bottom = shift ? `${shift}px` : ''
  scheduleIllustrations()
}

// 한 쪽 전체를 쓰는 삽화(figure.illustration, 앞뒤에서 쪽을 나눔, 쪽 가운데에 놓음). 2026-10-04
// EPUB에는 정해진 행 뒤에 들어 있지만, 그 자리에서 쪽을 강제로 나누면 화면에 따라 앞쪽이 덜 찬 채 끝난다. 그래서 화면마다
// 1) 정해진 행의 앞 2문단~뒤 7문단 중 문단 끝이 쪽 끝과 거의 맞는(빈칸이 한 줄 미만) 자리가 있으면 그 문단 뒤로 옮긴다.
//    여러 곳이면 빈칸과 거리(문단 하나에 줄 높이의 0.3배)를 더한 값이 작은 곳.
// 2) 없으면(긴 문단이 쪽 경계에 걸린 경우) 종이책 전면 삽화처럼, 쪽이 끝나는 줄에서 문단을 둘로 나누고 그 사이에 넣는다.
//    정해진 행에 가장 가까운 경계를 쓰고, 낱말 가운데서는 나누지 않는다. 나눈 뒤쪽은 들여쓰기 없이 이어지고, 다시 계산할 때는 먼저 원래 한 문단으로 합친다.
//    (처음에는 1번만 했으나, 휴대폰 줄 수를 늘린 뒤 갤럭시 크기 등에서 2~4줄이 비어 2번을 더했다.)
const ILLUSTRATION_RANGE = { before: 2, after: 7, distanceWeight: 0.3, cleanBlankLines: 1 }
const SPLIT_CLASS = 'illustration-cont'
const unsplitIllustrations = doc => {
  for (const cont of doc.querySelectorAll(`p.${SPLIT_CLASS}`)) {
    const head = doc.getElementById(cont.dataset.splitOf)
    if (head) { head.append(...cont.childNodes); head.normalize() }
    cont.remove()
  }
}
const placeIllustrations = doc => {
  const figures = [...doc.querySelectorAll('figure.illustration')]
  if (!figures.length || settings.flow !== 'paginated') return false
  const html = doc.documentElement
  const win = doc.defaultView
  const st = win.getComputedStyle(html)
  const pitch = parseFloat(st.columnWidth) + parseFloat(st.columnGap)
  const columnHeight = html.clientHeight
  const lineHeight = parseFloat(win.getComputedStyle(doc.body).lineHeight) || 38
  if (!(pitch > 0) || !(columnHeight > 0)) return false
  let moved = false
  for (const figure of figures) {
    if (!figure.dataset.anchor) figure.dataset.anchor = figure.previousElementSibling?.id ?? ''
    const anchor = doc.getElementById(figure.dataset.anchor)
    if (!anchor) continue
    const before = figure.dataset.sig ?? ''
    unsplitIllustrations(doc)
    const paragraphs = [...anchor.parentElement.children].filter(e => e.matches('p[id]'))
    const at = paragraphs.indexOf(anchor)
    // 그림을 잠시 빼고 글이 원래 어떻게 쪽에 놓이는지 잰다.
    figure.style.display = 'none'
    const box = html.getBoundingClientRect()
    const padLeft = parseFloat(st.paddingLeft) || 0
    const columnOf = x => Math.floor((x - box.left - padLeft + 1) / pitch)
    const info = []
    for (let i = Math.max(0, at - ILLUSTRATION_RANGE.before); i <= Math.min(paragraphs.length - 1, at + ILLUSTRATION_RANGE.after); i++) {
      const range = doc.createRange()
      range.selectNodeContents(paragraphs[i])
      const lines = [...range.getClientRects()].filter(r => r.width > 0)
      if (!lines.length) continue
      const first = lines[0], last = lines[lines.length - 1]
      info.push({ i, blank: Math.max(0, columnHeight - (last.bottom - box.top)), startCol: columnOf(first.left), endCol: columnOf(last.left) })
    }
    let target = anchor, splitAt = -1
    const clean = info.filter(c => c.blank < lineHeight * ILLUSTRATION_RANGE.cleanBlankLines)
      .map(c => ({ ...c, cost: c.blank + Math.abs(c.i - at) * lineHeight * ILLUSTRATION_RANGE.distanceWeight }))
      .sort((a, b) => a.cost - b.cost)[0]
    if (clean) target = paragraphs[clean.i]
    else {
      const straddle = info.filter(c => c.endCol > c.startCol).sort((a, b) => Math.abs(a.i - at) - Math.abs(b.i - at))[0]
      const text = straddle && paragraphs[straddle.i].firstChild
      if (straddle && text?.nodeType === 3 && paragraphs[straddle.i].childNodes.length === 1) {
        // 다음 쪽(단)에 놓이는 첫 글자를 찾는다(글자 순서대로 단 번호가 커지므로 이분 탐색).
        const charCol = k => { const r = doc.createRange(); r.setStart(text, k); r.setEnd(text, k + 1); return columnOf(r.getBoundingClientRect().left) }
        let lo = 0, hi = text.length - 1
        while (lo < hi) { const mid = (lo + hi) >> 1; if (charCol(mid) > straddle.startCol) hi = mid; else lo = mid + 1 }
        // 낱말이 쪼개지지 않게, 다음 쪽 첫 글자가 낱말 중간이면 그 낱말의 처음(앞 띄어쓰기 바로 뒤)으로 물러난다.
        let k = lo
        while (k > 0 && !/\s/.test(text.data[k - 1])) k--
        if (k === 0) k = lo
        if (lo > 0 && charCol(lo) > straddle.startCol) { target = paragraphs[straddle.i]; splitAt = k }
      }
      if (splitAt < 0 && info.length) {
        const any = info.map(c => ({ ...c, cost: c.blank + Math.abs(c.i - at) * lineHeight * ILLUSTRATION_RANGE.distanceWeight })).sort((a, b) => a.cost - b.cost)[0]
        target = paragraphs[any.i]
      }
    }
    figure.style.display = ''
    if (splitAt > 0) {
      const cont = doc.createElement('p')
      cont.className = [SPLIT_CLASS, ...target.classList].join(' ')
      cont.dataset.splitOf = target.id
      cont.append(target.firstChild.splitText(splitAt))
      target.after(cont)
    }
    target.after(figure)
    figure.dataset.placedAfter = target.id + (splitAt > 0 ? `@${splitAt}` : '')
    figure.dataset.sig = figure.dataset.placedAfter
    if (figure.dataset.sig !== before) moved = true
  }
  return moved
}
let illustrationTimer
const scheduleIllustrations = () => {
  clearTimeout(illustrationTimer)
  illustrationTimer = setTimeout(() => {
    for (const { doc } of view?.renderer?.getContents?.() ?? []) {
      if (doc && placeIllustrations(doc)) view.renderer.render?.()
    }
  }, 250)
}
let lastMode = null
const applyLayout = () => {
  if (!view) return
  const mode = layoutMode()
  const fixed = mode === 'desk' && settings.flow === 'paginated'
  page.dataset.layout = mode
  page.classList.toggle('chrome-fixed', fixed)
  if (fixed) page.classList.remove('chrome-hidden')
  const r = view.renderer
  setAttr(r, 'flow', settings.flow)
  setAttr(r, 'max-column-count', settings.spread === 'single' ? '1' : '2')
  setAttr(r, 'max-inline-size', '700px')
  setAttr(r, 'gap', LAYOUT[mode].gap)
  setAttr(r, 'animated', settings.flow === 'paginated' ? '' : null)
  // 화면 종류가 바뀌면 문단 나눔 규칙도 바뀌므로 책 CSS를 다시 넣는다(그 안에서 여백도 맞춤).
  if (mode !== lastMode) { lastMode = mode; applyStyles() }
  else fitPage()
  requestAnimationFrame(updateSpine)
}

// 한 화면에 보이는 단 수(넓은 화면 2쪽 펼침이면 2)
const columnCount = () => {
  const r = view?.renderer
  const doc = r?.getContents?.()?.[0]?.doc
  if (!doc || settings.flow !== 'paginated' || !r.size) return 1
  const st = doc.defaultView.getComputedStyle(doc.documentElement)
  const unit = parseFloat(st.columnWidth) + parseFloat(st.columnGap)
  return unit > 0 ? Math.max(1, Math.round(r.size / unit)) : 1
}
// 두 쪽 펼침일 때 가운데에 Play 북처럼 옅은 접힘 그림자를 둔다.
const updateSpine = () => {
  $('#spine').hidden = !(view && columnCount() === 2)
}
const saveSettings = () => store.set(KEY_SETTINGS, settings)

const percent = f => `${Math.max(0, Math.min(100, Math.round((f ?? 0) * 100)))}%`

// 편 안에서의 쪽 번호. 한 단을 한 쪽으로 센다(두 쪽 펼침이면 "11–12 / 40").
const pageInfo = () => {
  const r = view.renderer
  if (settings.flow !== 'paginated' || !(r.pages > 2)) return null
  const cols = columnCount()
  const screens = r.pages - 2
  const screen = Math.min(Math.max(r.page, 1), screens)
  const total = screens * cols
  const first = (screen - 1) * cols + 1
  return { first, last: first + cols - 1, total }
}
const pageText = info => !info ? '' : info.last > info.first
  ? `${info.first}–${info.last} / ${info.total}`
  : `${info.first} / ${info.total}`

const onRelocate = e => {
  const { fraction, tocItem, cfi } = e.detail
  const part = tocItem ? view.book.toc.findIndex(t => t.href === tocItem.href) + 1 : 0
  const info = part > 0 ? pageInfo() : null
  $('#slider').value = String(fraction ?? 0)
  $('#loc-title').textContent = part > 0 ? `${part}편 「${tocItem.label.trim()}」` : book.title
  $('#loc-page').textContent = info ? pageText(info) : percent(fraction)
  $('#peek').textContent = info ? `${info.first} / ${info.total}` : ''
  updateSpine()
  for (const b of document.querySelectorAll('#toc-list button'))
    b.setAttribute('aria-current', String(!!tocItem && b.dataset.href === tocItem.href))
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => store.set(keyPos(book.id), { cfi, fraction, updated: Date.now() }), 300)
}

// 화면 왼쪽 30% 이전 쪽, 오른쪽 30% 다음 쪽, 가운데는 메뉴 표시
const handleTap = (clientX, target) => {
  if (anySheetOpen()) return closeSheets()
  if (target?.closest?.('a[href]')) return
  const w = window.innerWidth
  if (clientX < w * 0.3) view.goLeft()
  else if (clientX > w * 0.7) view.goRight()
  else toggleChrome()
}

const onKey = e => {
  if (e.key === 'Escape') return closeSheets()
  if (anySheetOpen()) return
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); view.goLeft() }
  else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); view.goRight() }
}

// 터치 보정. foliate보다 먼저(capture) 받아서 필요한 경우 foliate에 전달하지 않는다.
// 1) 톡 누르기: foliate가 touchend 때 현재 쪽으로 되돌리는 snap을 하면서 탭으로 넘긴 쪽을 취소하는 경우가 있어,
//    거의 움직이지 않은 터치의 touchend는 foliate에 넘기지 않는다.
// 2) 블로그 글 안(iframe)에서는 세로로 미는 동작을 바깥 페이지 스크롤에 넘긴다. foliate는 쪽 넘김 모드에서
//    모든 touchmove를 막으므로, 방향이 정해질 때까지와 세로로 정해진 뒤에는 전달을 멈춘다. 가로면 foliate에 맡긴다.
const guardTouches = target => {
  let start = null
  let vertical = null
  let moved = false
  target.addEventListener('touchstart', e => {
    const t = e.touches[0]
    start = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null
    vertical = null
    moved = false
  }, { capture: true, passive: true })
  target.addEventListener('touchmove', e => {
    if (!start || e.touches.length > 1) return
    const t = e.touches[0]
    const dx = Math.abs(t.clientX - start.x)
    const dy = Math.abs(t.clientY - start.y)
    if (dx >= 8 || dy >= 8) moved = true
    if (!embedded) return
    if (vertical === null) {
      if (!moved) return e.stopImmediatePropagation()
      vertical = dy > dx
    }
    if (vertical) e.stopImmediatePropagation()
  }, { capture: true, passive: true })
  target.addEventListener('touchend', e => {
    if (start && (!moved || vertical)) e.stopImmediatePropagation()
    start = null
  }, { capture: true, passive: true })
}

const onLoadSection = e => {
  const { doc } = e.detail
  requestAnimationFrame(fitPage)
  doc.fonts?.ready?.then(scheduleIllustrations)
  guardTouches(doc)
  doc.addEventListener('keydown', onKey)
  doc.addEventListener('click', ev => {
    const sel = doc.getSelection?.()
    if (sel && !sel.isCollapsed) return
    const frame = doc.defaultView?.frameElement
    const x = (frame ? frame.getBoundingClientRect().left : 0) + ev.clientX
    handleTap(x, ev.target)
  })
}

const buildTOC = () => {
  const list = $('#toc-list')
  list.replaceChildren()
  const add = (items, depth = 0) => {
    for (const item of items ?? []) {
      const li = document.createElement('li')
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = item.label?.trim() ?? ''
      btn.dataset.href = item.href
      btn.style.paddingLeft = `${10 + depth * 16}px`
      btn.addEventListener('click', () => { closeSheets(); view.goTo(item.href) })
      li.append(btn)
      list.append(li)
      add(item.subitems, depth + 1)
    }
  }
  add(view.book.toc)
  const meta = $('#toc-meta')
  meta.replaceChildren()
  const line = document.createElement('div')
  line.textContent = `${book.originalTitle} / ${book.author}`
  line.lang = 'ja'
  meta.append(line)
  for (const s of book.sources ?? []) {
    const a = document.createElement('a')
    a.href = s.url
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = `${s.label} ↗`
    const row = document.createElement('div')
    row.append(a)
    meta.append(row)
  }
}

const seg = (label, key, options) => {
  const row = document.createElement('div')
  row.className = 'setting'
  const name = document.createElement('div')
  name.className = 'setting-label'
  name.textContent = label
  const group = document.createElement('div')
  group.className = 'seg'
  for (const [value, text, cls] of options) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    if (cls) b.classList.add(cls)
    b.setAttribute('aria-pressed', String(settings[key] === value))
    b.addEventListener('click', () => {
      settings[key] = value
      for (const x of group.children) x.setAttribute('aria-pressed', String(x === b))
      saveSettings()
      if (key === 'flow' || key === 'spread') applyLayout()
      else applyStyles()
    })
    group.append(b)
  }
  row.append(name, group)
  return row
}

const buildSettings = () => {
  const body = $('#settings-body')
  const sizeRow = document.createElement('div')
  sizeRow.className = 'setting'
  const sizeLabel = document.createElement('div')
  sizeLabel.className = 'setting-label'
  sizeLabel.textContent = '글자 크기'
  const stepper = document.createElement('div')
  stepper.className = 'stepper'
  const minus = document.createElement('button')
  const plus = document.createElement('button')
  const out = document.createElement('output')
  minus.type = plus.type = 'button'
  minus.textContent = '가−'
  plus.textContent = '가+'
  minus.setAttribute('aria-label', '글자 작게')
  plus.setAttribute('aria-label', '글자 크게')
  const showSize = () => { out.textContent = `${settings.fontSize}%` }
  const step = d => {
    settings.fontSize = Math.max(70, Math.min(180, settings.fontSize + d))
    showSize(); saveSettings(); applyStyles()
  }
  minus.addEventListener('click', () => step(-10))
  plus.addEventListener('click', () => step(10))
  showSize()
  stepper.append(minus, out, plus)
  sizeRow.append(sizeLabel, stepper)

  body.append(
    sizeRow,
    seg('줄 간격', 'lineHeight', [[1.8, '좁게'], [2.5, '보통'], [2.9, '넓게']]),
    seg('정렬', 'align', [['left', '왼쪽 맞춤'], ['justify', '양쪽 맞춤']]),
    seg('배경', 'theme', [['light', '밝게', 'swatch-light'], ['sepia', '세피아', 'swatch-sepia'], ['dark', '어둡게', 'swatch-dark']]),
    seg('글꼴', 'font', [['serif', '명조'], ['sans', '고딕']]),
    seg('넘김', 'flow', [['paginated', '쪽 넘김'], ['scrolled', '스크롤']]),
    seg('펼침', 'spread', [['auto', '넓은 화면 2쪽'], ['single', '항상 1쪽']]),
  )
}

const showError = msg => {
  $('#loading').remove()
  const box = document.createElement('div')
  box.className = 'reader-error'
  box.innerHTML = ''
  const p = document.createElement('p')
  p.textContent = msg
  const a = document.createElement('a')
  a.href = new URL('index.html', ROOT).href
  a.textContent = '서재로 돌아가기'
  box.append(p, a)
  document.body.append(box)
}

const main = async () => {
  document.documentElement.dataset.theme = settings.theme
  if (embedded) {
    const nt = $('#btn-newtab')
    nt.hidden = false
    nt.href = location.href
  }
  let books
  try {
    books = await (await fetch(new URL('books.json', ROOT), { cache: 'no-cache' })).json()
  } catch {
    return showError('책 목록을 불러오지 못했습니다.')
  }
  book = books.find(b => b.id === bookId)
  if (!book) return showError('찾는 책이 없습니다.')
  document.title = `${book.title} - 번역 서재`
  $('#title').textContent = book.title

  view = document.createElement('foliate-view')
  $('#viewer').append(view)
  guardTouches(view)
  view.addEventListener('load', onLoadSection)
  view.addEventListener('relocate', onRelocate)
  view.addEventListener('click', e => handleTap(e.clientX, e.target))
  try {
    await view.open(new URL(book.file, ROOT).href)
  } catch (e) {
    console.error(e)
    return showError('책 파일을 열지 못했습니다.')
  }
  applyLayout()
  applyStyles()
  buildTOC()
  buildSettings()

  const saved = store.get(keyPos(book.id))
  const partHref = startPart > 0 ? view.book.toc?.[startPart - 1]?.href : null
  try {
    if (partHref) await view.init({ lastLocation: partHref })
    else await view.init({ lastLocation: saved?.cfi ?? null })
  } catch (e) {
    console.warn('저장 위치로 이동 실패, 처음부터 엽니다.', e)
    await view.init({})
    if (typeof saved?.fraction === 'number') await view.goToFraction(saved.fraction)
  }
  $('#loading').remove()
  window.readerReady = true

  // 처음에는 메뉴를 잠깐 보여 주고 숨긴다(넓은 화면에서는 계속 보임)
  setChrome(true)
  chromeTimer = setTimeout(() => setChrome(false), 2500)

  let resizeTimer
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(applyLayout, 150)
  })
  // 전체 화면(Play 북 상단의 전체 화면 단추). 지원하지 않는 브라우저(아이폰 사파리 등)에서는 숨긴다.
  if (document.fullscreenEnabled) {
    const fs = $('#btn-fullscreen')
    fs.hidden = false
    fs.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen?.()
      else document.documentElement.requestFullscreen?.().catch(() => {})
    })
    document.addEventListener('fullscreenchange', () => {
      fs.setAttribute('aria-label', document.fullscreenElement ? '전체 화면 끝내기' : '전체 화면')
    })
  }

  $('#btn-prev').addEventListener('click', () => view.goLeft())
  $('#btn-next').addEventListener('click', () => view.goRight())
  $('#slider').addEventListener('change', e => view.goToFraction(parseFloat(e.target.value)))
  $('#btn-toc').addEventListener('click', () => openSheet('#toc-sheet'))
  $('#btn-settings').addEventListener('click', () => openSheet('#settings-sheet'))
  $('#backdrop').addEventListener('click', closeSheets)
  document.addEventListener('keydown', onKey)
}

main()
window.readerDebug = { get view() { return view }, settings }
