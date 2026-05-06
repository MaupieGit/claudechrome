import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

const HEALTH_URL = 'http://127.0.0.1:7681/health'
const WS_BASE = 'ws://127.0.0.1:7681/terminal'
const RECONNECT_MS = 2000
const HEALTH_TIMEOUT_MS = 1000
const SCROLLBACK_LINES = 100000
const FONT_SIZE_KEY = 'claudechrome-font-size'
const DEFAULT_FONT_SIZE = 14
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 32

const container = document.getElementById('terminal-container')!
const statusText = document.getElementById('status-text')!
const sessionDialog = document.getElementById('session-dialog')!
const dialogMessage = document.getElementById('dialog-message')!
const btnResume = document.getElementById('btn-resume')!
const btnNewSession = document.getElementById('btn-new-session')!
const searchBar = document.getElementById('search-bar')!
const searchInput = document.getElementById('search-input') as HTMLInputElement
const searchResults = document.getElementById('search-results')!
const searchPrev = document.getElementById('search-prev')!
const searchNext = document.getElementById('search-next')!
const searchClose = document.getElementById('search-close')!

const sessionId = new URLSearchParams(window.location.search).get('session') || crypto.randomUUID()
const WS_URL = `${WS_BASE}?session=${sessionId}`

let fontSize = DEFAULT_FONT_SIZE
try {
  const stored = localStorage.getItem(FONT_SIZE_KEY)
  if (stored) {
    const n = parseInt(stored, 10)
    if (n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE) fontSize = n
  }
} catch {}

const term = new Terminal({
  cursorBlink: true,
  fontSize,
  fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
  scrollback: SCROLLBACK_LINES,
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    selection: 'rgba(204, 204, 204, 0.3)',
  },
})

const fitAddon = new FitAddon()
const searchAddon = new SearchAddon()
const webLinksAddon = new WebLinksAddon()
term.loadAddon(fitAddon)
term.loadAddon(searchAddon)
term.loadAddon(webLinksAddon)
term.open(container)

let currentWs: WebSocket | null = null
let dialogVisible = false
let searchVisible = false

function sendResize(ws: WebSocket): void {
  const dims = fitAddon.proposeDimensions()
  if (!dims) return
  const msg = JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows })
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(msg)
  }
}

const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit()
  if (currentWs?.readyState === WebSocket.OPEN) {
    sendResize(currentWs)
  }
})
resizeObserver.observe(container)

function notifyParent(msg: unknown): void {
  try {
    window.parent.postMessage(msg, '*')
  } catch {}
}

function setStatus(msg: string, color = '#007acc'): void {
  statusText.textContent = msg
  const bar = document.getElementById('status-bar')!
  if (bar) bar.style.background = color
}

function setConnectionState(state: 'connecting' | 'connected' | 'disconnected'): void {
  notifyParent({ type: 'connection', state })
}

function showSessionDialog(mode: 'alive' | 'ended'): void {
  if (mode === 'alive') {
    dialogMessage.textContent = 'A shell session is running in this tab.'
    btnResume.style.display = ''
  } else {
    dialogMessage.textContent = 'Shell session ended.'
    btnResume.style.display = 'none'
  }
  sessionDialog.classList.add('visible')
  dialogVisible = true
}

function hideSessionDialog(): void {
  sessionDialog.classList.remove('visible')
  dialogVisible = false
}

btnResume.addEventListener('click', () => hideSessionDialog())

btnNewSession.addEventListener('click', () => {
  hideSessionDialog()
  term.reset()
  if (currentWs?.readyState === WebSocket.OPEN) {
    currentWs.send(JSON.stringify({ type: 'new-session' }))
  }
})

function showSearchBar(): void {
  searchBar.classList.add('visible')
  searchVisible = true
  searchInput.focus()
  searchInput.select()
}

function hideSearchBar(): void {
  searchBar.classList.remove('visible')
  searchVisible = false
  searchAddon.clearDecorations()
  term.focus()
}

const searchOptions = {
  decorations: {
    matchBackground: '#515c6a',
    activeMatchBackground: '#a96f00',
    matchOverviewRuler: '#a96f00',
    activeMatchColorOverviewRuler: '#a96f00',
  },
}

function runSearch(direction: 'next' | 'prev'): void {
  const q = searchInput.value
  if (!q) {
    searchAddon.clearDecorations()
    searchResults.textContent = ''
    return
  }
  const fn = direction === 'next' ? searchAddon.findNext : searchAddon.findPrevious
  fn.call(searchAddon, q, searchOptions)
}

searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
  if (resultCount === 0) {
    searchResults.textContent = '0/0'
  } else {
    searchResults.textContent = `${resultIndex + 1}/${resultCount}`
  }
})

searchInput.addEventListener('input', () => runSearch('next'))
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    runSearch(e.shiftKey ? 'prev' : 'next')
  } else if (e.key === 'Escape') {
    e.preventDefault()
    hideSearchBar()
  }
})
searchPrev.addEventListener('click', () => runSearch('prev'))
searchNext.addEventListener('click', () => runSearch('next'))
searchClose.addEventListener('click', () => hideSearchBar())

function setFontSize(n: number): void {
  fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, n))
  term.options.fontSize = fontSize
  fitAddon.fit()
  if (currentWs?.readyState === WebSocket.OPEN) sendResize(currentWs)
  try { localStorage.setItem(FONT_SIZE_KEY, String(fontSize)) } catch {}
}

term.onSelectionChange(() => {
  const sel = term.getSelection()
  if (!sel) return
  navigator.clipboard.writeText(sel).catch(() => {})
})

term.onBell(() => {
  notifyParent({ type: 'bell' })
})

term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
  if (e.type !== 'keydown') return true

  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      showSearchBar()
      return false
    }
    if (!e.shiftKey && (e.key === '=' || e.key === '+')) {
      setFontSize(fontSize + 1)
      return false
    }
    if (!e.shiftKey && e.key === '-') {
      setFontSize(fontSize - 1)
      return false
    }
    if (!e.shiftKey && e.key === '0') {
      setFontSize(DEFAULT_FONT_SIZE)
      return false
    }
    if (!e.shiftKey && e.key === '`') {
      notifyParent({ type: 'toggle-panel' })
      return false
    }
  }

  return true
})

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && dialogVisible) {
    hideSessionDialog()
    e.preventDefault()
  }
})

window.addEventListener('message', (e: MessageEvent) => {
  if (e.data?.type === 'kill-session') {
    hideSessionDialog()
    if (currentWs?.readyState === WebSocket.OPEN) {
      currentWs.send(JSON.stringify({ type: 'kill-session' }))
    }
  } else if (e.data?.type === 'ssh-command') {
    const target = String(e.data.target || '').trim()
    if (!target) return
    if (currentWs?.readyState !== WebSocket.OPEN) return
    currentWs.send(textEncoder.encode(`ssh ${target}\r`))
  } else if (e.data?.type === 'clear-terminal') {
    term.clear()
  } else if (e.data?.type === 'open-search') {
    showSearchBar()
  }
})

async function isHostReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS)
    const res = await fetch(HEALTH_URL, { signal: ctrl.signal })
    clearTimeout(tid)
    return res.ok
  } catch {
    return false
  }
}

function connect(): void {
  setStatus('Connecting to host...', '#555')
  setConnectionState('connecting')

  const ws = new WebSocket(WS_URL)
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    currentWs = ws
    setStatus('Connected', '#007acc')
    setConnectionState('connected')
    fitAddon.fit()
    sendResize(ws)
  }

  ws.onmessage = (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(event.data))
    } else if (typeof event.data === 'string') {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'session-status') {
          if (msg.status === 'alive') {
            showSessionDialog('alive')
          }
        } else if (msg.type === 'shell-exited') {
          showSessionDialog('ended')
        }
      } catch {}
    }
  }

  ws.onerror = () => {}

  ws.onclose = () => {
    currentWs = null
    hideSessionDialog()
    setStatus('Host disconnected — retrying...', '#c0392b')
    setConnectionState('disconnected')
    setTimeout(scheduleReconnect, RECONNECT_MS)
  }
}

async function scheduleReconnect(): Promise<void> {
  const reachable = await isHostReachable()
  if (reachable) {
    connect()
  } else {
    setStatus(`Host not running — start claudechrome-host.exe (retrying in ${RECONNECT_MS / 1000}s)`, '#c0392b')
    setTimeout(scheduleReconnect, RECONNECT_MS)
  }
}

const textEncoder = new TextEncoder()

term.onData((data: string) => {
  if (dialogVisible) return
  if (currentWs?.readyState !== WebSocket.OPEN) return
  currentWs.send(textEncoder.encode(data))
})

connect()
