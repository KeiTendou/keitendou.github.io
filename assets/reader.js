// 리더: foliate-js로 EPUB을 열고 쪽 넘김, 목차, 보기 설정, 읽던 위치 저장을 처리한다.
import '../vendor/foliate-js/view.js'

const KEY_SETTINGS = 'kt-reader:settings'
const keyPos = id => `kt-reader:pos:${id}`
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
  },
}

const DEFAULTS = { fontSize: 100, lineHeight: 1.8, theme: 'light', font: 'serif', flow: 'paginated', spread: 'auto' }
const settings = { ...DEFAULTS, ...(store.get(KEY_SETTINGS) || {}) }

const $ = sel => document.querySelector(sel)
const page = document.body
const params = new URLSearchParams(location.search)
const bookId = params.get('book')
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

// 책 문서(iframe) 안에 넣는 CSS. 책 자체 CSS는 그대로 두고 필요한 것만 덮어쓴다.
const bookCSS = s => {
  const t = THEMES[s.theme] ?? THEMES.light
  const dark = s.theme === 'dark'
  return `
@import url("https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&display=swap");
html { color-scheme: ${dark ? 'dark' : 'light'}; background: ${t.bg} !important; color: ${t.fg} !important; font-size: ${s.fontSize}% !important; }
body { font-family: ${FONTS[s.font] ?? FONTS.serif} !important; color: inherit !important; }
body, p, .dialogue { line-height: ${s.lineHeight} !important; }
p { widows: 2; orphans: 2; }
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

const setChrome = visible => {
  page.classList.toggle('chrome-hidden', !visible)
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
}
const applyLayout = () => {
  if (!view) return
  const r = view.renderer
  r.setAttribute('flow', settings.flow)
  r.setAttribute('max-column-count', settings.spread === 'single' ? '1' : '2')
  r.setAttribute('max-inline-size', '660px')
  r.setAttribute('margin', embedded ? '40px' : '48px')
  r.setAttribute('gap', embedded ? '9%' : '6%')
  if (settings.flow === 'paginated') r.setAttribute('animated', '')
  else r.removeAttribute('animated')
}
const saveSettings = () => store.set(KEY_SETTINGS, settings)

const percent = f => `${Math.max(0, Math.min(100, Math.round((f ?? 0) * 100)))}%`

const onRelocate = e => {
  const { fraction, tocItem, cfi } = e.detail
  $('#slider').value = String(fraction ?? 0)
  $('#loc-title').textContent = tocItem?.label?.trim() || book.title
  $('#loc-pct').textContent = percent(fraction)
  $('#peek').textContent = percent(fraction)
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
    seg('줄 간격', 'lineHeight', [[1.6, '좁게'], [1.8, '보통'], [2.05, '넓게']]),
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
  a.href = 'index.html'
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
    books = await (await fetch('books.json', { cache: 'no-cache' })).json()
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
    await view.open(book.file)
  } catch (e) {
    console.error(e)
    return showError('책 파일을 열지 못했습니다.')
  }
  applyLayout()
  applyStyles()
  buildTOC()
  buildSettings()

  const saved = store.get(keyPos(book.id))
  try {
    await view.init({ lastLocation: saved?.cfi ?? null })
  } catch (e) {
    console.warn('저장 위치로 이동 실패, 처음부터 엽니다.', e)
    await view.init({})
    if (typeof saved?.fraction === 'number') await view.goToFraction(saved.fraction)
  }
  $('#loading').remove()
  window.readerReady = true

  // 처음에는 메뉴를 잠깐 보여 주고 숨긴다
  setChrome(true)
  chromeTimer = setTimeout(() => setChrome(false), 2500)

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
