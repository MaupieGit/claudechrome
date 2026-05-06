chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return
  chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {})
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get-session-id' && sender.tab?.id != null) {
    const key = `session-${sender.tab.id}`
    chrome.storage.session.get(key).then(stored => {
      let sessionId = stored[key] as string | undefined
      if (!sessionId) {
        sessionId = crypto.randomUUID()
        chrome.storage.session.set({ [key]: sessionId })
      }
      sendResponse({ sessionId })
    })
    return true  // async response
  }

  if (msg.type === 'set-session-id' && sender.tab?.id != null && typeof msg.sessionId === 'string') {
    const key = `session-${sender.tab.id}`
    chrome.storage.session.set({ [key]: msg.sessionId }).then(() => sendResponse({ ok: true }))
    return true
  }

  if (msg.type === 'hard-refresh' && sender.tab?.id != null) {
    chrome.tabs.reload(sender.tab.id, { bypassCache: true })
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err) }))
    return true
  }

  if (msg.type === 'open-incognito' && typeof msg.url === 'string' && typeof msg.sessionId === 'string') {
    chrome.extension.isAllowedIncognitoAccess().then(allowed => {
      if (!allowed) {
        sendResponse({ ok: false, reason: 'not-allowed' })
        return
      }
      let target: string
      try {
        const u = new URL(msg.url)
        u.hash = `ccsession=${msg.sessionId}`
        target = u.toString()
      } catch {
        sendResponse({ ok: false, reason: 'bad-url' })
        return
      }
      chrome.windows.create({ url: target, incognito: true })
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, reason: 'create-failed', error: String(err) }))
    })
    return true
  }
})

// Clean up session ID when the tab closes
chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(`session-${tabId}`)
})
