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

  // Handle manual clicks on Continue controls: ensure href carries phone and text parameters
  document.addEventListener('click', (e) => {
    const anchor = e.target.closest && (
      e.target.closest('a[href*="web.whatsapp.com"]') ||
      e.target.closest('[id="action-button"]') ||
      (continueElement && e.target.closest(continueElement.tagName) === continueElement)
    );
    if (anchor) {
      if (autoContinueCountdownTimer) {
        clearInterval(autoContinueCountdownTimer);
        autoContinueCountdownTimer = null;
      }
      hasInitiatedNavigation = true;
      let dest = anchor.getAttribute('href') || (continueElement && continueElement.getAttribute('href')) || '';
      if (!dest || !dest.includes('phone=')) {
        dest = BH.buildWhatsAppWebSendUrl(urlInfo.phoneNormalized, urlInfo.text);
        if (anchor.tagName && anchor.tagName.toLowerCase() === 'a') {
          anchor.setAttribute('href', dest);
        }
      }
      console.log(`[BizzHunter-WA] Manual click on Continue control registered for: ${dest}`);
      chrome.runtime.sendMessage({
        type: BH.MessageType.CONTINUE_ACTION_ACTIVATED,
        payload: {
          destinationUrl: dest,
          userTriggered: true
        }
      }).catch(() => {});
    }
  }, true);

  let autoContinueCountdownTimer = null;
  let continueCountdownRemaining = 0;

  async function scheduleAutoContinue(result) {
    if (hasInitiatedNavigation || autoContinueCountdownTimer) return;

    // Check settings from storage to verify extension is not paused
    let continueDelay = 10;
    try {
      const data = await chrome.storage.local.get(BH.StorageKey.SETTINGS);
      const settings = data[BH.StorageKey.SETTINGS] || BH.DefaultSettings;
      if (settings.isPaused || settings.autoContinueEnabled === false) {
        console.log('[BizzHunter-WA] Auto-continue skipped because extension is paused or autoContinue is disabled');
        return;
      }
      if (settings.continueDelaySeconds !== undefined) {
        continueDelay = Math.max(0, settings.continueDelaySeconds);
      }
    } catch {
      // Use default 10s if storage read fails
    }

    if (continueDelay <= 0) {
      triggerAutoContinue(result);
      return;
    }

    console.log(`[BizzHunter-WA] Continue control ready. Waiting ${continueDelay}s before activating...`);
    continueCountdownRemaining = continueDelay;

    autoContinueCountdownTimer = setInterval(() => {
      continueCountdownRemaining--;

      // Re-verify that Continue control is still in the DOM and ready
      const check = BH.detectContinueControl(document, urlInfo);
      if (!check.found || !check.isReady) {
        console.warn('[BizzHunter-WA] Continue control was modified or removed during countdown');
        clearInterval(autoContinueCountdownTimer);
        autoContinueCountdownTimer = null;
        return;
      }

      if (continueCountdownRemaining <= 0) {
        clearInterval(autoContinueCountdownTimer);
        autoContinueCountdownTimer = null;
        triggerAutoContinue(check);
      }
    }, 1000);
  }

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

    // Revalidate the continue element directly before activation
    const current = BH.detectContinueControl(document, urlInfo);
    const targetElement = (current.found && current.element) ? current.element : continueElement;

    if (!targetElement) {
      console.warn('[BizzHunter-WA] Auto-continue aborted: Continue control not found on revalidation');
      return;
    }

    hasInitiatedNavigation = true;
    const dest = (current.destinationUrl || result.destinationUrl || BH.buildWhatsAppWebSendUrl(urlInfo.phoneNormalized, urlInfo.text));

    console.log(`[BizzHunter-WA] Auto-continue: activating Continue control for "${dest}"`);

    // Notify background that auto-continue is executing
    chrome.runtime.sendMessage({
      type: BH.MessageType.CONTINUE_PAGE_STATUS,
      payload: {
        found: true,
        isReady: true,
        visibleText: result.visibleText,
        destinationUrl: dest,
        targetType: result.targetType,
        autoTriggered: true
      }
    }).catch(() => {});

    chrome.runtime.sendMessage({
      type: BH.MessageType.CONTINUE_ACTION_ACTIVATED,
      payload: {
        destinationUrl: dest,
        autoTriggered: true
      }
    }).catch(() => {});

    // Genuine user-facing activation: pointerdown, mousedown, pointerup, mouseup, click + .click()
    BH.activateControl(targetElement);

    // Fallback safeguard: if popup blocker suppressed target="_blank" tab opening, ensure navigation
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: BH.MessageType.ENSURE_WEB_NAVIGATION,
        payload: {
          destinationUrl: dest,
          autoTriggered: true
        }
      }).catch(() => {});
    }, 1500);
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

        // Automatically activate after 10-second countdown once element is ready
        if (result.isReady) {
          scheduleAutoContinue(result);
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
    }, 12000, urlInfo); // 12 second maximum observation window
  }

  // 3. Listen for user-triggered continue action from background or popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === BH.MessageType.EXECUTE_CONTINUE_CLICK) {
      handleUserContinueTrigger(sendResponse);
      return true; // async response
    }
  });

  function handleUserContinueTrigger(sendResponse) {
    if (autoContinueCountdownTimer) {
      clearInterval(autoContinueCountdownTimer);
      autoContinueCountdownTimer = null;
    }
    if (!continueElement) {
      const immediate = BH.detectContinueControl(document, urlInfo);
      if (immediate.found) {
        continueElement = immediate.element;
      }
    }

    const dest = (continueElement && continueElement.getAttribute('href')) || BH.buildWhatsAppWebSendUrl(urlInfo.phoneNormalized, urlInfo.text);
    hasInitiatedNavigation = true;

    chrome.runtime.sendMessage({
      type: BH.MessageType.CONTINUE_ACTION_ACTIVATED,
      payload: {
        destinationUrl: dest,
        userTriggered: true
      }
    }).catch(() => {});

    if (continueElement) {
      BH.activateControl(continueElement);
    }

    // Also send ensure navigation as backup
    chrome.runtime.sendMessage({
      type: BH.MessageType.ENSURE_WEB_NAVIGATION,
      payload: {
        destinationUrl: dest,
        userTriggered: true
      }
    }).then(() => {
      sendResponse({ success: true, message: 'Continue action executed' });
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
    if (autoContinueCountdownTimer) {
      clearInterval(autoContinueCountdownTimer);
      autoContinueCountdownTimer = null;
    }
    if (observerHandle) {
      observerHandle.disconnect();
    }
  });

})();
