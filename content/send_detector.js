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

  // 1. Notify background that a valid Send page is detected
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
  let hasAutoClicked = false;

  async function triggerAutoContinue(result) {
    if (hasAutoClicked) return;

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

    hasAutoClicked = true;
    console.log(`[BizzHunter-WA] Auto-clicking Continue control immediately: "${result.visibleText}"`);

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

    // Brief 200ms delay to ensure page scripts have settled
    setTimeout(() => {
      try {
        if (continueElement) {
          // Perform native click and dispatch synthetic event
          continueElement.click();
          continueElement.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
          }));
        }
      } catch (err) {
        console.error('[BizzHunter-WA] Error executing auto-click:', err);
      }

      // Ensure navigation fallback: if Brave popup blocker suppressed opening a new tab
      if (result.destinationUrl && result.destinationUrl.includes('web.whatsapp.com')) {
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: BH.MessageType.ENSURE_WEB_NAVIGATION,
            payload: {
              destinationUrl: result.destinationUrl
            }
          }).catch(() => {});
        }, 1000);
      }
    }, 200);
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

        // Automatically click as soon as element is ready
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
    // If we haven't found the element yet, run an immediate detection
    if (!continueElement) {
      const immediate = BH.detectContinueControl(document);
      if (immediate.found) {
        continueElement = immediate.element;
      }
    }

    if (continueElement) {
      try {
        console.log('[BizzHunter-WA] User triggered Continue click on detected control');
        continueElement.click();
        sendResponse({ success: true, message: 'Continue element clicked successfully' });
      } catch (err) {
        console.error('[BizzHunter-WA] Failed to click continue element:', err);
        sendResponse({ success: false, error: err.message });
      }
    } else {
      sendResponse({ success: false, error: 'Continue element not available to click' });
    }
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
