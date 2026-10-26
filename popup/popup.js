/**
 * Bizz-Hunter WhatsApp Assistant - Popup Controller
 * Renders real-time extension state without manual refresh.
 * Listens to chrome.storage.onChanged and coordinates user-triggered actions.
 */
(function () {
  'use strict';

  // DOM Elements
  const statusBanner = document.getElementById('statusBanner');
  const statusDot = document.getElementById('statusDot');
  const statusLabel = document.getElementById('statusLabel');
  const matchingTabsBadge = document.getElementById('matchingTabsBadge');

  const pauseResumeBtn = document.getElementById('pauseResumeBtn');
  const pauseIcon = document.getElementById('pauseIcon');

  const errorBox = document.getElementById('errorBox');
  const errorMessage = document.getElementById('errorMessage');
  const dismissErrorBtn = document.getElementById('dismissErrorBtn');

  const taskIdBadge = document.getElementById('taskIdBadge');
  const taskRecipient = document.getElementById('taskRecipient');
  const taskDraftPreview = document.getElementById('taskDraftPreview');
  const taskContinueState = document.getElementById('taskContinueState');
  const taskChatState = document.getElementById('taskChatState');

  const readinessProgressArea = document.getElementById('readinessProgressArea');
  const countdownTimer = document.getElementById('countdownTimer');
  const progressBar = document.getElementById('progressBar');

  const btnContinueAction = document.getElementById('btnContinueAction');
  const btnSendAction = document.getElementById('btnSendAction');
  const btnFocusWebTab = document.getElementById('btnFocusWebTab');

  const toggleSettingsBtn = document.getElementById('toggleSettingsBtn');
  const settingsBody = document.getElementById('settingsBody');
  const autoContinueToggle = document.getElementById('autoContinueToggle');
  const autoContinueHint = document.getElementById('autoContinueHint');
  const autoSendToggle = document.getElementById('autoSendToggle');
  const autoSendHint = document.getElementById('autoSendHint');
  const sendDelayRow = document.getElementById('sendDelayRow');
  const sendDelayInput = document.getElementById('sendDelayInput');
  const readinessDelayInput = document.getElementById('readinessDelayInput');
  const autoCleanupToggle = document.getElementById('autoCleanupToggle');
  const cleanupDelayRow = document.getElementById('cleanupDelayRow');
  const cleanupDelayInput = document.getElementById('cleanupDelayInput');
  const btnResetState = document.getElementById('btnResetState');

  const statDetected = document.getElementById('statDetected');
  const statCompleted = document.getElementById('statCompleted');
  const statFailed = document.getElementById('statFailed');

  let countdownInterval = null;
  let currentActiveTask = null;

  // ============================================================================
  // Initialization & Live Storage Listeners
  // ============================================================================

  async function init() {
    setupEventListeners();
    await refreshState();
    await updateMatchingTabsCount();
  }

  /**
   * Listen to storage changes to ensure popup updates automatically without manual refresh.
   */
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      refreshState();
      updateMatchingTabsCount();
    }
  });

  /**
   * Reads full state from local storage and updates UI components.
   */
  async function refreshState() {
    try {
      const data = await chrome.storage.local.get([
        BH.StorageKey.TASKS,
        BH.StorageKey.ACTIVE_TASK_ID,
        BH.StorageKey.SETTINGS,
        BH.StorageKey.STATS
      ]);

      const tasks = data[BH.StorageKey.TASKS] || {};
      const activeTaskId = data[BH.StorageKey.ACTIVE_TASK_ID] || null;
      const settings = Object.assign({}, BH.DefaultSettings, data[BH.StorageKey.SETTINGS] || {});
      const stats = data[BH.StorageKey.STATS] || { totalDetected: 0, totalCompleted: 0, totalFailed: 0 };

      renderSettings(settings);
      renderStats(stats);

      const activeTask = activeTaskId ? tasks[activeTaskId] : null;
      currentActiveTask = activeTask;
      renderTask(activeTask, settings);
    } catch (err) {
      console.error('[BizzHunter-WA] Failed to refresh popup state:', err);
    }
  }

  /**
   * Queries Chromium Tabs API for open WhatsApp send and web tabs.
   */
  async function updateMatchingTabsCount() {
    try {
      const tabs = await chrome.tabs.query({
        url: ['https://api.whatsapp.com/*', 'https://web.whatsapp.com/*']
      });
      matchingTabsBadge.textContent = `${tabs.length} Active Tab${tabs.length === 1 ? '' : 's'}`;
    } catch {
      matchingTabsBadge.textContent = '0 Tabs';
    }
  }

  // ============================================================================
  // Renderers
  // ============================================================================

  function renderStatusDot(status, isPaused) {
    statusDot.className = 'status-dot';

    if (isPaused) {
      statusDot.classList.add('paused');
      statusLabel.textContent = 'Paused';
      return;
    }

    statusLabel.textContent = status || 'Idle';

    switch (status) {
      case BH.TaskStatus.IDLE:
        statusDot.classList.add('idle');
        break;
      case BH.TaskStatus.LINK_DETECTED:
      case BH.TaskStatus.CONTINUE_DETECTED:
        statusDot.classList.add('active');
        break;
      case BH.TaskStatus.WAITING_FOR_WEB:
      case BH.TaskStatus.WAITING_FOR_DRAFT:
      case BH.TaskStatus.VERIFYING_RECIPIENT:
        statusDot.classList.add('waiting');
        break;
      case BH.TaskStatus.READY_FOR_ACTION:
      case BH.TaskStatus.COUNTDOWN_TO_SEND:
      case BH.TaskStatus.SENDING:
        statusDot.classList.add('ready');
        break;
      case BH.TaskStatus.COMPLETED:
      case BH.TaskStatus.SENT:
        statusDot.classList.add('completed');
        break;
      case BH.TaskStatus.SEND_STATUS_UNKNOWN:
      case BH.TaskStatus.FAILED:
        statusDot.classList.add('failed');
        break;
      default:
        statusDot.classList.add('idle');
    }
  }

  function renderTask(task, settings) {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    if (!task) {
      renderStatusDot(BH.TaskStatus.IDLE, settings.isPaused);
      taskIdBadge.textContent = 'None';
      taskRecipient.textContent = '—';
      taskDraftPreview.textContent = 'No active draft';
      setContinueStatus('Waiting', 'waiting');
      setChatStatus('Waiting', 'waiting');

      readinessProgressArea.style.display = 'none';
      btnContinueAction.disabled = true;
      btnSendAction.disabled = true;
      btnFocusWebTab.style.display = 'none';
      errorBox.style.display = 'none';
      return;
    }

    // Status Banner
    renderStatusDot(task.status, settings.isPaused);

    // Task Identifiers & Details
    taskIdBadge.textContent = task.id.substring(0, 16) + '...';
    taskRecipient.textContent = task.phoneMasked || 'Unknown';

    if (task.expectedTextLength > 0) {
      taskDraftPreview.textContent = `${task.expectedTextLength} chars: "${task.expectedTextSnippet}"`;
    } else {
      taskDraftPreview.textContent = 'No prefilled text';
    }

    // Continue Control State
    if (task.continueControlDetected) {
      if (task.status === BH.TaskStatus.WAITING_FOR_WEB) {
        setContinueStatus('Auto-advancing to Web...', 'ready');
      } else {
        const isAuto = settings.autoContinueEnabled !== false;
        setContinueStatus(
          task.continueControlReady
            ? (isAuto ? 'Auto-advancing...' : 'Ready to click (Manual Mode)')
            : 'Detected (loading)',
          task.continueControlReady ? 'ready' : 'waiting'
        );
      }
      btnContinueAction.disabled = !task.continueControlReady || settings.isPaused;
    } else {
      setContinueStatus('Searching...', 'waiting');
      btnContinueAction.disabled = true;
    }

    // Chat and Draft State
    if (task.chatDetected) {
      if (task.hasDraft) {
        setChatStatus(
          task.recipientVerified ? 'Verified & Draft ready' : 'Chat open (draft ready)',
          'ready'
        );
      } else {
        setChatStatus('Chat open, waiting for draft...', 'waiting');
      }
    } else if (task.webTabId) {
      setChatStatus('WhatsApp Web loading...', 'waiting');
    } else {
      setChatStatus('Waiting for web tab', 'waiting');
    }

    // Focus Web Tab button
    if (task.webTabId) {
      btnFocusWebTab.style.display = 'flex';
    } else {
      btnFocusWebTab.style.display = 'none';
    }

    // Readiness Safeguard / Auto-Send Countdown
    if (task.status === BH.TaskStatus.COUNTDOWN_TO_SEND) {
      readinessProgressArea.style.display = 'flex';
      const rem = task.autoSendCountdownRemaining !== undefined ? task.autoSendCountdownRemaining : 10;
      const total = settings.sendDelaySeconds || 10;
      countdownTimer.textContent = `Auto-sending in ${rem}s`;
      const percent = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
      progressBar.style.width = `${percent}%`;
    } else if (task.readyAt &&
               task.status !== BH.TaskStatus.COMPLETED &&
               task.status !== BH.TaskStatus.SENT &&
               task.status !== BH.TaskStatus.FAILED &&
               task.status !== BH.TaskStatus.SEND_STATUS_UNKNOWN) {
      readinessProgressArea.style.display = 'flex';
      setupReadinessCountdown(task, settings);
    } else {
      readinessProgressArea.style.display = 'none';
    }

    // Send Action Button
    if (task.status === BH.TaskStatus.READY_FOR_ACTION || task.status === BH.TaskStatus.COUNTDOWN_TO_SEND) {
      btnSendAction.disabled = settings.isPaused;
      btnContinueAction.disabled = true; // Continue already succeeded
      if (task.status === BH.TaskStatus.COUNTDOWN_TO_SEND) {
        btnSendAction.innerHTML = `<span>⏳</span> Auto-sending in ${task.autoSendCountdownRemaining !== undefined ? task.autoSendCountdownRemaining : 10}s (or click now)`;
      } else {
        btnSendAction.innerHTML = '<span>🚀</span> Send Verified Message';
      }
    } else if (task.status === BH.TaskStatus.COMPLETED || task.status === BH.TaskStatus.SENT) {
      btnSendAction.disabled = true;
      btnContinueAction.disabled = true;
      btnSendAction.innerHTML = '<span>✓</span> Message Sent';
    } else if (task.status === BH.TaskStatus.SEND_STATUS_UNKNOWN) {
      btnSendAction.disabled = true;
      btnContinueAction.disabled = true;
      btnSendAction.innerHTML = '<span>⚠️</span> Send Status Unknown';
    } else {
      btnSendAction.disabled = true;
      btnSendAction.innerHTML = '<span>🚀</span> Send Verified Message';
    }

    // Error Alert
    if (task.errorMessage) {
      errorBox.style.display = 'flex';
      errorMessage.textContent = task.errorMessage;
    } else {
      errorBox.style.display = 'none';
    }
  }

  function setContinueStatus(text, type) {
    taskContinueState.textContent = text;
    taskContinueState.className = `detail-value status-pill ${type}`;
  }

  function setChatStatus(text, type) {
    taskChatState.textContent = text;
    taskChatState.className = `detail-value status-pill ${type}`;
  }

  function setupReadinessCountdown(task, settings) {
    const totalDuration = (settings.readinessDelaySeconds || 12) * 1000;

    const updateTick = () => {
      const now = Date.now();
      const remainingMs = task.readyAt - now;

      if (remainingMs <= 0) {
        countdownTimer.textContent = 'Ready!';
        progressBar.style.width = '100%';
        if (countdownInterval) clearInterval(countdownInterval);
      } else {
        const remainingSec = Math.ceil(remainingMs / 1000);
        countdownTimer.textContent = `${remainingSec}s buffer`;
        const percent = Math.min(100, Math.max(0, ((totalDuration - remainingMs) / totalDuration) * 100));
        progressBar.style.width = `${percent}%`;
      }
    };

    updateTick();
    countdownInterval = setInterval(updateTick, 400);
  }

  function renderSettings(settings) {
    const isAuto = settings.autoContinueEnabled !== false;
    if (autoContinueToggle) {
      autoContinueToggle.checked = isAuto;
    }
    if (autoContinueHint) {
      autoContinueHint.textContent = isAuto
        ? 'Automatic (advance after 10s countdown)'
        : 'Manual (you click Continue whenever ready)';
    }

    const isAutoSend = settings.autoSendEnabled !== false;
    if (autoSendToggle) {
      autoSendToggle.checked = isAutoSend;
    }
    if (autoSendHint) {
      autoSendHint.textContent = isAutoSend
        ? 'Automatic (waits 10s then clicks Send)'
        : 'Manual (you click Send whenever ready)';
    }
    if (sendDelayInput) {
      sendDelayInput.value = settings.sendDelaySeconds || 10;
    }
    if (sendDelayRow) {
      sendDelayRow.style.display = isAutoSend ? 'flex' : 'none';
    }

    readinessDelayInput.value = settings.readinessDelaySeconds || 12;
    autoCleanupToggle.checked = Boolean(settings.autoCleanupEnabled);
    cleanupDelayInput.value = settings.cleanupDelaySeconds || 5;

    cleanupDelayRow.style.display = settings.autoCleanupEnabled ? 'flex' : 'none';

    pauseIcon.textContent = settings.isPaused ? '▶️' : '⏸️';
    pauseResumeBtn.title = settings.isPaused ? 'Resume Assistant' : 'Pause Assistant';
  }

  function renderStats(stats) {
    statDetected.textContent = stats.totalDetected || 0;
    statCompleted.textContent = stats.totalCompleted || 0;
    statFailed.textContent = stats.totalFailed || 0;
  }

  // ============================================================================
  // Event Listeners & User Actions
  // ============================================================================

  function setupEventListeners() {
    // 1. Continue Action Button
    btnContinueAction.addEventListener('click', async () => {
      btnContinueAction.disabled = true;
      btnContinueAction.innerHTML = '<span>⏳</span> Opening WhatsApp Web...';

      try {
        const res = await chrome.runtime.sendMessage({
          type: BH.MessageType.TRIGGER_CONTINUE_ACTION
        });
        if (!res || !res.success) {
          showUserError(res ? res.error : 'Failed to trigger continue action');
        }
      } catch (err) {
        showUserError(err.message);
      } finally {
        btnContinueAction.innerHTML = '<span>👉</span> Continue to WhatsApp Web';
        refreshState();
      }
    });

    // 2. Send Action Button
    btnSendAction.addEventListener('click', async () => {
      btnSendAction.disabled = true;
      btnSendAction.innerHTML = '<span>⏳</span> Sending message...';

      try {
        const res = await chrome.runtime.sendMessage({
          type: BH.MessageType.TRIGGER_SEND_ACTION
        });
        if (!res || !res.success) {
          showUserError(res ? res.error : 'Failed to send message');
        }
      } catch (err) {
        showUserError(err.message);
      } finally {
        btnSendAction.innerHTML = '<span>🚀</span> Send Verified Message';
        refreshState();
      }
    });

    // 3. Focus WhatsApp Web Tab
    btnFocusWebTab.addEventListener('click', async () => {
      if (currentActiveTask && currentActiveTask.webTabId) {
        await chrome.runtime.sendMessage({
          type: BH.MessageType.FOCUS_TAB,
          payload: { tabId: currentActiveTask.webTabId }
        });
      }
    });

    // 4. Pause / Resume Toggle
    pauseResumeBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: BH.MessageType.PAUSE_RESUME
      });
      refreshState();
    });

    // 4b. Settings: Auto-Continue Toggle
    if (autoContinueToggle) {
      autoContinueToggle.addEventListener('change', async () => {
        const isEnabled = autoContinueToggle.checked;
        if (autoContinueHint) {
          autoContinueHint.textContent = isEnabled
            ? 'Automatic (advance after 10s countdown)'
            : 'Manual (you click Continue whenever ready)';
        }
        await chrome.runtime.sendMessage({
          type: BH.MessageType.UPDATE_SETTINGS,
          payload: { autoContinueEnabled: isEnabled }
        });
        refreshState();
      });
    }

    // 4c. Settings: Auto-Send Toggle
    if (autoSendToggle) {
      autoSendToggle.addEventListener('change', async () => {
        const isEnabled = autoSendToggle.checked;
        if (autoSendHint) {
          autoSendHint.textContent = isEnabled
            ? 'Automatic (waits 10s then clicks Send)'
            : 'Manual (you click Send whenever ready)';
        }
        if (sendDelayRow) {
          sendDelayRow.style.display = isEnabled ? 'flex' : 'none';
        }
        await chrome.runtime.sendMessage({
          type: BH.MessageType.UPDATE_SETTINGS,
          payload: { autoSendEnabled: isEnabled }
        });
        refreshState();
      });
    }

    // 4d. Settings: Send Delay Input
    if (sendDelayInput) {
      sendDelayInput.addEventListener('change', async () => {
        let val = parseInt(sendDelayInput.value, 10);
        if (isNaN(val) || val < 5) val = 5;
        if (val > 30) val = 30;
        sendDelayInput.value = val;

        await chrome.runtime.sendMessage({
          type: BH.MessageType.UPDATE_SETTINGS,
          payload: { sendDelaySeconds: val }
        });
      });
    }

    // 5. Settings: Readiness Delay
    readinessDelayInput.addEventListener('change', async () => {
      let val = parseInt(readinessDelayInput.value, 10);
      if (isNaN(val) || val < 5) val = 5;
      if (val > 30) val = 30;
      readinessDelayInput.value = val;

      await chrome.runtime.sendMessage({
        type: BH.MessageType.UPDATE_SETTINGS,
        payload: { readinessDelaySeconds: val }
      });
    });

    // 6. Settings: Auto-Cleanup Toggle
    autoCleanupToggle.addEventListener('change', async () => {
      const isEnabled = autoCleanupToggle.checked;
      cleanupDelayRow.style.display = isEnabled ? 'flex' : 'none';

      await chrome.runtime.sendMessage({
        type: BH.MessageType.UPDATE_SETTINGS,
        payload: { autoCleanupEnabled: isEnabled }
      });
    });

    // 7. Settings: Cleanup Delay Input
    cleanupDelayInput.addEventListener('change', async () => {
      let val = parseInt(cleanupDelayInput.value, 10);
      if (isNaN(val) || val < 2) val = 2;
      if (val > 30) val = 30;
      cleanupDelayInput.value = val;

      await chrome.runtime.sendMessage({
        type: BH.MessageType.UPDATE_SETTINGS,
        payload: { cleanupDelaySeconds: val }
      });
    });

    // 8. Settings: Toggle collapsible body
    toggleSettingsBtn.addEventListener('click', () => {
      const isHidden = settingsBody.style.display === 'none';
      settingsBody.style.display = isHidden ? 'flex' : 'none';
    });

    // 9. Reset Stale State Button
    btnResetState.addEventListener('click', async () => {
      if (confirm('Reset all active task states and timers?')) {
        await chrome.runtime.sendMessage({
          type: BH.MessageType.RESET_TASK_STATE
        });
        refreshState();
      }
    });

    // 10. Dismiss Error
    dismissErrorBtn.addEventListener('click', () => {
      errorBox.style.display = 'none';
    });
  }

  function showUserError(msg) {
    errorBox.style.display = 'flex';
    errorMessage.textContent = msg || 'An unknown error occurred.';
  }

  // Run on load
  document.addEventListener('DOMContentLoaded', init);

})();
