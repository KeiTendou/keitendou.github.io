// 서재: books.json을 읽어 책 카드를 그린다.
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
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

const renderBook = book => {
  const href = book.share ? book.share : `reader.html?book=${encodeURIComponent(book.id)}`
  const saved = store.get(`kt-reader:pos:${book.id}`)
  const started = saved && typeof saved.fraction === 'number' && saved.fraction > 0.005

  const cover = el('a', { class: 'cover', href, style: `--book-accent:${book.accent || '#6d4c72'}`, 'aria-label': `${book.title} 읽기` },
    el('span', { class: 'cover-title' }, book.title),
    el('span', { class: 'cover-author', lang: 'ja' }, book.author))

  const meta = el('p', { class: 'book-meta' },
    el('span', { lang: 'ja' }, book.originalTitle), ' / ',
    el('span', { lang: 'ja' }, book.author),
    book.edition ? ` / ${book.edition}` : null)

  const parts = book.parts?.length > 1
    ? el('ol', { class: 'book-parts' }, ...book.parts.map(p => el('li', {}, p)))
    : null

  const sources = book.sources?.length
    ? el('div', { class: 'book-sources' }, ...book.sources.map(s =>
        el('a', { href: s.url, target: '_blank', rel: 'noopener' }, `${s.label} ↗`)))
    : null

  const actions = el('div', { class: 'book-actions' },
    el('a', { class: 'btn-read', href }, started ? '이어 읽기' : '읽기'),
    started ? el('span', { class: 'progress-note' }, `${percent(saved.fraction)} 읽음`) : null)

  const track = started
    ? el('div', { class: 'progress-track', 'aria-hidden': 'true' }, el('span', { style: `width:${percent(saved.fraction)}` }))
    : null

  return el('li', { class: 'book' }, cover,
    el('div', { class: 'book-info' },
      el('h2', {}, book.title), meta,
      book.description ? el('p', { class: 'book-desc' }, book.description) : null,
      parts, sources, track, actions))
}

const main = async () => {
  const list = document.getElementById('books')
  try {
    const res = await fetch('books.json', { cache: 'no-cache' })
    const books = await res.json()
    if (!books.length) document.getElementById('empty').hidden = false
    list.append(...books.map(renderBook))
  } catch (e) {
    list.append(el('li', {}, '책 목록을 불러오지 못했습니다.'))
    console.error(e)
  }
}
main()
