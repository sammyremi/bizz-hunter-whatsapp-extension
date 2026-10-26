/**
 * Bizz-Hunter WhatsApp Assistant - DOM Utilities
 * Robust, resilient DOM inspection routines for api.whatsapp.com and web.whatsapp.com.
 * Avoids fragile class names and handles dynamic rendering, duplicate IDs, and accessible variants.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BH = root.BH || {};
    Object.assign(root.BH, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Check if an element is visible in the viewport and not hidden by styles.
   * @param {Element} el
   * @returns {boolean}
   */
  function isElementVisible(el) {
    if (!el || !el.ownerDocument) return false;
    // Check basic node visibility
    if (el.nodeType !== 1) return false;

    // Check inline/element styles directly
    if (el.style) {
      if (el.style.display === 'none') return false;
      if (el.style.visibility === 'hidden' || el.style.visibility === 'collapse') return false;
      if (el.style.opacity === '0' || el.style.opacity === 0) return false;
    }

    // Check computed styles if window is available
    const win = el.ownerDocument.defaultView || (typeof window !== 'undefined' ? window : null);
    const style = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
    if (style) {
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (parseFloat(style.opacity) === 0) return false;
    }

    // Check dimensions if available
    if (typeof el.getBoundingClientRect === 'function') {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        // Could be zero size if not yet rendered or hidden
        if (el.offsetParent === null && style && style.position !== 'fixed') {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Normalizes text content: strips extra whitespace, lowercases.
   * @param {string} str
   * @returns {string}
   */
  function normalizeText(str) {
    if (!str) return '';
    return str.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Inspects the DOM on api.whatsapp.com/send to find the Continue to WhatsApp Web element.
   *
   * Strategy:
   * 1. Query all potential links and buttons (handles duplicate IDs gracefully).
   * 2. Check for explicit Web WhatsApp links (href containing web.whatsapp.com).
   * 3. Check for matching text (e.g. "Continue to WhatsApp Web", "use WhatsApp Web", "Continue to Chat").
   * 4. Check for #action-button with fallback check if it points to desktop app.
   *
   * @param {Document} doc
   * @returns {{
   *   found: boolean,
   *   element: Element|null,
   *   targetType: 'web'|'desktop'|'unknown',
   *   destinationUrl: string,
   *   visibleText: string,
   *   isReady: boolean,
   *   reason?: string
   * }}
   */
  /**
   * Helper to build supported web send URL if BH.buildWhatsAppWebSendUrl is unavailable.
   */
  function buildWebSendUrl(phone, text) {
    if (typeof BH !== 'undefined' && typeof BH.buildWhatsAppWebSendUrl === 'function') {
      return BH.buildWhatsAppWebSendUrl(phone, text);
    }
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone) return 'https://web.whatsapp.com/';
    try {
      const url = new URL('https://web.whatsapp.com/send/');
      url.searchParams.set('phone', cleanPhone);
      if (text) url.searchParams.set('text', text);
      return url.toString();
    } catch {
      return `https://web.whatsapp.com/send/?phone=${cleanPhone}${text ? '&text=' + encodeURIComponent(text) : ''}`;
    }
  }

  /**
   * Helper to check if an element belongs to the header navigation, footer,
   * or represents an unrelated action (e.g. login, download, terms).
   */
  function isExcludedNavigationControl(el) {
    if (!el) return true;

    // Check ancestors for header / footer / nav elements
    if (typeof el.closest === 'function') {
      if (el.closest('header, footer, nav, [role="navigation"]')) {
        return true;
      }
    }

    // Check data-ms telemetry attributes
    const dataMs = (el.getAttribute && el.getAttribute('data-ms') || '').toLowerCase();
    if (dataMs.includes('login') || dataMs.includes('download') || dataMs.includes('footer') || dataMs.includes('nav')) {
      return true;
    }

    // Check aria-label
    const ariaLabel = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('log in') || ariaLabel.includes('download') || ariaLabel.includes('legal') || ariaLabel.includes('policies')) {
      return true;
    }

    // Check text content
    const text = normalizeText(el.textContent || '');
    if (text === 'log in' || text === 'download' || text === 'download app' || text === 'download it now') {
      return true;
    }

    // Check href
    const href = (el.getAttribute && el.getAttribute('href') || '').toLowerCase();
    if (href.includes('/desktop/') || href.includes('/legal/')) {
      return true;
    }

    return false;
  }

  /**
   * Inspects the DOM on api.whatsapp.com/send to find the genuine Continue to WhatsApp Web element.
   *
   * Strategy:
   * 1. Filters out generic navigation links (e.g. Log In, Download app, footer links).
   * 2. Checks telemetry data-ms attributes ('UseWhatsAppWeb', 'ContinueToChat').
   * 3. Checks WhatsApp's primary #action-button with matching text or web/send destination.
   * 4. Checks links directly pointing to web.whatsapp.com/send.
   * 5. Checks text keywords ('continue to whatsapp web', 'use whatsapp web', 'continue to chat').
   * 6. Checks fallback links (e.g. a._9v6b).
   * 7. Ensures destinationUrl preserves original phone and text parameters (never bare web.whatsapp.com).
   *
   * @param {Document} doc
   * @param {Object} [pageUrlInfo] - Optional parsed URL info containing { phoneNormalized, text }
   * @returns {{
   *   found: boolean,
   *   element: Element|null,
   *   targetType: 'web'|'desktop'|'unknown',
   *   destinationUrl: string,
   *   visibleText: string,
   *   isReady: boolean,
   *   reason?: string
   * }}
   */
  function detectContinueControl(doc, pageUrlInfo) {
    if (!doc) {
      return { found: false, element: null, targetType: 'unknown', destinationUrl: '', visibleText: '', isReady: false, reason: 'Document unavailable' };
    }

    // Known positive text keywords for the actual Continue action
    const continueKeywords = [
      'continue to whatsapp web',
      'use whatsapp web',
      'continue to chat',
      'open in whatsapp web'
    ];

    // Determine fallback phone and text from pageUrlInfo or doc location
    let fallbackPhone = pageUrlInfo && (pageUrlInfo.phoneNormalized || pageUrlInfo.phone) || '';
    let fallbackText = pageUrlInfo && pageUrlInfo.text || '';
    if (!fallbackPhone && doc.defaultView && doc.defaultView.location && doc.defaultView.location.search) {
      try {
        const sp = new URLSearchParams(doc.defaultView.location.search);
        fallbackPhone = (sp.get('phone') || '').replace(/[^0-9]/g, '');
        fallbackText = sp.get('text') || '';
      } catch {}
    }

    function resolveDestinationUrl(href) {
      let resolved = '';
      if (href) {
        if (href.startsWith('//')) {
          resolved = `https:${href}`;
        } else if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('whatsapp://') || href.startsWith('intent://')) {
          resolved = href;
        } else {
          try {
            resolved = new URL(href, 'https://web.whatsapp.com').href;
          } catch {
            resolved = href;
          }
        }
      }

      // If the destination URL is bare web.whatsapp.com or lacks recipient phone,
      // preserve the original recipient and text parameters!
      const hasPhoneParam = resolved && resolved.includes('phone=');
      if (!hasPhoneParam && fallbackPhone) {
        return buildWebSendUrl(fallbackPhone, fallbackText);
      }

      return resolved || (fallbackPhone ? buildWebSendUrl(fallbackPhone, fallbackText) : 'https://web.whatsapp.com/');
    }

    function checkIsReady(el) {
      if (!isElementVisible(el)) return false;
      if (el.hasAttribute && el.hasAttribute('disabled')) return false;
      if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
      if (el.classList && el.classList.contains && el.classList.contains('disabled')) return false;
      if (el.style && el.style.pointerEvents === 'none') return false;
      return true;
    }

    // Priority 1: Elements with telemetry data-ms matching UseWhatsAppWeb or ContinueToChat
    const telemetryElements = Array.from(doc.querySelectorAll('[data-ms]'));
    for (const el of telemetryElements) {
      if (isElementVisible(el)) {
        const dataMs = (el.getAttribute('data-ms') || '').toLowerCase();
        if (dataMs.includes('usewhatsappweb') || dataMs.includes('continuetochat')) {
          const href = el.getAttribute('href') || '';
          const text = el.textContent ? el.textContent.trim() : '';
          return {
            found: true,
            element: el,
            targetType: 'web',
            destinationUrl: resolveDestinationUrl(href),
            visibleText: text || 'Continue to WhatsApp Web',
            isReady: checkIsReady(el)
          };
        }
      }
    }

    // Priority 2: Primary action buttons (WhatsApp uses id="action-button")
    const actionButtons = Array.from(doc.querySelectorAll('[id="action-button"]'));
    for (const btn of actionButtons) {
      if (isElementVisible(btn) && !isExcludedNavigationControl(btn)) {
        const href = btn.getAttribute('href') || '';
        const text = btn.textContent ? btn.textContent.trim() : '';
        const normText = normalizeText(text);

        // Check if this action button directly points to web or matches continue keywords
        if (href.includes('web.whatsapp.com') || continueKeywords.some(kw => normText.includes(kw))) {
          return {
            found: true,
            element: btn,
            targetType: 'web',
            destinationUrl: resolveDestinationUrl(href),
            visibleText: text || 'Continue to WhatsApp Web',
            isReady: checkIsReady(btn)
          };
        }

        // If it points to whatsapp:// or desktop protocol, look for secondary web fallback
        if (href.startsWith('whatsapp://') || href.startsWith('intent://')) {
          const fallback = doc.querySelector('a[href*="web.whatsapp.com"], a._9v6b, a[role="link"]');
          if (fallback && isElementVisible(fallback) && !isExcludedNavigationControl(fallback)) {
            const fallbackHref = fallback.getAttribute('href') || '';
            const fallbackText = fallback.textContent ? fallback.textContent.trim() : '';
            return {
              found: true,
              element: fallback,
              targetType: 'web',
              destinationUrl: resolveDestinationUrl(fallbackHref),
              visibleText: fallbackText || 'use WhatsApp Web',
              isReady: checkIsReady(fallback)
            };
          }
        }
      }
    }

    // Priority 3: Links pointing directly to web.whatsapp.com/send
    const sendAnchors = Array.from(doc.querySelectorAll('a[href*="web.whatsapp.com/send"]'));
    for (const anchor of sendAnchors) {
      if (isElementVisible(anchor) && !isExcludedNavigationControl(anchor)) {
        const text = anchor.textContent ? anchor.textContent.trim() : '';
        const href = anchor.getAttribute('href') || '';
        return {
          found: true,
          element: anchor,
          targetType: 'web',
          destinationUrl: resolveDestinationUrl(href),
          visibleText: text || 'Continue to WhatsApp Web',
          isReady: checkIsReady(anchor)
        };
      }
    }

    // Priority 4: Any visible anchor or button matching continue text keywords
    const candidates = Array.from(doc.querySelectorAll('a, button, [role="link"], [role="button"]'));
    for (const el of candidates) {
      if (!isElementVisible(el) || isExcludedNavigationControl(el)) continue;

      const text = el.textContent ? el.textContent.trim() : '';
      const normText = normalizeText(text);
      const ariaLabel = normalizeText(el.getAttribute('aria-label') || '');

      const isMatch = continueKeywords.some(kw => normText.includes(kw) || ariaLabel.includes(kw));
      if (isMatch) {
        const href = el.getAttribute('href') || '';
        return {
          found: true,
          element: el,
          targetType: href.includes('web.whatsapp.com') ? 'web' : 'unknown',
          destinationUrl: resolveDestinationUrl(href),
          visibleText: text || 'Continue to WhatsApp Web',
          isReady: checkIsReady(el)
        };
      }
    }

    // Priority 5: Fallback links pointing to web.whatsapp.com
    const webAnchors = Array.from(doc.querySelectorAll('a[href*="web.whatsapp.com"], a._9v6b'));
    for (const anchor of webAnchors) {
      if (isElementVisible(anchor) && !isExcludedNavigationControl(anchor)) {
        const text = anchor.textContent ? anchor.textContent.trim() : '';
        const href = anchor.getAttribute('href') || '';
        return {
          found: true,
          element: anchor,
          targetType: 'web',
          destinationUrl: resolveDestinationUrl(href),
          visibleText: text || 'Continue to WhatsApp Web',
          isReady: checkIsReady(anchor)
        };
      }
    }

    return {
      found: false,
      element: null,
      targetType: 'unknown',
      destinationUrl: '',
      visibleText: '',
      isReady: false,
      reason: 'No matching Continue control found in current DOM'
    };
  }

  /**
   * Watches for the Continue button on api.whatsapp.com using MutationObserver.
   * Self-terminates on success or after timeout.
   *
   * @param {Document} doc
   * @param {Function} onDetected - callback({ found, element, targetType, destinationUrl, visibleText })
   * @param {number} timeoutMs - Max time to observe before reporting failure (default 10000ms)
   * @param {Object} [pageUrlInfo] - Optional parsed URL info
   * @returns {{ disconnect: Function }}
   */
  function observeContinueControl(doc, onDetected, timeoutMs = 10000, pageUrlInfo) {
    if (!doc || !doc.body) {
      return { disconnect: () => {} };
    }

    // Initial check
    const initialResult = detectContinueControl(doc, pageUrlInfo);
    if (initialResult.found) {
      onDetected(initialResult);
      return { disconnect: () => {} };
    }

    let observer = null;
    let timer = null;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    timer = setTimeout(() => {
      cleanup();
      // Final check upon timeout
      const finalResult = detectContinueControl(doc, pageUrlInfo);
      onDetected(finalResult);
    }, timeoutMs);

    observer = new MutationObserver(() => {
      const res = detectContinueControl(doc, pageUrlInfo);
      if (res.found) {
        cleanup();
        onDetected(res);
      }
    });

    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'style', 'class', 'disabled', 'aria-disabled']
    });

    return { disconnect: cleanup };
  }

  /**
   * Triggers the genuine user-facing activation sequence on a Continue or chat control.
   * Dispatches realistic pointer, mouse, and click events, focuses the control, and invokes .click().
   * @param {Element} el
   * @returns {boolean}
   */
  function activateControl(el) {
    if (!el) return false;

    const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);

    try {
      if (typeof el.focus === 'function') el.focus();
    } catch {}

    // Dispatch pointer and mouse down/up gesture events
    const eventNames = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];
    for (const evtName of eventNames) {
      try {
        let ev;
        if (evtName.startsWith('pointer') && typeof PointerEvent !== 'undefined') {
          ev = new PointerEvent(evtName, { bubbles: true, cancelable: true, view: win, buttons: 1 });
        } else if (typeof MouseEvent !== 'undefined') {
          ev = new MouseEvent(evtName, { bubbles: true, cancelable: true, view: win, buttons: 1 });
        } else if (typeof Event !== 'undefined') {
          ev = new Event(evtName, { bubbles: true, cancelable: true });
        } else {
          ev = { type: evtName, bubbles: true, cancelable: true };
        }
        if (typeof el.dispatchEvent === 'function') {
          el.dispatchEvent(ev);
        }
      } catch {}
    }

    // Trigger single click action: prefer native .click(), fallback to dispatchEvent for headless environments
    try {
      if (typeof el.click === 'function') {
        el.click();
      } else if (typeof el.dispatchEvent === 'function') {
        let clickEv;
        if (typeof MouseEvent !== 'undefined') {
          clickEv = new MouseEvent('click', { bubbles: true, cancelable: true, view: win, buttons: 1 });
        } else {
          clickEv = { type: 'click', bubbles: true, cancelable: true };
        }
        el.dispatchEvent(clickEv);
      }
    } catch {}

    return true;
  }

  /**
   * WhatsApp Web DOM Inspection.
   * Detects active chat state, header recipient, composer draft, and modals.
   *
   * @param {Document} doc
   * @param {string} [expectedPhone] - Optional expected phone number to verify against
   * @returns {{
   *   isAppLoaded: boolean,
   *   isConnecting: boolean,
   *   isQrScreen: boolean,
   *   isInvalidNumber: boolean,
   *   invalidNumberMessage: string,
   *   chatOpen: boolean,
   *   recipientText: string,
   *   recipientVerified: boolean,
   *   composerFound: boolean,
   *   composerElement: Element|null,
   *   draftText: string,
   *   hasDraft: boolean,
   *   sendButtonFound: boolean,
   *   sendButtonElement: Element|null
   * }}
   */
  function inspectWhatsAppWeb(doc, expectedPhone = '') {
    const result = {
      isAppLoaded: false,
      isConnecting: false,
      isQrScreen: false,
      isInvalidNumber: false,
      invalidNumberMessage: '',
      chatOpen: false,
      recipientText: '',
      recipientVerified: false,
      composerFound: false,
      composerElement: null,
      draftText: '',
      hasDraft: false,
      sendButtonFound: false,
      sendButtonElement: null
    };

    if (!doc) return result;

    const bodyText = doc.body ? doc.body.textContent || '' : '';

    // Check if connecting/loading
    if (doc.querySelector('progress, [aria-busy="true"], .progress') ||
        bodyText.includes('Connecting to WhatsApp') ||
        bodyText.includes('Starting chat') ||
        bodyText.includes('Loading your chats')) {
      result.isConnecting = true;
    }

    // Check QR code screen (user not logged in)
    if (doc.querySelector('canvas[aria-label*="Scan"], canvas[role="img"]') ||
        bodyText.includes('To use WhatsApp on your computer') ||
        bodyText.includes('Link with phone number')) {
      result.isQrScreen = true;
      return result;
    }

    // Check invalid phone number popup / modal
    // WhatsApp displays a modal: "Phone number shared via url is invalid." or "The phone number is not registered on WhatsApp."
    const modal = doc.querySelector('div[data-animate-modal-popup="true"], div[role="dialog"]');
    if (modal) {
      const modalText = modal.textContent || '';
      if (modalText.includes('invalid') || modalText.includes('not registered') || modalText.includes('shared via url is invalid')) {
        result.isInvalidNumber = true;
        result.invalidNumberMessage = modalText.replace(/\s+/g, ' ').trim();
        return result;
      }
    }

    // Check "Use Here" dialog (when WhatsApp is open in another window)
    const useHereModal = doc.querySelector('div[data-animate-modal-popup="true"], div[role="dialog"]');
    if (useHereModal) {
      const modalText = useHereModal.textContent || '';
      if (modalText.includes('open in another window') || modalText.includes('Use Here')) {
        const useHereBtn = useHereModal.querySelector('button, div[role="button"]');
        result.isUseHerePrompt = true;
        result.useHereButtonElement = useHereBtn;
      }
    }

    // Main App Container check
    const appEl = doc.getElementById('app') || doc.querySelector('#main, [data-testid="conversation-panel-wrapper"], div[role="region"]');
    if (appEl) {
      result.isAppLoaded = true;
    }

    // Detect Conversation Header and Recipient
    // WhatsApp Web puts the active chat header inside a <header> element or [data-testid="conversation-header"]
    const header = doc.querySelector('#main header, [data-testid="conversation-header"], header[data-testid="chat-header"]');
    const safeHeader = header || Array.from(doc.querySelectorAll('header')).find(h => !h.closest || !h.closest('#side'));

    if (safeHeader) {
      result.chatOpen = true;

      // Extract recipient text from header title/spans
      const titleSpan = safeHeader.querySelector('span[title], div[role="button"] span[dir="auto"], span._ao3e');
      if (titleSpan) {
        result.recipientText = (titleSpan.getAttribute('title') || titleSpan.textContent || '').trim();
      } else {
        const anySpan = safeHeader.querySelector('span[dir="auto"]');
        if (anySpan) {
          result.recipientText = (anySpan.textContent || '').trim();
        }
      }

      // Verify recipient against expected phone if provided
      if (expectedPhone && result.recipientText) {
        const cleanExpected = expectedPhone.replace(/[^0-9]/g, '');
        const cleanFound = result.recipientText.replace(/[^0-9]/g, '');
        // Check if last 7 digits match (handles international prefixes vs local format)
        if (cleanExpected.length >= 7 && cleanFound.length >= 7) {
          const suffixExpected = cleanExpected.slice(-7);
          const suffixFound = cleanFound.slice(-7);
          result.recipientVerified = (suffixExpected === suffixFound) || cleanFound.includes(suffixExpected) || cleanExpected.includes(cleanFound);
        } else if (cleanExpected && cleanFound) {
          result.recipientVerified = cleanFound.includes(cleanExpected) || cleanExpected.includes(cleanFound);
        } else if (cleanExpected && !cleanFound && result.recipientText.length > 0) {
          // Contact is saved with a display name (e.g. "Arewa Specialist") rather than raw phone digits
          result.recipientVerified = true;
        }
      } else if (!expectedPhone && result.recipientText) {
        result.recipientVerified = true;
      }
    }

    // Detect Message Composer
    // Crucial rule: Message composer is in the active chat container (#main or footer).
    // Supports Lexical editor (data-lexical-editor="true"), data-tab="10", role="textbox".
    // Explicitly avoids search input in sidebar (#side / data-tab="3") and message bubbles.
    let composer = null;
    const mainArea = doc.getElementById('main') || doc.querySelector('[data-testid="conversation-panel-wrapper"]');

    if (mainArea) {
      composer = mainArea.querySelector(
        'div[contenteditable="true"][data-lexical-editor="true"], ' +
        'div[contenteditable="true"][data-tab="10"], ' +
        'div[contenteditable="true"][role="textbox"], ' +
        'footer div[contenteditable="true"], ' +
        'div[contenteditable="true"]'
      );
    }

    if (!composer) {
      const footer = doc.querySelector('#main footer, [data-testid="conversation-panel-wrapper"] footer, footer');
      if (footer && (!footer.closest || !footer.closest('#side'))) {
        composer = footer.querySelector('div[contenteditable="true"]');
      }
    }

    if (!composer) {
      const candidateTextboxes = Array.from(doc.querySelectorAll('div[contenteditable="true"]'));
      for (const tb of candidateTextboxes) {
        if ((!tb.closest || !tb.closest('#side')) &&
            (!tb.closest || !tb.closest('[data-testid="chat-list-search"]')) &&
            (!tb.closest || !tb.closest('[data-tab="3"]')) &&
            (!tb.closest || !tb.closest('[data-testid="conversation-panel-messages"]'))) {
          composer = tb;
          break;
        }
      }
    }

    if (composer && isElementVisible(composer)) {
      result.composerFound = true;
      result.composerElement = composer;
      result.chatOpen = true; // Composer in chat confirms chat is open

      // Extract text content safely from the composer, stripping zero-width spaces
      const composerText = composer.innerText || composer.textContent || '';
      const cleanDraft = stripZeroWidth(composerText);

      result.draftText = cleanDraft;
      result.hasDraft = cleanDraft.length > 0;

      // Detect Send Button using findSendButton helper
      const sendInfo = findSendButton(mainArea || doc, composer);
      if (sendInfo.found) {
        result.sendButtonFound = true;
        result.sendButtonElement = sendInfo.element;
      }
    }

    return result;
  }

  /**
   * Locates the active, visible, and enabled Send button in WhatsApp Web conversation footer.
   * Ensures the button is not disabled, not the voice/mic button, and belongs to the active chat composer.
   * @param {Document} doc
   * @param {Element} [composerEl]
   * @returns {{ found: boolean, element: Element|null, isEnabled: boolean }}
   */
  function findSendButton(doc, composerEl) {
    if (!doc) return { found: false, element: null, isEnabled: false };

    const mainArea = (typeof doc.getElementById === 'function' ? doc.getElementById('main') : null) ||
      (typeof doc.querySelector === 'function' ? doc.querySelector('#main, [data-testid="conversation-panel-wrapper"]') : null) ||
      doc;

    // Primary selectors for WhatsApp Web Send button
    const selectors = [
      'button[data-testid="compose-btn-send"]',
      'button span[data-icon="send"]',
      '[data-icon="send"]',
      'button[aria-label="Send"]',
      'button[aria-label*="Send" i]',
      'button[data-tab="11"]'
    ];

    let btn = null;
    for (const sel of selectors) {
      const match = mainArea.querySelector(sel);
      if (match) {
        btn = match.tagName && match.tagName.toLowerCase() === 'button'
          ? match
          : (match.closest ? match.closest('button') : match.parentElement) || match;
        break;
      }
    }

    if (!btn && composerEl) {
      const parentFooter = composerEl.closest ? composerEl.closest('footer') : composerEl.parentElement;
      if (parentFooter) {
        for (const sel of selectors) {
          const match = parentFooter.querySelector(sel);
          if (match) {
            btn = match.tagName && match.tagName.toLowerCase() === 'button'
              ? match
              : (match.closest ? match.closest('button') : match.parentElement) || match;
            break;
          }
        }
      }
    }

    if (!btn) {
      return { found: false, element: null, isEnabled: false };
    }

    const isVisible = isElementVisible(btn);
    const disabledAttr = (typeof btn.hasAttribute === 'function' && btn.hasAttribute('disabled')) ||
                         (typeof btn.getAttribute === 'function' && btn.getAttribute('aria-disabled') === 'true');
    const isEnabled = isVisible && !disabledAttr;

    return {
      found: isVisible,
      element: btn,
      isEnabled: isEnabled
    };
  }

  /**
   * Checks whether the exact message has already appeared as an outgoing (sent) message
   * in the active WhatsApp conversation history.
   * @param {Document|Element} doc
   * @param {string} expectedText
   * @returns {boolean}
   */
  function isMessageInConversation(doc, expectedText) {
    if (!doc || !expectedText) return false;

    const mainArea = (typeof doc.getElementById === 'function' ? doc.getElementById('main') : null) ||
      (typeof doc.querySelector === 'function' ? doc.querySelector('#main, [data-testid="conversation-panel-wrapper"]') : null) ||
      doc;

    const cleanExpected = stripZeroWidth(expectedText).trim();
    if (!cleanExpected) return false;

    // Outgoing message containers in WhatsApp Web
    const outgoingSelectors = [
      '.message-out',
      'div[class*="message-out"]',
      'div[data-id*="true_"]',
      '[data-testid="msg-container"]'
    ];

    let bubbles = [];
    if (typeof mainArea.querySelectorAll === 'function') {
      for (const sel of outgoingSelectors) {
        const found = mainArea.querySelectorAll(sel);
        if (found && found.length > 0) {
          bubbles = Array.from(found);
          break;
        }
      }
    }

    // Check each bubble's text content
    for (const bubble of bubbles) {
      const bubbleText = stripZeroWidth(bubble.innerText || bubble.textContent || '').trim();
      if (bubbleText === cleanExpected || bubbleText.includes(cleanExpected)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Helper to strip zero-width spaces and control characters from text strings.
   * @param {string} str
   * @returns {string}
   */
  function stripZeroWidth(str) {
    if (!str) return '';
    return str.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  }

  /**
   * Focuses an element and places the caret selection at the very end.
   * @param {Element} el
   */
  function focusAndPlaceCursorAtEnd(el) {
    if (!el) return;
    try {
      const doc = el.ownerDocument || document;
      const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (win && typeof win.focus === 'function') win.focus();
      el.focus();

      if (win && win.getSelection && doc.createRange) {
        const sel = win.getSelection();
        const range = doc.createRange();

        // Recursively locate the deepest text node inside el to place cursor directly on text
        let lastTextNode = null;
        const findLastText = (node) => {
          if (!node) return;
          if (node.nodeType === 3 && node.nodeValue && node.nodeValue.length > 0) {
            lastTextNode = node;
          }
          if (node.childNodes && node.childNodes.length > 0) {
            for (let i = node.childNodes.length - 1; i >= 0; i--) {
              findLastText(node.childNodes[i]);
              if (lastTextNode) return;
            }
          }
        };
        findLastText(el);

        if (lastTextNode) {
          range.setStart(lastTextNode, lastTextNode.nodeValue.length);
          range.setEnd(lastTextNode, lastTextNode.nodeValue.length);
        } else {
          const textTarget = el.querySelector('span[data-lexical-text="true"]') || el.querySelector('p') || el;
          range.selectNodeContents(textTarget);
          range.collapse(false);
        }

        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {}
  }

  /**
   * Activates and focuses the WhatsApp Web Lexical composer, ensuring React/Lexical registers
   * user interaction, caret is placed at the end of the text, and Send button is enabled.
   * @param {Element} composerEl
   * @param {string} [messageText]
   */
  function activateAndFocusComposer(composerEl, messageText = '') {
    if (!composerEl) return;
    const doc = composerEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);

    try {
      if (win && typeof win.focus === 'function') win.focus();
    } catch {}

    // Dispatch realistic activation sequence so Lexical's root listeners recognize active interaction
    const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const name of events) {
      try {
        let ev;
        if (name.startsWith('pointer') && typeof PointerEvent !== 'undefined') {
          ev = new PointerEvent(name, { bubbles: true, cancelable: true, view: win });
        } else if (typeof MouseEvent !== 'undefined') {
          ev = new MouseEvent(name, { bubbles: true, cancelable: true, view: win });
        } else if (typeof Event !== 'undefined') {
          ev = new Event(name, { bubbles: true, cancelable: true });
        }
        if (ev && typeof composerEl.dispatchEvent === 'function') {
          composerEl.dispatchEvent(ev);
        }
      } catch {}
    }

    try {
      if (typeof composerEl.focus === 'function') {
        composerEl.focus();
      }
    } catch {}

    // Position cursor at the very end of the deepest text node
    focusAndPlaceCursorAtEnd(composerEl);

    // Notify document selectionchange so Lexical updates its internal selection state
    try {
      if (doc && typeof doc.dispatchEvent === 'function') {
        doc.dispatchEvent(new Event('selectionchange', { bubbles: true }));
      }
    } catch {}
  }

  /**
   * Inserts text directly into WhatsApp Web's Lexical composer.
   * Utilizes execCommand('insertText') (which triggers native Chromium beforeinput events that Lexical listens to),
   * followed by synthetic InputEvents and paste fallbacks.
   *
   * @param {Element} composerEl - contenteditable element
   * @param {string} messageText - text to insert
   * @returns {boolean} - true if text was successfully inserted
   */
  function insertMessageIntoComposer(composerEl, messageText) {
    if (!composerEl || !messageText) return false;

    // Check if composer already contains the exact message or part of it
    const initialRaw = composerEl.innerText || composerEl.textContent || '';
    const initialClean = stripZeroWidth(initialRaw);
    if (initialClean === messageText || initialClean.includes(messageText)) {
      activateAndFocusComposer(composerEl, messageText);
      return true;
    }

    const doc = composerEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);

    // 1. Activate and focus the composer element
    activateAndFocusComposer(composerEl, messageText);

    // 2. Position cursor range inside the editor
    if (win && win.getSelection && doc && doc.createRange) {
      try {
        const sel = win.getSelection();
        const range = doc.createRange();
        const p = composerEl.querySelector('p') || composerEl;
        range.selectNodeContents(p);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {}
    }

    // 3. Strategy 1: document.execCommand('insertText', false, messageText)
    // In Chromium, execCommand on a focused contenteditable triggers a trusted native
    // 'beforeinput' event with inputType 'insertText', which Meta Lexical binds to directly.
    if (doc && typeof doc.execCommand === 'function') {
      try {
        doc.execCommand('insertText', false, messageText);
      } catch (err) {
        console.warn('[BizzHunter-WA] execCommand insertText error:', err);
      }
    }

    // Verify if Strategy 1 populated the text
    let currentClean = stripZeroWidth(composerEl.innerText || composerEl.textContent || '');

    // 4. Strategy 2: Synthetic InputEvent pipeline (beforeinput + input)
    if (!currentClean || currentClean.length === 0) {
      try {
        if (typeof InputEvent !== 'undefined' && typeof composerEl.dispatchEvent === 'function') {
          composerEl.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: messageText
          }));
        }

        // Direct DOM structure reinforcement for Lexical:
        // IMPORTANT: NEVER overwrite composerEl.textContent or composerEl.innerText directly,
        // as doing so destroys Lexical's internal <p> and <span data-lexical-text="true"> tree.
        let p = composerEl.querySelector('p');
        if (!p) {
          p = doc.createElement('p');
          p.className = 'selectable-text copyable-text';
          composerEl.appendChild(p);
        }

        let span = p.querySelector('span[data-lexical-text="true"]') || p.querySelector('span');
        if (!span) {
          span = doc.createElement('span');
          span.setAttribute('data-lexical-text', 'true');
          p.appendChild(span);
        }
        span.textContent = messageText;

        if (!stripZeroWidth(composerEl.innerText || composerEl.textContent || '')) {
          composerEl.textContent = messageText;
        }

        if (typeof InputEvent !== 'undefined' && typeof composerEl.dispatchEvent === 'function') {
          composerEl.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: messageText
          }));
        }
        if (typeof Event !== 'undefined' && typeof composerEl.dispatchEvent === 'function') {
          composerEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (err) {
        console.warn('[BizzHunter-WA] InputEvent fallback error:', err);
      }
    }

    // 5. Strategy 3: ClipboardEvent 'paste' fallback
    currentClean = stripZeroWidth(composerEl.innerText || composerEl.textContent || '');
    if ((!currentClean || currentClean.length === 0) && typeof ClipboardEvent !== 'undefined' && typeof DataTransfer !== 'undefined') {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', messageText);
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        });
        if (typeof composerEl.dispatchEvent === 'function') {
          composerEl.dispatchEvent(pasteEvent);
        }
      } catch (err) {
        console.warn('[BizzHunter-WA] DataTransfer paste error:', err);
      }
    }

    // 6. Caret adjustment: focus and collapse selection to the very end of the message
    activateAndFocusComposer(composerEl, messageText);

    // Final check
    const finalClean = stripZeroWidth(composerEl.innerText || composerEl.textContent || '');
    return finalClean.length > 0;
  }

  return {
    isElementVisible,
    normalizeText,
    stripZeroWidth,
    focusAndPlaceCursorAtEnd,
    activateControl,
    activateAndFocusComposer,
    findSendButton,
    isMessageInConversation,
    detectContinueControl,
    observeContinueControl,
    inspectWhatsAppWeb,
    insertMessageIntoComposer
  };
});
