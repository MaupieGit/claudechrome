import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const WS_URL = 'ws://127.0.0.1:7681/terminal'
const HEALTH_URL = 'http://127.0.0.1:7681/health'
const RECONNECT_MS = 2000
const HEALTH_TIMEOUT_MS = 1000

const container = document.getElementById('terminal-container')!
const statusText = document.getElementById('status-text')!

const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    selection: 'rgba(204, 204, 204, 0.3)',
  },
})

const fitAddon = new FitAddon()
term.loadAddon(fitAddon)
term.open(container)

let currentWs: WebSocket | null = null

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

function setStatus(msg: string, color = '#007acc'): void {
  statusText.textContent = msg
  const bar = document.getElementById('status-bar')!
  if (bar) {
    bar.style.background = color
  }
}

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

  const ws = new WebSocket(WS_URL)
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    currentWs = ws
    setStatus('Connected', '#007acc')
    fitAddon.fit()
    sendResize(ws)
  }

  ws.onmessage = (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(event.data))
    }
  }

  ws.onerror = () => {
    // Handled in onclose
  }

  ws.onclose = () => {
    currentWs = null
    setStatus('Host disconnected — retrying...', '#c0392b')
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
  if (currentWs?.readyState !== WebSocket.OPEN) return
  currentWs.send(textEncoder.encode(data))
})

scheduleReconnect()
