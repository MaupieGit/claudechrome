chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return
  chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {
    // Content script not loaded yet; it will check on document load
  })
})
