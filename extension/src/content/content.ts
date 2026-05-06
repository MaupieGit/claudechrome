// Dockable panel controller — injected into every page
// Manages panel visibility, dock position, and resize

interface PanelState {
  visible: boolean
  dock: 'right' | 'bottom'
  size: number
  minimized: boolean
}

const DEFAULT_STATE: PanelState = {
  visible: false,
  dock: 'right',
  size: 350,
  minimized: false,
}

let state: PanelState = { ...DEFAULT_STATE }
let hostDiv: HTMLElement | null = null
let panelDiv: HTMLElement | null = null
let resizeHandle: HTMLElement | null = null
let resizing = false
let resizeStartPos = 0
let resizeStartSize = 0
let maximized = false
let preMaximizeSize = DEFAULT_STATE.size
let tabSessionId = ''

async function loadState(): Promise<void> {
  const stored = await chrome.storage.local.get('claudechrome-panel-state')
  if (stored['claudechrome-panel-state']) {
    state = { ...DEFAULT_STATE, ...stored['claudechrome-panel-state'] }
  }
}

async function saveState(): Promise<void> {
  await chrome.storage.local.set({ 'claudechrome-panel-state': state })
}

function createPanelDOM(): void {
  if (document.getElementById('claudechrome-host')) {
    return // Already exists
  }

  // Create host div (fixed, full viewport, pointer-events none)
  hostDiv = document.createElement('div')
  hostDiv.id = 'claudechrome-host'
  hostDiv.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647;
  `

  // Create shadow root
  const shadowRoot = hostDiv.attachShadow({ mode: 'open' })

  // Style (scoped to shadow DOM)
  const style = document.createElement('style')
  style.textContent = `
    :host {
      --panel-bg: #1e1e1e;
      --panel-border: #3e3e42;
      --header-bg: #007acc;
      --header-text: #fff;
      --resize-handle: #555;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    #panel {
      position: fixed;
      display: flex;
      flex-direction: column;
      background: var(--panel-bg);
      border: 1px solid var(--panel-border);
      pointer-events: auto;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #d4d4d4;
    }

    #panel.dock-right {
      top: 0;
      right: 0;
      width: var(--panel-size);
      height: 100vh;
    }

    #panel.dock-bottom {
      bottom: 0;
      left: 0;
      width: 100vw;
      height: var(--panel-size);
    }

    #header {
      background: var(--header-bg);
      color: var(--header-text);
      padding: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      user-select: none;
      flex-shrink: 0;
      height: 32px;
      cursor: pointer;
    }

    #header-title {
      flex: 1;
      font-weight: 500;
    }

    button {
      background: transparent;
      border: none;
      color: var(--header-text);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 2px;
      font-size: 14px;
    }

    button:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    #resize-handle {
      position: absolute;
      background: var(--resize-handle);
      opacity: 0;
      transition: opacity 0.2s;
    }

    #panel.dock-right #resize-handle {
      left: 0;
      top: 0;
      width: 6px;
      height: 100%;
      cursor: ew-resize;
    }

    #panel.dock-bottom #resize-handle {
      top: 0;
      left: 0;
      width: 100%;
      height: 6px;
      cursor: ns-resize;
    }

    #panel:hover #resize-handle {
      opacity: 0.7;
    }

    #terminal-frame {
      flex: 1;
      border: none;
      background: #1e1e1e;
    }

    #panel.minimized #terminal-frame,
    #panel.minimized #resize-handle {
      display: none;
    }

    #panel.dock-right.minimized,
    #panel.dock-bottom.minimized {
      height: 32px;
    }

    #panel.maximized {
      top: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
    }

    #panel.maximized #resize-handle {
      display: none;
    }
  `
  shadowRoot.appendChild(style)

  // Panel div
  panelDiv = document.createElement('div')
  panelDiv.id = 'panel'
  panelDiv.className = state.dock === 'right' ? 'dock-right' : 'dock-bottom'
  panelDiv.style.setProperty('--panel-size', `${state.size}px`)

  // Header
  const header = document.createElement('div')
  header.id = 'header'

  const title = document.createElement('span')
  title.id = 'header-title'
  title.textContent = 'ClaudeChrome'
  header.appendChild(title)

  const btnSsh = document.createElement('button')
  btnSsh.id = 'btn-ssh'
  btnSsh.title = 'SSH to host in URL bar (shift-click to change username)'
  btnSsh.textContent = 'SSH'
  btnSsh.addEventListener('click', (e) => sshToCurrentHost(e.shiftKey))
  header.appendChild(btnSsh)

  const btnHardRefresh = document.createElement('button')
  btnHardRefresh.id = 'btn-hard-refresh'
  btnHardRefresh.title = 'Hard refresh (bypass cache)'
  btnHardRefresh.textContent = '⟳'
  btnHardRefresh.addEventListener('click', hardRefresh)
  header.appendChild(btnHardRefresh)

  const btnIncognito = document.createElement('button')
  btnIncognito.id = 'btn-incognito'
  btnIncognito.title = 'Open this page in an incognito window with the same shell session'
  btnIncognito.textContent = '⊞'
  btnIncognito.addEventListener('click', openInIncognito)
  header.appendChild(btnIncognito)

  const btnDockRight = document.createElement('button')
  btnDockRight.id = 'btn-dock-right'
  btnDockRight.title = 'Dock right'
  btnDockRight.textContent = '⊢'
  btnDockRight.addEventListener('click', () => setDock('right'))
  header.appendChild(btnDockRight)

  const btnDockBottom = document.createElement('button')
  btnDockBottom.id = 'btn-dock-bottom'
  btnDockBottom.title = 'Dock bottom'
  btnDockBottom.textContent = '⊥'
  btnDockBottom.addEventListener('click', () => setDock('bottom'))
  header.appendChild(btnDockBottom)

  const btnMinimize = document.createElement('button')
  btnMinimize.id = 'btn-minimize'
  btnMinimize.title = 'Minimize'
  btnMinimize.textContent = '−'
  btnMinimize.addEventListener('click', toggleMinimize)
  header.appendChild(btnMinimize)

  const btnClose = document.createElement('button')
  btnClose.id = 'btn-close'
  btnClose.title = 'Close'
  btnClose.textContent = '✕'
  btnClose.addEventListener('click', killAndClose)
  header.appendChild(btnClose)

  header.addEventListener('dblclick', (e: MouseEvent) => {
    if ((e.target as HTMLElement).tagName !== 'BUTTON') {
      toggleMaximize()
    }
  })

  panelDiv.appendChild(header)

  // Resize handle
  resizeHandle = document.createElement('div')
  resizeHandle.id = 'resize-handle'
  panelDiv.appendChild(resizeHandle)

  // iframe — session ID in URL so it survives page navigation (sessionStorage would be lost)
  const panelUrl = chrome.runtime.getURL('src/panel/panel.html') + '?session=' + tabSessionId
  const iframe = document.createElement('iframe')
  iframe.id = 'terminal-frame'
  iframe.src = panelUrl
  iframe.sandbox.add('allow-scripts', 'allow-same-origin')
  panelDiv.appendChild(iframe)

  shadowRoot.appendChild(panelDiv)
  document.documentElement.appendChild(hostDiv)

  // Attach resize listeners
  resizeHandle.addEventListener('mousedown', onResizeStart)
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)

  updateVisibility()
}

function setDock(dock: 'right' | 'bottom'): void {
  state.dock = dock
  if (panelDiv) {
    panelDiv.classList.remove('dock-right', 'dock-bottom')
    panelDiv.classList.add(dock === 'right' ? 'dock-right' : 'dock-bottom')
  }
  saveState()
}

function toggle(): void {
  state.visible = !state.visible
  updateVisibility()
  saveState()
}

function killAndClose(): void {
  // Tell iframe to send kill-session to the server before we hide
  const iframe = panelDiv?.querySelector('#terminal-frame') as HTMLIFrameElement | null
  iframe?.contentWindow?.postMessage({ type: 'kill-session' }, '*')
  state.visible = false
  updateVisibility()
  saveState()
}

const SSH_USERNAME_KEY = 'claudechrome-ssh-username'

async function sshToCurrentHost(forceReprompt: boolean): Promise<void> {
  const host = window.location.hostname
  if (!host) return

  let username = ''
  if (!forceReprompt) {
    const stored = await chrome.storage.local.get(SSH_USERNAME_KEY)
    username = stored[SSH_USERNAME_KEY] || ''
  }

  if (!username) {
    const stored = await chrome.storage.local.get(SSH_USERNAME_KEY)
    const entered = window.prompt(`SSH username for ${host} (leave blank to connect without one):`, stored[SSH_USERNAME_KEY] || '')
    if (entered === null) return  // user cancelled
    username = entered.trim()
    await chrome.storage.local.set({ [SSH_USERNAME_KEY]: username })
  }

  if (!state.visible) {
    state.visible = true
    updateVisibility()
    saveState()
  }

  const target = username ? `${username}@${host}` : host
  const iframe = panelDiv?.querySelector('#terminal-frame') as HTMLIFrameElement | null
  iframe?.contentWindow?.postMessage({ type: 'ssh-command', target }, '*')
}

// chrome.runtime can throw synchronously after the extension is reloaded.
// Returns null on any failure so callers can decide what to do.
async function safeSendMessage<T = any>(msg: unknown): Promise<T | null> {
  try {
    return await chrome.runtime.sendMessage(msg)
  } catch {
    return null
  }
}

function notifyExtensionReloaded(): void {
  window.alert('ClaudeChrome was reloaded. Refresh this page (F5) and try again.')
}

async function hardRefresh(): Promise<void> {
  if (!chrome.runtime?.id) {
    notifyExtensionReloaded()
    return
  }
  await safeSendMessage({ type: 'hard-refresh' })
}

async function openInIncognito(): Promise<void> {
  if (!tabSessionId) return
  if (!chrome.runtime?.id) {
    notifyExtensionReloaded()
    return
  }
  const resp = await safeSendMessage<{ ok: boolean; reason?: string }>({
    type: 'open-incognito',
    url: window.location.href,
    sessionId: tabSessionId,
  })

  if (!resp) {
    notifyExtensionReloaded()
    return
  }
  if (!resp.ok) {
    if (resp.reason === 'not-allowed') {
      window.alert(
        'ClaudeChrome needs to be allowed in incognito mode.\n\n' +
        'Open chrome://extensions, find "ClaudeChrome Terminal", click "Details", and turn on "Allow in incognito".'
      )
    } else {
      window.alert('Could not open incognito window.')
    }
  }
}

function toggleMinimize(): void {
  state.minimized = !state.minimized
  updateVisibility()
  saveState()
}

function toggleMaximize(): void {
  maximized = !maximized
  if (maximized) {
    preMaximizeSize = state.size
    state.minimized = false
  } else {
    state.size = preMaximizeSize
    if (panelDiv) panelDiv.style.setProperty('--panel-size', `${state.size}px`)
  }
  updateVisibility()
  saveState()
}

function updateVisibility(): void {
  if (!panelDiv) return
  panelDiv.style.display = state.visible ? 'flex' : 'none'
  panelDiv.classList.toggle('minimized', state.minimized && !maximized)
  panelDiv.classList.toggle('maximized', maximized)

  const btnMinimize = panelDiv.querySelector('#btn-minimize') as HTMLButtonElement | null
  if (btnMinimize) {
    btnMinimize.textContent = state.minimized ? '□' : '−'
    btnMinimize.title = state.minimized ? 'Restore' : 'Minimize'
  }
}

function onResizeStart(e: MouseEvent): void {
  resizing = true
  resizeStartPos = state.dock === 'right' ? e.clientX : e.clientY
  resizeStartSize = state.size
  document.body.style.userSelect = 'none'
}

function onResizeMove(e: MouseEvent): void {
  if (!resizing || !panelDiv) return

  let newSize = resizeStartSize
  if (state.dock === 'right') {
    const deltaX = resizeStartPos - e.clientX
    newSize = Math.max(200, resizeStartSize + deltaX)
  } else {
    const deltaY = resizeStartPos - e.clientY
    newSize = Math.max(100, resizeStartSize + deltaY)
  }

  state.size = newSize
  panelDiv.style.setProperty('--panel-size', `${newSize}px`)
}

function onResizeEnd(): void {
  if (resizing) {
    resizing = false
    document.body.style.userSelect = ''
    saveState()
  }
}

// Message listener for toggle from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'toggle') {
    toggle()
  }
})

// Message listener for close-panel from the terminal iframe
window.addEventListener('message', (e: MessageEvent) => {
  if (e.data?.type === 'close-panel') {
    state.visible = false
    updateVisibility()
    saveState()
  }
})

// Ensure panel is always created/restored when needed
function ensurePanel(): void {
  if (!document.getElementById('claudechrome-host')) {
    createPanelDOM()
  } else {
    updateVisibility()
  }
}

// Load state and create panel immediately
loadState().then(async () => {
  // If we were opened by the "open-incognito" button, the originating tab's session UUID
  // is passed in as #ccsession=<UUID>. Adopt it so both windows share one host-side session.
  const hashMatch = window.location.hash.match(/(?:^|[#&])ccsession=([0-9a-f-]+)/i)
  if (hashMatch) {
    tabSessionId = hashMatch[1]
    try {
      await chrome.runtime.sendMessage({ type: 'set-session-id', sessionId: tabSessionId })
    } catch {}
    history.replaceState(null, '', window.location.pathname + window.location.search)
    // The user explicitly asked to share the session here — make sure the panel is visible.
    state.visible = true
    saveState()
  } else {
    // Get a stable session ID for this tab from the background script.
    // Stored in chrome.storage.session so it survives page navigation within the tab.
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'get-session-id' })
      tabSessionId = resp?.sessionId || crypto.randomUUID()
    } catch {
      tabSessionId = crypto.randomUUID()
    }
  }

  ensurePanel()

  // Watch for any DOM changes that might remove the panel and recreate it immediately
  const restoreObserver = new MutationObserver(() => {
    if (!document.getElementById('claudechrome-host') && state.visible) {
      createPanelDOM()
    }
  })

  restoreObserver.observe(document, {
    childList: true,
    subtree: true,
  })
})
