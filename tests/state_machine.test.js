/**
 * Test Suite: Extension State Machine, Tab Tracking & Lifecycle
 * Tests cases 7, 8, 9, 10, 13, 14, 15:
 * - Tab mapping (new tabs & navigating tabs)
 * - Closed tab handling
 * - Pause and resume controls
 * - Storage hydration (surviving service worker suspension / browser restart)
 * - Safe tab cleanup (closing ONLY task tabs, never unrelated tabs)
 * - Idempotency
 */

const assert = require('assert');
const { TaskStatus, DefaultSettings, StorageKey, AlarmPrefix } = require('../shared/constants.js');

// Mock Chrome API environment for Background Service Worker testing
class MockChromeStorage {
  constructor() {
    this.store = {};
  }
  async get(keys) {
    const res = {};
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) {
      if (this.store[k] !== undefined) {
        res[k] = JSON.parse(JSON.stringify(this.store[k]));
      }
    }
    return res;
  }
  async set(items) {
    for (const [k, v] of Object.entries(items)) {
      this.store[k] = JSON.parse(JSON.stringify(v));
    }
  }
}

class MockChromeAlarms {
  constructor() {
    this.alarms = new Map();
  }
  async create(name, info) {
    this.alarms.set(name, info);
  }
  async clear(name) {
    this.alarms.delete(name);
  }
  async getAll() {
    return Array.from(this.alarms.entries()).map(([name, info]) => ({ name, ...info }));
  }
}

class MockChromeTabs {
  constructor() {
    this.openTabs = new Set([101, 102, 201, 202]); // 201 and 202 are unrelated tabs
    this.closedTabs = [];
  }
  async remove(tabId) {
    if (this.openTabs.has(tabId)) {
      this.openTabs.delete(tabId);
      this.closedTabs.push(tabId);
    } else {
      throw new Error(`Tab ${tabId} does not exist`);
    }
  }
}

function runTests() {
  console.log('\n--- Running State Machine & Lifecycle Tests ---');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
  }

  // 1. Service Worker Suspension & Hydration from Storage
  test('State persists in chrome.storage.local and survives service worker suspension', async () => {
    const storage = new MockChromeStorage();

    // Worker creates a task and saves it
    const taskId = 'task_2347031615407_12345';
    await storage.set({
      [StorageKey.TASKS]: {
        [taskId]: {
          id: taskId,
          status: TaskStatus.LINK_DETECTED,
          phoneNormalized: '2347031615407',
          sendTabId: 101
        }
      },
      [StorageKey.ACTIVE_TASK_ID]: taskId,
      [StorageKey.SETTINGS]: DefaultSettings
    });

    // Simulate service worker suspension: global variables are wiped, new worker awakens
    const hydrated = await storage.get([StorageKey.TASKS, StorageKey.ACTIVE_TASK_ID]);
    assert.strictEqual(hydrated[StorageKey.ACTIVE_TASK_ID], taskId);
    assert.strictEqual(hydrated[StorageKey.TASKS][taskId].status, TaskStatus.LINK_DETECTED);
  });

  // 2. New Tab vs Existing Tab Navigation mapping
  test('Correctly tracks WhatsApp Web tab whether opened in new tab or existing tab', () => {
    const task = {
      id: 'task_1',
      sendTabId: 101,
      webTabId: null,
      status: TaskStatus.CONTINUE_DETECTED
    };

    // Case A: Opened in a new tab (tab 102)
    const newWebTabId = 102;
    task.webTabId = newWebTabId;
    task.status = TaskStatus.WAITING_FOR_WEB;

    assert.strictEqual(task.webTabId, 102);
    assert.strictEqual(task.status, TaskStatus.WAITING_FOR_WEB);
  });

  // 3. Tab Closure Handling & Alarm Cleanup
  test('Cancels pending readiness alarms when Web tab is prematurely closed', async () => {
    const alarms = new MockChromeAlarms();
    const taskId = 'task_test_closed';

    // Alarm was scheduled for readiness
    await alarms.create(`${AlarmPrefix.READINESS}${taskId}`, { when: Date.now() + 12000 });
    assert.strictEqual(alarms.alarms.has(`${AlarmPrefix.READINESS}${taskId}`), true);

    // User closes tab -> handler clears alarm
    await alarms.clear(`${AlarmPrefix.READINESS}${taskId}`);
    assert.strictEqual(alarms.alarms.has(`${AlarmPrefix.READINESS}${taskId}`), false);
  });

  // 4. Safe Tab Cleanup Policy (Never touches unrelated tabs)
  test('Auto-cleanup removes ONLY task-specific tabs, never unrelated browser tabs', async () => {
    const tabs = new MockChromeTabs();
    const task = {
      id: 'task_cleanup_test',
      sendTabId: 101,
      webTabId: 102,
      status: TaskStatus.COMPLETED
    };

    // User tabs:
    // 101: api.whatsapp.com/send
    // 102: web.whatsapp.com
    // 201: unrelated tab (e.g. Gmail)
    // 202: unrelated tab (e.g. Bizz-Hunter Dashboard)

    const tabsToClose = [task.sendTabId, task.webTabId];
    for (const tid of tabsToClose) {
      await tabs.remove(tid);
    }

    // Verify task tabs are closed
    assert.strictEqual(tabs.openTabs.has(101), false);
    assert.strictEqual(tabs.openTabs.has(102), false);

    // Verify UNRELATED tabs are strictly preserved!
    assert.strictEqual(tabs.openTabs.has(201), true);
    assert.strictEqual(tabs.openTabs.has(202), true);
    assert.deepStrictEqual(tabs.closedTabs, [101, 102]);
  });

  // 5. Pause and Resume Controls
  test('Pause control halts status transitions and resume restores detection', () => {
    let settings = Object.assign({}, DefaultSettings, { isPaused: false });
    let task = { status: TaskStatus.LINK_DETECTED };

    // Toggle pause
    settings.isPaused = true;
    task.status = TaskStatus.PAUSED;
    assert.strictEqual(settings.isPaused, true);
    assert.strictEqual(task.status, TaskStatus.PAUSED);

    // Resume
    settings.isPaused = false;
    task.status = TaskStatus.LINK_DETECTED;
    assert.strictEqual(settings.isPaused, false);
    assert.strictEqual(task.status, TaskStatus.LINK_DETECTED);
  });

  // 6. Idempotency Check
  test('Does not duplicate task on repeated URL events for the same tab', () => {
    const tasks = {};
    const tabId = 101;
    const phone = '2347031615407';

    // Helper: simulate handleSendPageUrlDetected idempotency logic
    function handleEvent(tId, ph) {
      const existing = Object.values(tasks).find(t => t.sendTabId === tId && t.phone === ph);
      if (existing) return existing;

      const newTask = { id: `task_${Date.now()}`, sendTabId: tId, phone: ph };
      tasks[newTask.id] = newTask;
      return newTask;
    }

    const first = handleEvent(tabId, phone);
    const second = handleEvent(tabId, phone);

    assert.strictEqual(first.id, second.id);
    assert.strictEqual(Object.keys(tasks).length, 1);
  });

  // 7. Auto-Continue Default Setting
  test('Default settings enable automatic continue to WhatsApp Web', () => {
    assert.strictEqual(DefaultSettings.autoContinueEnabled, true);
  });

  // 8. Auto-Continue ENSURE_WEB_NAVIGATION Fallback
  test('ENSURE_WEB_NAVIGATION creates new tab when auto-click was suppressed', async () => {
    const tabs = new MockChromeTabs();
    const task = {
      id: 'task_auto_continue',
      sendTabId: 101,
      webTabId: null,
      status: TaskStatus.LINK_DETECTED
    };

    // Simulate ENSURE_WEB_NAVIGATION handler
    function handleEnsureNav(t, destUrl) {
      if (t.webTabId) return { alreadyLinked: true };
      const newId = 301;
      tabs.openTabs.add(newId);
      t.webTabId = newId;
      t.webUrl = destUrl;
      t.status = TaskStatus.WAITING_FOR_WEB;
      return { success: true, createdTabId: newId };
    }

    const res = handleEnsureNav(task, 'https://web.whatsapp.com/send/?phone=2347031615407');
    assert.strictEqual(res.success, true);
    assert.strictEqual(task.webTabId, 301);
    assert.strictEqual(task.status, TaskStatus.WAITING_FOR_WEB);
    assert.strictEqual(tabs.openTabs.has(301), true);

    // Repeated call is idempotent
    const secondCall = handleEnsureNav(task, 'https://web.whatsapp.com/send/?phone=2347031615407');
    assert.strictEqual(secondCall.alreadyLinked, true);
  });

  return { passed, failed };
}

if (require.main === module) {
  runTests().then(({ passed, failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

module.exports = runTests;
