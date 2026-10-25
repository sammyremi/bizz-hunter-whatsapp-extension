/**
 * Lightweight Mock DOM for headless test environments.
 * Provides element creation, tree hierarchy, attributes, classList, and CSS selector matching.
 */

class DOMTokenList {
  constructor(str = '') {
    this.tokens = new Set(str.split(/\s+/).filter(Boolean));
  }
  contains(token) {
    return this.tokens.has(token);
  }
  add(token) {
    this.tokens.add(token);
  }
  remove(token) {
    this.tokens.delete(token);
  }
}

class MockElement {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.attributes = Object.assign({}, attrs);
    this.textContent = text;
    this.innerText = text;
    this.children = [];
    this.parentElement = null;
    this.classList = new DOMTokenList(attrs.class || '');
    this.style = {};
    this.offsetParent = {}; // indicates visible
    this.listeners = {};
  }

  focus() {
    this.isFocused = true;
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  dispatchEvent(event) {
    const list = this.listeners[event && event.type] || [];
    for (const fn of list) {
      fn(event);
    }
    return true;
  }

  getAttribute(name) {
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') {
      this.classList = new DOMTokenList(String(value));
    }
  }

  hasAttribute(name) {
    return this.attributes[name] !== undefined;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  matches(selector) {
    if (!selector) return false;

    // Handle comma-separated selector lists
    if (selector.includes(',')) {
      return selector.split(',').some(part => this.matches(part.trim()));
    }

    // Handle space-separated descendant selectors: e.g. "#main header"
    const parts = selector.trim().split(/\s+/);
    if (parts.length > 1) {
      const lastPart = parts[parts.length - 1];
      if (!this.matchesSingle(lastPart)) return false;

      // Check if ancestor matches preceding parts
      let currentParent = this.parentElement;
      const ancestorParts = parts.slice(0, -1);
      let ancestorIdx = ancestorParts.length - 1;

      while (currentParent && ancestorIdx >= 0) {
        if (currentParent.matchesSingle(ancestorParts[ancestorIdx])) {
          ancestorIdx--;
        }
        currentParent = currentParent.parentElement;
      }
      return ancestorIdx < 0;
    }

    return this.matchesSingle(selector.trim());
  }

  matchesSingle(part) {
    if (!part) return false;

    // Attribute selectors: [attr="value"], [attr*="value"], [attr]
    // Can be preceded by a tag name: div[contenteditable="true"]
    let remaining = part;
    let tagMatch = remaining.match(/^([a-zA-Z0-9_-]+)/);
    if (tagMatch) {
      if (this.tagName !== tagMatch[1].toUpperCase()) {
        return false;
      }
      remaining = remaining.substring(tagMatch[1].length);
    }

    // Check ID #id
    let idMatch = remaining.match(/^#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      if (this.attributes.id !== idMatch[1]) return false;
      remaining = remaining.substring(idMatch[0].length);
    }

    // Check Class .class
    let classMatch = remaining.match(/^\.([a-zA-Z0-9_-]+)/);
    if (classMatch) {
      if (!this.classList.contains(classMatch[1])) return false;
      remaining = remaining.substring(classMatch[0].length);
    }

    // Check bracketed attributes
    const attrRegex = /\[([a-zA-Z0-9_-]+)([\*~|^$]?=)?([^\]]*)\]/g;
    let match;
    while ((match = attrRegex.exec(remaining)) !== null) {
      const attrName = match[1];
      const operator = match[2] || '';
      let expectedVal = match[3] || '';
      // Strip quotes if present
      expectedVal = expectedVal.replace(/^["']|["']$/g, '');

      if (!this.hasAttribute(attrName)) return false;
      const actualVal = this.getAttribute(attrName);

      if (operator === '=') {
        if (actualVal !== expectedVal) return false;
      } else if (operator === '*=') {
        if (!actualVal.includes(expectedVal)) return false;
      }
    }

    return true;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector) {
    const list = this.querySelectorAll(selector);
    return list.length > 0 ? list[0] : null;
  }

  getBoundingClientRect() {
    return { width: 100, height: 40, top: 10, left: 10, right: 110, bottom: 50 };
  }
}

class MockDocument {
  constructor() {
    this.body = new MockElement('body');
    this.body.ownerDocument = this;
  }

  createElement(tag, attrs = {}, text = '') {
    const el = new MockElement(tag, attrs, text);
    el.ownerDocument = this;
    return el;
  }

  getElementById(id) {
    const walk = (node) => {
      if (node.attributes && node.attributes.id === id) return node;
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this.body);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }
}

module.exports = {
  MockElement,
  MockDocument,
  DOMTokenList
};
