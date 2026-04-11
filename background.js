chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'saveAndOpenViewer') {
    chrome.storage.local.set({ currentReview: msg.data }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      chrome.tabs.create({
        url: chrome.runtime.getURL('viewer.html'),
        active: true
      });
      sendResponse({ success: true });
    });
    return true; // async
  }
});
