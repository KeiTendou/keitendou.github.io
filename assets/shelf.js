// 서재: books.json을 읽어 책장을 그린다(표지 격자와 목록, 정렬, 진행률로 거르기).
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
  },
}

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue
    if (k === 'class') node.className = v
    else if (k === 'style') node.style.cssText = v
    else node.setAttribute(k, v)
  }
  for (const c of children) if (c != null) node.append(c)
  return node
}

const percent = f => `${Math.max(0, Math.min(100, Math.round(f * 100)))}%`

// 읽던 위치는 리더가 이 기기의 브라우저에 적어 둔 값이다.
const progressOf = book => {
  const saved = store.get(`kt-reader:pos:${book.id}`)
  const fraction = typeof saved?.fraction === 'number' ? saved.fraction : 0
  return {
    fraction,
    at: typeof saved?.updated === 'number' ? saved.updated : 0,
    started: fraction > 0.005,
    done: fraction >= 0.995,
  }
}

const collator = new Intl.Collator('ko')
const byText = (a, b) => (!a - !b) || collator.compare(a || '', b || '')
const sorters = {
  added: (a, b) => (b.book.updated || '').localeCompare(a.book.updated || '') || a.i - b.i,
  read: (a, b) => b.p.at - a.p.at || sorters.added(a, b),
  title: (a, b) => byText(a.book.title, b.book.title) || a.i - b.i,
  author: (a, b) => byText(a.book.author, b.book.author) || sorters.title(a, b),
}
const filters = {
  all: () => true,
  reading: p => p.started && !p.done,
  unread: p => !p.started,
  done: p => p.done,
}

const PREFS_KEY = 'kt-shelf:prefs:v1'
const prefs = { sort: 'added', filter: 'all', view: 'grid' }
{
  const saved = store.get(PREFS_KEY) || {}
  if (saved.sort in sorters) prefs.sort = saved.sort
  if (saved.filter in filters) prefs.filter = saved.filter
  if (saved.view === 'list') prefs.view = 'list'
}

const renderBook = ({ book, p }) => {
  const href = book.share ? book.share : `reader.html?book=${encodeURIComponent(book.id)}`
  const length = [...book.title].length

  // 표지는 전자책 표지와 같은 구성이다(제목, 짧은 줄, 작가). 제목이 길면 글자를 줄인다.
  const cover = el('span', { class: 'cover', style: `--book-accent:${book.accent || '#6d4c72'}`, 'data-len': length > 24 ? 'l' : length > 12 ? 'm' : null, 'aria-hidden': 'true' },
    el('span', { class: 'cover-title' }, book.title),
    book.author ? el('span', { class: 'cover-rule' }) : null,
    book.author ? el('span', { class: 'cover-author', lang: 'ja' }, book.author) : null,
    p.started ? el('span', { class: 'cover-progress' }, el('span', { style: `width:${percent(p.fraction)}` })) : null)

  return el('li', { class: 'book' },
    el('a', { class: 'book-link', href },
      cover,
      el('span', { class: 'book-title' }, book.title),
      el('span', { class: 'book-orig', lang: 'ja' }, book.originalTitle || ''),
      el('span', { class: 'book-author', lang: 'ja' }, book.author || ''),
      el('span', { class: 'book-note' }, p.started ? percent(p.fraction) : '')))
}

const main = async () => {
  const list = document.getElementById('books')
  const empty = document.getElementById('empty')
  const sort = document.getElementById('sort')
  const filter = document.getElementById('filter')
  const view = document.getElementById('view')
  let books
  try {
    books = await (await fetch('books.json', { cache: 'no-cache' })).json()
  } catch (e) {
    list.append(el('li', {}, '책 목록을 불러오지 못했습니다.'))
    console.error(e)
    return
  }

  const draw = () => {
    const shown = books
      .map((book, i) => ({ book, i, p: progressOf(book) }))
      .filter(item => filters[prefs.filter](item.p))
      .sort(sorters[prefs.sort])
    list.replaceChildren(...shown.map(renderBook))
    list.classList.toggle('as-list', prefs.view === 'list')
    empty.hidden = shown.length > 0
    empty.textContent = books.length ? '해당하는 책이 없습니다.' : '아직 올라온 책이 없습니다.'
    sort.value = prefs.sort
    filter.value = prefs.filter
    filter.parentElement.classList.toggle('chip-on', prefs.filter !== 'all')
    const asList = prefs.view === 'list'
    view.setAttribute('aria-label', asList ? '표지로 보기' : '목록으로 보기')
    view.querySelector('.icon-list').toggleAttribute('hidden', asList)
    view.querySelector('.icon-grid').toggleAttribute('hidden', !asList)
  }
  const change = patch => { Object.assign(prefs, patch); store.set(PREFS_KEY, prefs); draw() }
  sort.addEventListener('change', () => change({ sort: sort.value }))
  filter.addEventListener('change', () => change({ filter: filter.value }))
  view.addEventListener('click', () => change({ view: prefs.view === 'list' ? 'grid' : 'list' }))
  // 리더에서 뒤로 돌아오면 진행률을 다시 읽는다.
  addEventListener('pageshow', e => { if (e.persisted) draw() })
  draw()
}
main()
