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
// - 글꼴: 웹 글꼴 대신 책에 지정된 글꼴 목록 그대로(휴대폰에는 없으므로 Play 북 '원본'처럼 휴대폰 기본 글꼴로 그려짐)
// - 글자: 약 1.079배(15.2px에서 16.4px, 사용자 요청으로 18.4px, 17.4px를 거쳐 낮춤), 줄 사이는 38px 그대로(줄 간격 배수 x0.9268, 2.5에서 약 2.32)
// - 밝은 테마 글자색: 완전한 검정(Play 북 글자 픽셀의 약 3분의 2가 #000)
const PHONE = { scale: 1.079, lineFactor: 0.9268, serif: '"KoPub Batang", "Nanum Myeongjo", "Batang", serif', fg: '#000000' }

// 책 문서(iframe) 안에 넣는 CSS. 책 자체 CSS는 그대로 두고 필요한 것만 덮어쓴다.
const bookCSS = settingsNow => {
  const phone = layoutMode() === 'phone'
  const s = phone ? { ...settingsNow, fontSize: +(settingsNow.fontSize * PHONE.scale).toFixed(1), lineHeight: +(settingsNow.lineHeight * PHONE.lineFactor).toFixed(3) } : settingsNow
  const t = THEMES[s.theme] ?? THEMES.light
  const dark = s.theme === 'dark'
  const serif = s.font !== 'sans'
  const family = phone && serif ? PHONE.serif : (FONTS[s.font] ?? FONTS.serif)
  const fg = phone && s.theme === 'light' ? PHONE.fg : t.fg
  return `
${phone && serif ? '' : '@import url("https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&display=swap");'}
html { color-scheme: ${dark ? 'dark' : 'light'}; background: ${t.bg} !important; color: ${fg} !important; font-size: ${s.fontSize}% !important; }
body { font-family: ${family} !important; color: inherit !important; text-align: ${s.align === 'justify' ? 'justify' : 'left'} !important; }
body, p, .dialogue { line-height: ${s.lineHeight} !important; }
.gap { height: ${s.lineHeight}em !important; }
.gap-2 { height: ${s.lineHeight * 2}em !important; }
.gap-3 { height: ${s.lineHeight * 3}em !important; }
p { widows: ${layoutMode() === 'desk' ? 2 : 1}; orphans: ${layoutMode() === 'desk' ? 2 : 1}; }
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
const fitMargin = mode => {
  const base = parseFloat(LAYOUT[mode].margin)
  if (mode === 'desk' || settings.flow !== 'paginated') return base
  const pitch = linePitch()
  const height = $('#viewer').clientHeight || window.innerHeight
  // 줄 높이가 38.0007px처럼 소수점 아래로 조금 넘쳐도 한 줄을 잃지 않게 작은 여유를 둔다.
  const lines = Math.floor((height - 2 * base) / pitch + 0.01)
  if (!(pitch > 0) || lines < 4) return base
  return Math.floor((height - lines * pitch) / 2)
}
const fitPage = () => {
  const margin = `${fitMargin(layoutMode())}px`
  setAttr(view.renderer, 'margin', margin)
  document.documentElement.style.setProperty('--page-margin', margin)
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
