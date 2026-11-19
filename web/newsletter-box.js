// The IV Newsletter signup box for IV apps without React (source of truth: IVAI docs/newsletter/apps/newsletter-box.js).
// The same box, wording, classes and behaviour as NewsletterBox.jsx / NewsletterDialog.jsx, in plain DOM code, so apps
// whose pages are plain HTML (IV Now Playing) can use it under a strict CSP (script-src 'self'). Copy it unchanged and
// load newsletter-box.css next to it.
//
//   mountNewsletterBox(parent, api, { variant: 'settings' | 'card', title: true, onClose })
//   openNewsletterDialog(api)   -> a modal <dialog> with the box and Close (Escape also closes it)
//
// `api` is the preload's newsletter bridge ({status, join, closeCard, openPage}). Opt-in only: the field starts empty
// and nothing is sent until Join is clicked. The app keeps no address; the main process stores only the join date.

let uid = 0
const OFFLINE = { ok: false, offline: true, error: "Couldn't reach the signup service." }
const when = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return '' }
}
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') n.className = v
    else if (k === 'text') n.textContent = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else if (k in n && typeof v !== 'string') n[k] = v
    else n.setAttribute(k, v === true ? '' : v)
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c)
  return n
}

export function mountNewsletterBox(parent, api, { variant = 'settings', title = true, onClose } = {}) {
  const id = `ivnl${++uid}`
  const card = variant === 'card'
  const state = { status: null, email: '', phase: 'idle', error: null, again: false, closed: false }
  const root = el('section', { class: `ivnl ivnl-${variant}`, ...(title ? { 'aria-labelledby': `${id}-h` } : { 'aria-label': 'The IV Newsletter' }) })
  root.hidden = true
  parent.append(root)

  const submit = async (e) => {
    e.preventDefault()
    if (state.phase === 'sending') return
    state.error = null
    state.phase = 'sending'
    render()
    const r = await api.join({ email: state.email }).catch(() => OFFLINE)
    if (r.ok) {
      Object.assign(state, { phase: 'done', email: '', again: false })
      state.status = { ...state.status, joinedAt: r.joinedAt }
    } else {
      state.phase = 'idle'
      state.error = r
    }
    render(r.ok ? null : 'input')
  }
  const notNow = async () => { state.closed = true; render(); await api.closeCard().catch(() => {}); onClose?.() }
  const done = () => { state.closed = true; render(); onClose?.() }

  function render(focus) {
    const { status, phase, error } = state
    if (!api || !status || state.closed || (card && phase !== 'done' && (status.joinedAt || status.cardClosedAt))) {
      root.hidden = true
      root.replaceChildren()
      return
    }
    root.hidden = false
    const kids = []
    if (title) kids.push(el('h3', { id: `${id}-h`, class: 'ivnl-title', text: 'The IV Newsletter' }))
    kids.push(el('p', { class: 'ivnl-lead', text: "One email a week from Matt: what's new in the IV apps, how things are made, and free tools." }))
    if (phase === 'done') kids.push(el('p', { class: 'ivnl-done', role: 'status', text: "Check your inbox. Click the link in Kit's email to confirm." }))
    if (phase !== 'done' && status.joinedAt && !state.again) {
      kids.push(el('p', { class: 'ivnl-done', role: 'status' },
        `You joined on ${when(status.joinedAt)}. Not seeing the email? Check Promotions or spam. `,
        el('button', { type: 'button', class: 'ivnl-link', text: 'Use another address', onclick: () => { state.again = true; render('input') } })))
    }
    if (phase !== 'done' && (!status.joinedAt || state.again)) {
      const sending = phase === 'sending'
      const input = el('input', {
        id: `${id}-email`, class: 'ivnl-input', type: 'email', inputmode: 'email', autocomplete: 'email', spellcheck: 'false',
        placeholder: 'you@example.com', 'aria-invalid': error?.field === 'email' ? 'true' : undefined,
        'aria-describedby': error ? `${id}-err` : `${id}-small`, disabled: sending,
        oninput: (e) => {
          state.email = e.target.value
          if (state.error) {
            // Clear the error in place (re-drawing the field mid-typing would move the caret).
            state.error = null
            root.querySelector('.ivnl-error')?.remove()
            e.target.removeAttribute('aria-invalid')
            e.target.setAttribute('aria-describedby', `${id}-small`)
          }
        }
      })
      input.value = state.email
      kids.push(el('form', { class: 'ivnl-form', novalidate: true, onsubmit: submit },
        el('label', { for: `${id}-email`, class: 'ivnl-label', text: 'Your email' }),
        el('div', { class: 'ivnl-row' }, input,
          el('button', { type: 'submit', class: 'ivnl-join', disabled: sending, text: sending ? 'Joining…' : 'Join' })),
        error && el('p', { id: `${id}-err`, class: 'ivnl-error', role: 'alert' }, `${error.error} `,
          error.offline && el('button', { type: 'button', class: 'ivnl-link', text: 'Join on infinitevariance.ai instead', onclick: () => api.openPage() })),
        el('p', { id: `${id}-small`, class: 'ivnl-small', text: "Kit, our email service, sends you a confirm email first. Nothing arrives until you click it. Unsubscribe any time. This app doesn't keep your address." })))
    }
    if (card) {
      kids.push(el('div', { class: 'ivnl-card-actions' }, phase === 'done'
        ? el('button', { type: 'button', class: 'ivnl-secondary', text: 'Done', onclick: done })
        : el('button', { type: 'button', class: 'ivnl-secondary', text: 'Not now', onclick: notNow })))
    }
    root.replaceChildren(...kids)
    if (focus === 'input') {
      const i = root.querySelector('.ivnl-input')
      // Email fields don't allow setSelectionRange; setting the value again after focus puts the caret at the end.
      if (i) { const v = i.value; i.focus(); i.value = ''; i.value = v }
    }
  }

  api?.status().then((s) => { state.status = s; render() }).catch(() => { state.status = {}; render() })
  return { element: root, destroy: () => root.remove() }
}

// The box in a modal dialog, for apps without a settings page: open it from a small "Newsletter" button.
export function openNewsletterDialog(api) {
  const dialog = el('dialog', { class: 'ivnl-dialog', 'aria-label': 'The IV Newsletter' })
  const box = mountNewsletterBox(dialog, api)
  dialog.append(el('div', { class: 'ivnl-card-actions' },
    el('button', { type: 'button', class: 'ivnl-secondary', text: 'Close', onclick: () => dialog.close() })))
  dialog.addEventListener('close', () => { box.destroy(); dialog.remove() })
  document.body.append(dialog)
  dialog.showModal()
  return dialog
}
