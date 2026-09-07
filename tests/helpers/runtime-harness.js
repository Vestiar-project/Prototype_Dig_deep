"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

class StubClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = typeof force === "boolean" ? force : !this.values.has(name);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class StubStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, String(value)); }
  removeProperty(name) { this.values.delete(name); }
}

class StubElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.classList = new StubClassList();
    this.style = new StubStyle();
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.textContent = "";
    this._innerHTML = "";
    this.innerHTMLWrites = 0;
    this.value = "";
    this.title = "";
    this.tabIndex = -1;
    this.clientWidth = 1100;
    this.clientHeight = 720;
    this.offsetWidth = 1100;
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.listeners = new Map();
    this.replaceChildrenCalls = 0;
  }
  append(...children) {
    for (const child of children) {
      if (child && typeof child === "object") {
        if (child.parentElement && child.parentElement !== this) child.remove?.();
        child.parentElement = this;
      }
      this.children.push(child);
    }
  }
  insertBefore(child, reference = null) {
    if (!child || typeof child !== "object") return child;
    if (child.parentElement) {
      const previousIndex = child.parentElement.children.indexOf(child);
      if (previousIndex >= 0) child.parentElement.children.splice(previousIndex, 1);
    }
    const referenceIndex = reference ? this.children.indexOf(reference) : -1;
    const insertIndex = referenceIndex >= 0 ? referenceIndex : this.children.length;
    child.parentElement = this;
    this.children.splice(insertIndex, 0, child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    if (child?.parentElement === this) child.parentElement = null;
    return child;
  }
  remove() {
    this.parentElement?.removeChild?.(this);
  }
  replaceChildren(...children) {
    this.replaceChildrenCalls += 1;
    this.children = [];
    this.append(...children);
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  click() {
    for (const listener of this.listeners.get("click") || []) {
      listener({ type: "click", currentTarget: this, target: this });
    }
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.innerHTMLWrites += 1;
  }
  get innerHTML() { return this._innerHTML; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  focus() {}
  scrollTo(options = {}) {
    this.scrollLeft = Number(options.left) || 0;
    this.scrollTop = Number(options.top) || 0;
  }
  getBoundingClientRect() { return { width: 1280, height: 720, left: 0, top: 0 }; }
}

const gradient = { addColorStop() {} };
const context = new Proxy({
  createRadialGradient: () => gradient,
  createLinearGradient: () => gradient,
  measureText: () => ({ width: 0 }),
}, {
  get(target, property) {
    if (property in target) return target[property];
    if (typeof property === "symbol") return target[property];
    return () => {};
  },
  set(target, property, value) {
    target[property] = value;
    return true;
  },
});

const elements = new Map();
function elementFor(selector) {
  if (!elements.has(selector)) elements.set(selector, new StubElement());
  return elements.get(selector);
}

const canvas = new StubElement("canvas");
canvas.getContext = () => context;
elements.set("#gameCanvas", canvas);

const localData = new Map();
// Keep chance-based side effects out of deterministic mechanic assertions.
// The world itself uses its seeded generator, so this does not affect terrain.
Math.random = () => 0.999999;
global.window = global;
global.innerWidth = 1280;
global.innerHeight = 720;
global.devicePixelRatio = 1;
let mobileUpgradeInteraction = false;
global.matchMedia = (query) => ({
  matches: query === '(hover: none) and (pointer: coarse)' ? mobileUpgradeInteraction : false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
});
global.addEventListener = () => {};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.confirm = () => true;
const requestedImageSources = [];
global.Image = class StubImage {
  constructor() {
    this.naturalWidth = 512;
    this.naturalHeight = 512;
    this.onload = null;
    this.onerror = null;
  }
  set src(value) {
    this._src = String(value);
    const canonicalSource = this._src.split("?", 1)[0];
    if (canonicalSource.endsWith("depth-zero-terrain-runtime-atlas.png")) {
      this.naturalWidth = 1536;
      this.naturalHeight = 1024;
    } else if (canonicalSource.endsWith("depth-zero-ores-runtime-atlas.png")) {
      this.naturalWidth = 1774;
      this.naturalHeight = 887;
    } else if (canonicalSource.endsWith("depth-zero-vein-connectors-runtime-atlas.png")) {
      this.naturalWidth = 2560;
      this.naturalHeight = 1024;
    }
    requestedImageSources.push(this._src);
    this.onload?.();
  }
  get src() { return this._src || ""; }
};
global.localStorage = {
  getItem: (key) => localData.get(key) ?? null,
  setItem: (key, value) => localData.set(key, String(value)),
  removeItem: (key) => localData.delete(key),
  clear: () => localData.clear(),
};
const documentListeners = new Map();
global.document = {
  hidden: false,
  activeElement: null,
  querySelector: (selector) => elementFor(selector),
  querySelectorAll: () => [],
  createElement: (tagName) => new StubElement(tagName),
  createElementNS: (_namespace, tagName) => new StubElement(tagName),
  createDocumentFragment: () => new StubElement("fragment"),
  addEventListener(type, listener) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(listener);
  },
};

function dispatchDocumentEvent(type) {
  for (const listener of documentListeners.get(type) || []) listener({ type, target: document });
}

const root = path.resolve(__dirname, "..", "..");
require(path.join(root, "js", "upgrades.js"));
require(path.join(root, "js", "world.js"));
require(path.join(root, "js", "game.js"));

module.exports = { api: global.__DEPTH_ZERO__, elementFor, localData };
