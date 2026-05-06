// Dockable panel controller — injected into every page
// Manages panel visibility, dock position, and resize

interface PanelState {
  visible: boolean
  dock: 'right' | 'bottom'
  size: number
}

const DEFAULT_STATE: PanelState = {
  visible: false,
  dock: 'right',
  size: 350,
}

let state: PanelState = { ...DEFAULT_STATE }
let hostDiv: HTMLElement | null = null
let panelDiv: HTMLElement | null = null
let resizeHandle: HTMLElement | null = null
let resizing = false
let resizeStartPos = 0
let resizeStartSize = 0

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

  const btnClose = document.createElement('button')
  btnClose.id = 'btn-close'
  btnClose.title = 'Close'
  btnClose.textContent = '✕'
  btnClose.addEventListener('click', toggle)
  header.appendChild(btnClose)

  panelDiv.appendChild(header)

  // Resize handle
  resizeHandle = document.createElement('div')
  resizeHandle.id = 'resize-handle'
  panelDiv.appendChild(resizeHandle)

  // iframe
  const panelUrl = chrome.runtime.getURL('src/panel/panel.html')
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
    panelDiv.className = dock === 'right' ? 'dock-right' : 'dock-bottom'
  }
  saveState()
}

function toggle(): void {
  state.visible = !state.visible
  updateVisibility()
  saveState()
}

function updateVisibility(): void {
  if (panelDiv) {
    panelDiv.style.display = state.visible ? 'flex' : 'none'
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

// Ensure panel is always created/restored when needed
function ensurePanel(): void {
  if (!document.getElementById('claudechrome-host')) {
    createPanelDOM()
  } else {
    updateVisibility()
  }
}

// Load state and create panel immediately
loadState().then(() => {
  ensurePanel()

  // Keep checking to restore panel if it somehow gets removed
  setInterval(() => {
    if (!document.getElementById('claudechrome-host') && state.visible) {
      ensurePanel()
    }
  }, 250)
})
