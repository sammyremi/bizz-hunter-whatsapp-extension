/**
 * Bizz-Hunter WhatsApp Assistant - Background Service Worker (Manifest V3)
 * Manages task state machine, tab lifecycle, alarms, and cross-component messaging.
 * Resilient against service worker suspension via chrome.storage.local and chrome.alarms.
 */

// Import shared utilities into service worker scope
importScripts('../shared/constants.js', '../shared/url_parser.js');

const { TaskStatus, MessageType, StorageKey, AlarmPrefix, DefaultSettings, Endpoints } = BH;

/**
 * Storage Helper - Reads full extension state from chrome.storage.local
 */
async function getState() {
  const data = await chrome.storage.local.get([
    StorageKey.TASKS,
    StorageKey.ACTIVE_TASK_ID,
    StorageKey.SETTINGS,
    StorageKey.STATS
  ]);

  return {
    tasks: data[StorageKey.TASKS] || {},
    activeTaskId: data[StorageKey.ACTIVE_TASK_ID] || null,
    settings: Object.assign({}, DefaultSettings, data[StorageKey.SETTINGS] || {}),
    stats: data[StorageKey.STATS] || { totalDetected: 0, totalCompleted: 0, totalFailed: 0 }
  };
}

/**
 * Storage Helper - Persists updated state to chrome.storage.local
 */
async function saveState(partialState) {
  const payload = {};
  if (partialState.tasks !== undefined) payload[StorageKey.TASKS] = partialState.tasks;
  if (partialState.activeTaskId !== undefined) payload[StorageKey.ACTIVE_TASK_ID] = partialState.activeTaskId;
  if (partialState.settings !== undefined) payload[StorageKey.SETTINGS] = partialState.settings;
  if (partialState.stats !== undefined) payload[StorageKey.STATS] = partialState.stats;

  await chrome.storage.local.set(payload);
}

/**
 * Update a specific task by ID and sync storage
 */
async function updateTask(taskId, updates) {
  const state = await getState();
  const task = state.tasks[taskId];
  if (!task) return null;

  const updatedTask = Object.assign({}, task, updates, {
    updatedAt: Date.now()
  });

  state.tasks[taskId] = updatedTask;
  await saveState({ tasks: state.tasks });
  return updatedTask;
}

/**
 * Generate a unique task ID from phone and timestamp
 */
function createTaskId(phone) {
  return `task_${phone}_${Date.now()}`;
}

// ============================================================================
// Service Worker Lifecycle & Initialization
// ============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[BizzHunter-WA] Extension installed/updated: ${details.reason}`);
  const state = await getState();
  // Ensure default settings are saved
  await saveState({
    settings: state.settings,
    stats: state.stats
  });
});

// ============================================================================
// Tab Lifecycle & Event Listeners
// ============================================================================

/**
 * Monitor tab updates to detect WhatsApp Send URLs and WhatsApp Web tabs
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only inspect when URL changes or status is loading/complete
  const url = changeInfo.url || tab.url;
  if (!url) return;

  const state = await getState();
  if (state.settings.isPaused) return;

  // 1. Check if this is a WhatsApp Send URL (api.whatsapp.com/send/)
  const urlInfo = BH.parseWhatsAppUrl(url);
  if (urlInfo.isValid && urlInfo.isSendEndpoint) {
    await handleSendPageUrlDetected(tabId, url, urlInfo);
    return;
  }

  // 2. Check if this is a WhatsApp Web tab (web.whatsapp.com)
  if (BH.isWhatsAppWebUrl(url)) {
    await handleWhatsAppWebTabDetected(tabId, url);
    return;
  }
});

/**
 * Monitor tab removal to clean up task state safely without touching unrelated tabs
 */
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const state = await getState();
  let modified = false;

  for (const taskId of Object.keys(state.tasks)) {
    const task = state.tasks[taskId];

    // If the send tab was closed
    if (task.sendTabId === tabId) {
      task.sendTabClosed = true;
      modified = true;
      console.log(`[BizzHunter-WA] Send tab ${tabId} closed for task ${taskId}`);
    }

    // If the WhatsApp Web tab was closed
    if (task.webTabId === tabId) {
      task.webTabClosed = true;
      modified = true;
      console.log(`[BizzHunter-WA] Web tab ${tabId} closed for task ${taskId}`);

      // Clear any pending alarms for this task
      await chrome.alarms.clear(`${AlarmPrefix.READINESS}${taskId}`);
      await chrome.alarms.clear(`${AlarmPrefix.CLEANUP}${taskId}`);

      if (task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.FAILED) {
        task.status = TaskStatus.FAILED;
        task.errorMessage = 'WhatsApp Web tab was closed before completion';
      }
    }
  }

  if (modified) {
    await saveState({ tasks: state.tasks });
  }
});

// ============================================================================
// Workflow Handlers
// ============================================================================

/**
 * Handle detection of api.whatsapp.com/send/ URL
 */
async function handleSendPageUrlDetected(tabId, url, urlInfo) {
  const state = await getState();

  // Idempotency: Check if an active task already exists for this tab and phone
  const existingTaskId = Object.keys(state.tasks).find(id => {
    const t = state.tasks[id];
    return t.sendTabId === tabId && t.phoneNormalized === urlInfo.phoneNormalized;
  });

  if (existingTaskId) {
    // Task already exists, do not duplicate
    return;
  }

  // Create new Task
  const taskId = createTaskId(urlInfo.phoneNormalized);
  const newTask = {
    id: taskId,
    status: TaskStatus.LINK_DETECTED,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sendTabId: tabId,
    sendUrl: url,
    phone: urlInfo.phone,
    phoneNormalized: urlInfo.phoneNormalized,
    phoneMasked: urlInfo.phoneMasked,
    messageText: urlInfo.text || '',
    expectedTextLength: urlInfo.textSummary.length,
    expectedTextSnippet: urlInfo.textSummary.snippet,
    continueControlDetected: false,
    continueControlReady: false,
    continueControlText: '',
    continueDestinationUrl: '',
    webTabId: null,
    webUrl: '',
    chatDetected: false,
    chatRecipient: '',
    recipientVerified: false,
    composerFound: false,
    hasDraft: false,
    draftSnippet: '',
    readyAt: null,
    errorMessage: null,
    completedAt: null
  };

  state.tasks[taskId] = newTask;
  state.activeTaskId = taskId;
  state.stats.totalDetected += 1;

  await saveState({
    tasks: state.tasks,
    activeTaskId: taskId,
    stats: state.stats
  });

  const pendingSync = {};
  if (urlInfo.text) pendingSync[StorageKey.PENDING_MESSAGE_TEXT] = urlInfo.text;
  if (urlInfo.phoneNormalized) pendingSync[StorageKey.PENDING_PHONE] = urlInfo.phoneNormalized;
  if (Object.keys(pendingSync).length > 0) {
    await chrome.storage.local.set(pendingSync);
  }

  console.log(`[BizzHunter-WA] New task initialized: ${taskId} for ${urlInfo.phoneMasked}`);
}

/**
 * Handle detection of a web.whatsapp.com tab
 */
async function handleWhatsAppWebTabDetected(tabId, url) {
  const state = await getState();
  const activeTask = state.activeTaskId ? state.tasks[state.activeTaskId] : null;

  if (!activeTask) return;

  // If active task is waiting for WhatsApp Web or on Continue page
  if (activeTask.webTabId === null || activeTask.webTabId === tabId) {
    activeTask.webTabId = tabId;
    activeTask.webUrl = url;

    if (activeTask.status === TaskStatus.CONTINUE_DETECTED ||
        activeTask.status === TaskStatus.WAITING_FOR_WEB ||
        activeTask.status === TaskStatus.LINK_DETECTED) {
      activeTask.status = TaskStatus.WAITING_FOR_WEB;
    }

    await saveState({ tasks: state.tasks });
    console.log(`[BizzHunter-WA] Linked Web tab ${tabId} to active task ${activeTask.id}`);
  }
}

// ============================================================================
// Message Router (Content Scripts & Popup Communication)
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  handleMessage(type, payload, sender)
    .then(res => sendResponse(res))
    .catch(err => {
      console.error(`[BizzHunter-WA] Error handling message ${type}:`, err);
      sendResponse({ success: false, error: err.message });
    });

  return true; // Keep message channel open for async response
});

async function handleMessage(type, payload, sender) {
  const state = await getState();
  const senderTabId = sender && sender.tab ? sender.tab.id : null;

  switch (type) {
    // 1. Content Script: Send Page Detected
    case MessageType.SEND_PAGE_DETECTED: {
      const { phoneNormalized, messageText, phone, phoneMasked, textLength, textSnippet, url } = payload;
      let task = Object.values(state.tasks).find(t => t.sendTabId === senderTabId);
      if (!task) {
        const taskId = createTaskId(phoneNormalized || phone || 'detected');
        task = {
          id: taskId,
          status: TaskStatus.LINK_DETECTED,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sendTabId: senderTabId,
          sendUrl: url || '',
          phone: phone || '',
          phoneNormalized: phoneNormalized || '',
          phoneMasked: phoneMasked || '',
          messageText: messageText || '',
          expectedTextLength: textLength || (messageText ? messageText.length : 0),
          expectedTextSnippet: textSnippet || '',
          continueControlDetected: false,
          continueControlReady: false,
          continueControlText: '',
          continueDestinationUrl: '',
          webTabId: null,
          webUrl: '',
          chatDetected: false,
          chatRecipient: '',
          recipientVerified: false,
          composerFound: false,
          hasDraft: false,
          draftSnippet: '',
          readyAt: null,
          errorMessage: null,
          completedAt: null
        };
        state.tasks[taskId] = task;
        state.activeTaskId = taskId;
        state.stats.totalDetected += 1;
      } else {
        task.status = TaskStatus.LINK_DETECTED;
        if (messageText) {
          task.messageText = messageText;
        }
      }

      await saveState({ tasks: state.tasks, activeTaskId: state.activeTaskId, stats: state.stats });

      const pendingSync = {};
      if (messageText) pendingSync[StorageKey.PENDING_MESSAGE_TEXT] = messageText;
      if (phoneNormalized) pendingSync[StorageKey.PENDING_PHONE] = phoneNormalized;
      if (Object.keys(pendingSync).length > 0) {
        await chrome.storage.local.set(pendingSync);
      }

      return { success: true };
    }

    // 2. Content Script: Continue Page Element Status
    case MessageType.CONTINUE_PAGE_STATUS: {
      let task = Object.values(state.tasks).find(t => t.sendTabId === senderTabId) ||
                 (state.activeTaskId ? state.tasks[state.activeTaskId] : null);

      if (task) {
        task.continueControlDetected = payload.found;
        task.continueControlReady = payload.isReady;
        task.continueControlText = payload.visibleText || '';
        task.continueDestinationUrl = payload.destinationUrl || '';

        if (payload.found) {
          if (payload.autoTriggered) {
            task.status = TaskStatus.WAITING_FOR_WEB;
          } else if (task.status === TaskStatus.LINK_DETECTED) {
            task.status = TaskStatus.CONTINUE_DETECTED;
          }
        }

        await saveState({ tasks: state.tasks });
      }
      return { success: true };
    }

    // 2b. Content Script: Open detected Continue destination in a new tab
    case MessageType.ENSURE_WEB_NAVIGATION: {
      let task = Object.values(state.tasks).find(t => t.sendTabId === senderTabId) ||
                 (state.activeTaskId ? state.tasks[state.activeTaskId] : null);

      if (!task) return { success: false, reason: 'No matching task' };

      // If WhatsApp Web tab is already opened and registered, prevent duplicate tabs
      if (task.webTabId) {
        return { success: true, alreadyLinked: true };
      }

      let destUrl = payload.destinationUrl || task.continueDestinationUrl || 'https://web.whatsapp.com/';
      if (destUrl.startsWith('//')) {
        destUrl = `https:${destUrl}`;
      } else if (!destUrl.startsWith('http://') && !destUrl.startsWith('https://')) {
        try {
          destUrl = new URL(destUrl, 'https://web.whatsapp.com').href;
        } catch {
          destUrl = 'https://web.whatsapp.com/';
        }
      }

      console.log(`[BizzHunter-WA] Opening detected Continue destination in new tab: ${destUrl}`);
      const newTab = await chrome.tabs.create({ url: destUrl, active: true });
      task.webTabId = newTab.id;
      task.webUrl = destUrl;
      task.status = TaskStatus.WAITING_FOR_WEB;
      await saveState({ tasks: state.tasks });
      return { success: true, createdTabId: newTab.id };
    }

    // 3. Content Script: WhatsApp Web Page Detected
    case MessageType.WEB_PAGE_DETECTED: {
      let task = state.activeTaskId ? state.tasks[state.activeTaskId] : null;
      if (task) {
        task.webTabId = senderTabId;
        task.webUrl = payload.url;
        await saveState({ tasks: state.tasks });
      }
      return { success: true };
    }

    // 4. Content Script: WhatsApp Web Chat Status Update
    case MessageType.WEB_CHAT_STATUS: {
      let task = Object.values(state.tasks).find(t => t.webTabId === senderTabId) ||
                 (state.activeTaskId ? state.tasks[state.activeTaskId] : null);

      if (!task) return { success: false, reason: 'No matching task' };

      task.chatDetected = payload.chatOpen;
      task.chatRecipient = payload.recipientText || '';
      task.composerFound = payload.composerFound;
      task.hasDraft = payload.hasDraft;
      task.draftSnippet = payload.draftSnippet || '';

      // Match recipient
      if (payload.recipientVerified !== undefined) {
        task.recipientVerified = payload.recipientVerified;
      } else if (task.phoneNormalized && payload.recipientText) {
        const cleanRec = payload.recipientText.replace(/[^0-9]/g, '');
        const cleanExpected = task.phoneNormalized;
        task.recipientVerified = cleanRec.length >= 7 &&
          (cleanRec.endsWith(cleanExpected.slice(-7)) || cleanExpected.endsWith(cleanRec.slice(-7)));
      }

      // State progression
      if (payload.chatOpen && !task.hasDraft) {
        task.status = TaskStatus.WAITING_FOR_DRAFT;
      } else if (payload.chatOpen && task.hasDraft) {
        // Chat and draft are both present!
        // Start readiness safeguard timer if not already scheduled
        if (task.status !== TaskStatus.READY_FOR_ACTION &&
            task.status !== TaskStatus.COMPLETED &&
            !task.readyAt) {

          const delaySec = state.settings.readinessDelaySeconds || 12;
          task.readyAt = Date.now() + (delaySec * 1000);
          task.status = TaskStatus.VERIFYING_RECIPIENT;

          // Create an MV3 alarm for readiness
          await chrome.alarms.create(`${AlarmPrefix.READINESS}${task.id}`, {
            when: task.readyAt
          });

          console.log(`[BizzHunter-WA] Readiness timer started: ${delaySec}s for task ${task.id}`);
        }
      }

      await saveState({ tasks: state.tasks });
      return { success: true };
    }

    // 5. Content Script: Invalid Number Reported
    case MessageType.WEB_INVALID_NUMBER: {
      let task = Object.values(state.tasks).find(t => t.webTabId === senderTabId) ||
                 (state.activeTaskId ? state.tasks[state.activeTaskId] : null);

      if (task) {
        task.status = TaskStatus.FAILED;
        task.errorMessage = payload.message || 'Phone number is invalid or not registered on WhatsApp';
        state.stats.totalFailed += 1;
        await saveState({ tasks: state.tasks, stats: state.stats });
      }
      return { success: true };
    }

    // 6. User Action: Trigger Continue Action from Popup
    case MessageType.TRIGGER_CONTINUE_ACTION: {
      const task = state.activeTaskId ? state.tasks[state.activeTaskId] : null;
      if (!task || !task.sendTabId) {
        return { success: false, error: 'No active send tab found' };
      }

      task.status = TaskStatus.WAITING_FOR_WEB;
      await saveState({ tasks: state.tasks });

      // Send execute message to send page content script
      try {
        const response = await chrome.tabs.sendMessage(task.sendTabId, {
          type: MessageType.EXECUTE_CONTINUE_CLICK
        });
        return response;
      } catch (err) {
        // If content script direct messaging fails, open destination or fallback navigation
        if (task.continueDestinationUrl && task.continueDestinationUrl.startsWith('https://web.whatsapp.com')) {
          let destUrl = task.continueDestinationUrl;
          if (task.messageText && !destUrl.includes('text=')) {
            const sep = destUrl.includes('?') ? '&' : '?';
            destUrl = `${destUrl}${sep}text=${encodeURIComponent(task.messageText)}`;
          }
          const newTab = await chrome.tabs.create({ url: destUrl });
          task.webTabId = newTab.id;
          task.webUrl = destUrl;
          await saveState({ tasks: state.tasks });
          return { success: true, message: 'Opened WhatsApp Web tab directly' };
        }
        return { success: false, error: err.message };
      }
    }

    // 7. User Action: Trigger Send Action from Popup
    case MessageType.TRIGGER_SEND_ACTION: {
      const task = state.activeTaskId ? state.tasks[state.activeTaskId] : null;
      if (!task || !task.webTabId) {
        return { success: false, error: 'No active WhatsApp Web tab found' };
      }

      try {
        const response = await chrome.tabs.sendMessage(task.webTabId, {
          type: MessageType.EXECUTE_SEND_CLICK
        });

        if (response && response.success) {
          task.status = TaskStatus.COMPLETED;
          task.completedAt = Date.now();
          state.stats.totalCompleted += 1;
          await saveState({ tasks: state.tasks, stats: state.stats });

          // Handle automatic tab cleanup if enabled
          if (state.settings.autoCleanupEnabled) {
            const delaySec = state.settings.cleanupDelaySeconds || 5;
            await chrome.alarms.create(`${AlarmPrefix.CLEANUP}${task.id}`, {
              delayInMinutes: delaySec / 60
            });
            console.log(`[BizzHunter-WA] Cleanup scheduled in ${delaySec}s for task ${task.id}`);
          }
        }
        return response;
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // 8. User Action: Pause / Resume
    case MessageType.PAUSE_RESUME: {
      state.settings.isPaused = !state.settings.isPaused;
      if (state.activeTaskId && state.tasks[state.activeTaskId]) {
        state.tasks[state.activeTaskId].status = state.settings.isPaused
          ? TaskStatus.PAUSED
          : TaskStatus.LINK_DETECTED;
      }
      await saveState({ settings: state.settings, tasks: state.tasks });
      return { success: true, isPaused: state.settings.isPaused };
    }

    // 9. User Action: Update Settings
    case MessageType.UPDATE_SETTINGS: {
      const newSettings = Object.assign({}, state.settings, payload);
      await saveState({ settings: newSettings });
      return { success: true, settings: newSettings };
    }

    // 10. User Action: Reset Stale Task State safely
    case MessageType.RESET_TASK_STATE: {
      // Clear all active alarms
      const allAlarms = await chrome.alarms.getAll();
      for (const alarm of allAlarms) {
        if (alarm.name.startsWith(AlarmPrefix.READINESS) || alarm.name.startsWith(AlarmPrefix.CLEANUP)) {
          await chrome.alarms.clear(alarm.name);
        }
      }

      // Reset tasks
      await saveState({
        tasks: {},
        activeTaskId: null
      });

      console.log('[BizzHunter-WA] Stale task state cleared by user');
      return { success: true };
    }

    // 11. Popup: Focus Specific Tab
    case MessageType.FOCUS_TAB: {
      const { tabId } = payload;
      if (tabId) {
        await chrome.tabs.update(tabId, { active: true });
        const tab = await chrome.tabs.get(tabId);
        if (tab && tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
      }
      return { success: true };
    }

    // 12. Query Full Extension State
    case MessageType.GET_EXTENSION_STATE: {
      // Return fresh state
      return { success: true, state };
    }

    default:
      return { success: false, error: `Unhandled message type: ${type}` };
  }
}

// ============================================================================
// Alarm Handler (Readiness safeguards and Tab Cleanup)
// ============================================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const state = await getState();

  // 1. Readiness Alarm
  if (alarm.name.startsWith(AlarmPrefix.READINESS)) {
    const taskId = alarm.name.replace(AlarmPrefix.READINESS, '');
    const task = state.tasks[taskId];
    if (task && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.FAILED) {
      task.status = TaskStatus.READY_FOR_ACTION;
      await saveState({ tasks: state.tasks });
      console.log(`[BizzHunter-WA] Task ${taskId} is now READY_FOR_ACTION`);
    }
  }

  // 2. Tab Cleanup Alarm
  if (alarm.name.startsWith(AlarmPrefix.CLEANUP)) {
    const taskId = alarm.name.replace(AlarmPrefix.CLEANUP, '');
    const task = state.tasks[taskId];

    if (task && task.status === TaskStatus.COMPLETED && state.settings.autoCleanupEnabled) {
      console.log(`[BizzHunter-WA] Executing safe tab cleanup for completed task ${taskId}`);

      const tabsToClose = [];
      if (task.sendTabId) tabsToClose.push(task.sendTabId);
      if (task.webTabId) tabsToClose.push(task.webTabId);

      for (const tid of tabsToClose) {
        try {
          await chrome.tabs.remove(tid);
          console.log(`[BizzHunter-WA] Closed task tab ${tid}`);
        } catch {
          // Tab may have already been closed by user
        }
      }
    }
  }
});
