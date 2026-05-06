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
})

// Clean up session ID when the tab closes
chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(`session-${tabId}`)
})
