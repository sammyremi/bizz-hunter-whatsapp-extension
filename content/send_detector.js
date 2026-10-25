/**
 * Bizz-Hunter WhatsApp Assistant - Send Page Content Script
 * Injected on api.whatsapp.com/send/*
 * Detects URL validity, identifies the Continue control, and notifies background worker.
 */
(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__BIZZHUNTER_SEND_DETECTOR_LOADED__) return;
  window.__BIZZHUNTER_SEND_DETECTOR_LOADED__ = true;

  const urlInfo = BH.parseWhatsAppUrl(window.location.href);

  // If this is an unrelated WhatsApp page or missing valid phone, ignore silently
  if (!urlInfo.isValid || !urlInfo.isSendEndpoint) {
    return;
  }

  // Safe diagnostic log
  console.log(`[BizzHunter-WA] Detected send link for ${urlInfo.phoneMasked} (msg length: ${urlInfo.textSummary.length})`);

  // 1. Notify background that a valid Send page is detected and store pending message text directly
  const pendingData = {};
  if (urlInfo.text) pendingData[BH.StorageKey.PENDING_MESSAGE_TEXT] = urlInfo.text;
  if (urlInfo.phoneNormalized) pendingData[BH.StorageKey.PENDING_PHONE] = urlInfo.phoneNormalized;
  if (Object.keys(pendingData).length > 0) {
    chrome.storage.local.set(pendingData).catch(() => {});
  }

  chrome.runtime.sendMessage({
    type: BH.MessageType.SEND_PAGE_DETECTED,
    payload: {
      url: window.location.href,
      phone: urlInfo.phone,
      phoneNormalized: urlInfo.phoneNormalized,
      phoneMasked: urlInfo.phoneMasked,
      messageText: urlInfo.text || '',
      textLength: urlInfo.textSummary.length,
      textSnippet: urlInfo.textSummary.snippet
    }
  }).catch(() => {});

  let continueElement = null;
  let observerHandle = null;
  let hasInitiatedNavigation = false;

  // Intercept any manual click on Continue or web.whatsapp.com links to open in a new tab rather than navigating the current send tab
  document.addEventListener('click', (e) => {
    const anchor = e.target.closest && (
      e.target.closest('a[href*="web.whatsapp.com"]') ||
      e.target.closest('[id="action-button"]') ||
      (continueElement && e.target.closest(continueElement.tagName) === continueElement)
    );
    if (anchor) {
      const dest = anchor.getAttribute('href') || (continueElement && continueElement.getAttribute('href')) || 'https://web.whatsapp.com/';
      if (dest && (dest.includes('web.whatsapp.com') || dest.startsWith('/'))) {
        e.preventDefault();
        e.stopPropagation();
        console.log(`[BizzHunter-WA] Intercepted manual click, opening new tab for: ${dest}`);
        hasInitiatedNavigation = true;
        chrome.runtime.sendMessage({
          type: BH.MessageType.ENSURE_WEB_NAVIGATION,
          payload: {
            destinationUrl: dest,
            userTriggered: true
          }
        }).catch(() => {});
      }
    }
  }, true);

  async function triggerAutoContinue(result) {
    if (hasInitiatedNavigation) return;

    // Check settings from storage to verify extension is not paused
    try {
      const data = await chrome.storage.local.get(BH.StorageKey.SETTINGS);
      const settings = data[BH.StorageKey.SETTINGS] || BH.DefaultSettings;
      if (settings.isPaused || settings.autoContinueEnabled === false) {
        console.log('[BizzHunter-WA] Auto-continue skipped because extension is paused or autoContinue is disabled');
        return;
      }
    } catch {
      // Continue with default (enabled) if storage read fails
    }

    hasInitiatedNavigation = true;
    console.log(`[BizzHunter-WA] Auto-continue: opening detected destination in new tab: "${result.destinationUrl || 'default'}"`);

    // Notify background that auto-continue is executing
    chrome.runtime.sendMessage({
      type: BH.MessageType.CONTINUE_PAGE_STATUS,
      payload: {
        found: true,
        isReady: true,
        visibleText: result.visibleText,
        destinationUrl: result.destinationUrl,
        targetType: result.targetType,
        autoTriggered: true
      }
    }).catch(() => {});

    // Open detected Continue destination in a NEW tab using service worker chrome.tabs.create
    // This preserves the original send tab and avoids navigating away from api.whatsapp.com
    chrome.runtime.sendMessage({
      type: BH.MessageType.ENSURE_WEB_NAVIGATION,
      payload: {
        destinationUrl: result.destinationUrl,
        autoTriggered: true
      }
    }).catch(() => {});
  }

  // 2. Observe the DOM for the Continue control
  function startDetection() {
    observerHandle = BH.observeContinueControl(document, (result) => {
      if (result.found) {
        continueElement = result.element;

        console.log(`[BizzHunter-WA] Continue control detected: "${result.visibleText}" -> ${result.destinationUrl || 'default'}`);

        chrome.runtime.sendMessage({
          type: BH.MessageType.CONTINUE_PAGE_STATUS,
          payload: {
            found: true,
            isReady: result.isReady,
            visibleText: result.visibleText,
            destinationUrl: result.destinationUrl,
            targetType: result.targetType,
            autoTriggered: false
          }
        }).catch(() => {});

        // Automatically open new tab as soon as element is ready
        if (result.isReady) {
          triggerAutoContinue(result);
        }
      } else {
        console.warn(`[BizzHunter-WA] Continue control not found: ${result.reason}`);
        chrome.runtime.sendMessage({
          type: BH.MessageType.CONTINUE_PAGE_STATUS,
          payload: {
            found: false,
            isReady: false,
            reason: result.reason || 'Element not found'
          }
        }).catch(() => {});
      }
    }, 12000); // 12 second maximum observation window
  }

  // 3. Listen for user-triggered continue action from background or popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === BH.MessageType.EXECUTE_CONTINUE_CLICK) {
      handleUserContinueTrigger(sendResponse);
      return true; // async response
    }
  });

  function handleUserContinueTrigger(sendResponse) {
    if (!continueElement) {
      const immediate = BH.detectContinueControl(document);
      if (immediate.found) {
        continueElement = immediate.element;
      }
    }

    const dest = (continueElement && continueElement.getAttribute('href')) || 'https://web.whatsapp.com/';
    chrome.runtime.sendMessage({
      type: BH.MessageType.ENSURE_WEB_NAVIGATION,
      payload: {
        destinationUrl: dest,
        userTriggered: true
      }
    }).then(() => {
      sendResponse({ success: true, message: 'New tab navigation initiated for detected Continue destination' });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
  }

  // Run detection when DOM is interactive or ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDetection);
  } else {
    startDetection();
  }

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    if (observerHandle) {
      observerHandle.disconnect();
    }
  });

})();
