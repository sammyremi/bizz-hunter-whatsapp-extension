/**
 * Bizz-Hunter WhatsApp Assistant - Shared Constants
 * Compatible with Service Workers, Content Scripts, Popup, and Node.js
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

  // Task Statuses
  const TaskStatus = Object.freeze({
    IDLE: 'Idle',
    LINK_DETECTED: 'WhatsApp link detected',
    CONTINUE_DETECTED: 'Continue page detected',
    WAITING_FOR_WEB: 'Waiting for WhatsApp Web',
    CHAT_DETECTED: 'Chat detected',
    VERIFYING_RECIPIENT: 'Verifying recipient',
    WAITING_FOR_DRAFT: 'Waiting for draft',
    READY_FOR_ACTION: 'Ready for user action',
    READY_TO_SEND: 'Ready for user action',
    COUNTDOWN_TO_SEND: 'Countdown to auto-send',
    SENDING: 'Sending message',
    SENT: 'Sent',
    COMPLETED: 'Completed',
    SEND_STATUS_UNKNOWN: 'Send status unknown',
    FAILED: 'Failed',
    PAUSED: 'Paused'
  });

  // Action Message Types
  const MessageType = Object.freeze({
    // Content -> Background
    SEND_PAGE_DETECTED: 'BH_SEND_PAGE_DETECTED',
    CONTINUE_PAGE_STATUS: 'BH_CONTINUE_PAGE_STATUS',
    CONTINUE_ACTION_ACTIVATED: 'BH_CONTINUE_ACTION_ACTIVATED',
    WEB_PAGE_DETECTED: 'BH_WEB_PAGE_DETECTED',
    WEB_CHAT_STATUS: 'BH_WEB_CHAT_STATUS',
    WEB_INVALID_NUMBER: 'BH_WEB_INVALID_NUMBER',
    WEB_HANDOFF_FAILED: 'BH_WEB_HANDOFF_FAILED',
    ACQUIRE_SEND_LOCK: 'BH_ACQUIRE_SEND_LOCK',
    AUTO_SEND_COUNTDOWN_TICK: 'BH_AUTO_SEND_COUNTDOWN_TICK',
    AUTO_SEND_CANCELLED: 'BH_AUTO_SEND_CANCELLED',
    AUTO_SEND_COMPLETED: 'BH_AUTO_SEND_COMPLETED',
    AUTO_SEND_FAILED: 'BH_AUTO_SEND_FAILED',
    AUTO_SEND_UNKNOWN: 'BH_AUTO_SEND_UNKNOWN',

    // Popup/Content -> Background
    TRIGGER_CONTINUE_ACTION: 'BH_TRIGGER_CONTINUE_ACTION',
    TRIGGER_SEND_ACTION: 'BH_TRIGGER_SEND_ACTION',
    ENSURE_WEB_NAVIGATION: 'BH_ENSURE_WEB_NAVIGATION',
    UPDATE_SETTINGS: 'BH_UPDATE_SETTINGS',
    PAUSE_RESUME: 'BH_PAUSE_RESUME',
    RESET_TASK_STATE: 'BH_RESET_TASK_STATE',
    GET_EXTENSION_STATE: 'BH_GET_EXTENSION_STATE',

    // Background -> Content/Popup
    STATE_CHANGED: 'BH_STATE_CHANGED',
    EXECUTE_CONTINUE_CLICK: 'BH_EXECUTE_CONTINUE_CLICK',
    EXECUTE_SEND_CLICK: 'BH_EXECUTE_SEND_CLICK',
    FOCUS_TAB: 'BH_FOCUS_TAB'
  });

  // Storage Keys
  const StorageKey = Object.freeze({
    TASKS: 'bh_tasks',
    ACTIVE_TASK_ID: 'bh_active_task_id',
    PENDING_MESSAGE_TEXT: 'bh_pending_message_text',
    PENDING_PHONE: 'bh_pending_phone',
    SETTINGS: 'bh_settings',
    STATS: 'bh_stats'
  });

  // Alarm Prefixes
  const AlarmPrefix = Object.freeze({
    READINESS: 'bh_ready_',
    CLEANUP: 'bh_cleanup_'
  });

  // Default Settings
  const DefaultSettings = Object.freeze({
    isPaused: false,
    autoContinueEnabled: true, // Automatically click Continue to WhatsApp Web
    continueDelaySeconds: 10,  // 10s countdown before activating Continue
    autoSendEnabled: true,     // Automatically click Send after message is drafted
    sendDelaySeconds: 10,      // 10s countdown before activating Send
    readinessDelaySeconds: 10,
    autoCleanupEnabled: false, // Safe default: off
    cleanupDelaySeconds: 5
  });

  // Hostnames & Paths
  const Endpoints = Object.freeze({
    API_HOST: 'api.whatsapp.com',
    API_SEND_PATH: '/send/',
    API_SEND_PATH_ALT: '/send',
    WEB_HOST: 'web.whatsapp.com',
    WA_ME_HOST: 'wa.me'
  });

  return {
    TaskStatus,
    MessageType,
    StorageKey,
    AlarmPrefix,
    DefaultSettings,
    Endpoints
  };
});
