// ==UserScript==
// @name         B站直播弹幕 +1
// @name:en      Bilibili Live Danmaku +1
// @namespace    t1mmuz/bilibili-dm-plus1
// @author       t1mmuz
// @homepageURL  https://github.com/summitsoul/t1mmuzScripts
// @supportURL   https://github.com/summitsoul/t1mmuzScripts/issues
// @version      0.1.1
// @description  斗鱼式弹幕 +1：鼠标悬停暂停单条弹幕，点击复读同样内容
// @description:en  Douyu-style +1 for Bilibili live danmaku: hover to pause, click to repeat
// @match        https://live.bilibili.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
(function() {
  "use strict";
  const PREFIX = "[dm+1]";
  let debugEnabled = false;
  function setDebug(on) {
    debugEnabled = on;
  }
  function debug(...args) {
    if (debugEnabled) console.log(PREFIX, ...args);
  }
  function info(...args) {
    console.info(PREFIX, ...args);
  }
  function fail(code, message, waitMs) {
    return { ok: false, code, message, waitMs };
  }
  function checkSend(input, settings) {
    if (input.hasEmoji) return fail("emoji", "含表情的弹幕暂不支持 +1");
    if (!input.text) return fail("empty", "这条弹幕没有文字");
    if (input.text.length > settings.maxTextLength) {
      return fail("too_long", "原弹幕超过 " + settings.maxTextLength + " 字，无法 +1");
    }
    if (!input.loggedIn) return fail("login", "请先登录 B 站");
    if (input.lastSentAt !== null) {
      const elapsed = input.now - input.lastSentAt;
      if (elapsed < settings.cooldownMs) {
        const waitMs = settings.cooldownMs - elapsed;
        return fail("cooldown", "冷却中，" + Math.ceil(waitMs / 1e3) + " 秒后可再发", waitMs);
      }
      if (input.lastText === input.text && elapsed < settings.dedupeMs) {
        return fail("dedupe", "刚刚发过同样内容，稍后再试");
      }
    }
    return { ok: true, code: "ok", message: "" };
  }
  const SEND_URL = "https://api.live.bilibili.com/msg/send";
  const ROOM_INIT_URL = "https://api.live.bilibili.com/room/v1/Room/room_init";
  const FAIL_MESSAGES = {
    login: "请先登录 B 站",
    csrf: "登录状态校验失败，请刷新页面",
    rate: "发送过于频繁，请稍后再试",
    invalid: "内容不符合平台要求",
    unknown: "发送失败"
  };
  function readCookie(name, cookie = document.cookie) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = cookie.match(new RegExp("(?:^|;\\s*)" + escaped + "=([^;]*)"));
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  function getCsrfToken(cookie = document.cookie) {
    return readCookie("bili_jct", cookie);
  }
  function buildSendParams(params) {
    const body = new URLSearchParams();
    body.set("bubble", "0");
    body.set("msg", params.text);
    body.set("color", String(params.color ?? 16777215));
    body.set("mode", "1");
    body.set("fontsize", "25");
    body.set("rnd", String(params.rnd ?? Math.floor(Date.now() / 1e3)));
    body.set("roomid", String(params.roomId));
    body.set("csrf", params.csrf);
    body.set("csrf_token", params.csrf);
    body.set("dm_type", "0");
    return body;
  }
  function classifyCode(code) {
    if (code === 0) return null;
    if (code === -101) return "login";
    if (code === -111) return "csrf";
    if (code === 10031) return "rate";
    if (code === 10030 || code === 10032 || code === 10033) return "invalid";
    return "unknown";
  }
  function parseSendResponse(json) {
    const obj = json ?? {};
    const code = typeof obj.code === "number" ? obj.code : -1;
    const raw = typeof obj.message === "string" ? obj.message : typeof obj.msg === "string" ? obj.msg : "";
    const failure = classifyCode(code);
    return {
      ok: code === 0,
      code,
      message: raw || (failure ? FAIL_MESSAGES[failure] : ""),
      failure: failure ?? void 0
    };
  }
  async function sendDanmaku(params) {
    const fetchImpl = params.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(SEND_URL, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: buildSendParams(params).toString()
      });
      const json = await response.json().catch(() => null);
      if (!response.ok && (json === null || typeof json.code !== "number")) {
        return { ok: false, code: response.status, message: "发送失败（HTTP " + response.status + "）", failure: "unknown" };
      }
      return parseSendResponse(json);
    } catch (err) {
      return { ok: false, code: -1, message: err instanceof Error ? err.message : "网络错误", failure: "unknown" };
    }
  }
  async function resolveRoomId(win = window, loc = location, fetchImpl = fetch) {
    const holder = win;
    const neo = holder.__NEPTUNE_IS_MY_WAIFU__;
    const values = [];
    if (neo && typeof neo === "object") {
      const record = neo;
      for (const key of ["roomInitRes", "roomInfoRes"]) {
        const res = record[key];
        if (!res || typeof res !== "object") continue;
        const data = res.data;
        if (!data || typeof data !== "object") continue;
        const fields = data;
        values.push(fields.room_id, fields.roomid, fields.roomId);
      }
    }
    for (const value of values) {
      const n = Number(value);
      if (Number.isInteger(n) && n > 0) return n;
    }
    const match = loc.pathname.match(/\/(?:blanc\/)?(\d{2,})(?:\/|$)/);
    if (!match) return null;
    const shortId = Number(match[1]);
    try {
      const response = await fetchImpl(ROOM_INIT_URL + "?id=" + shortId, { credentials: "include" });
      const json = await response.json();
      if (json.code === 0 && json.data && typeof json.data.room_id === "number" && json.data.room_id > 0) {
        return json.data.room_id;
      }
    } catch {
    }
    return null;
  }
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  function pointInRect(rect, x, y, pad = 0) {
    return x >= rect.left - pad && x <= rect.left + rect.width + pad && y >= rect.top - pad && y <= rect.top + rect.height + pad;
  }
  function pickTopmost(items, x, y) {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (pointInRect(item.rect, x, y, 2)) return item;
    }
    return null;
  }
  function computePanelPosition(anchor, panelWidth, panelHeight, bounds, gap = 8) {
    const minLeft = bounds.left + 8;
    const maxLeft = Math.max(minLeft, bounds.left + bounds.width - panelWidth - 8);
    const centered = anchor.left + anchor.width / 2 - panelWidth / 2;
    const left = Math.min(Math.max(centered, minLeft), maxLeft);
    let top = anchor.top + anchor.height + gap;
    let placement = "below";
    if (top + panelHeight > bounds.top + bounds.height - 8) {
      const above = anchor.top - gap - panelHeight;
      if (above >= bounds.top + 8) {
        top = above;
        placement = "above";
      } else {
        top = Math.max(bounds.top + 8, bounds.top + bounds.height - 8 - panelHeight);
      }
    }
    return { left, top, placement };
  }
  const HIT_THROTTLE_MS = 40;
  class HoverController {
    constructor(deps) {
      __publicField(this, "deps");
      __publicField(this, "pending", null);
      __publicField(this, "paused", null);
      __publicField(this, "leaveTimer", null);
      __publicField(this, "aliveTimer", null);
      __publicField(this, "lastHitAt", 0);
      __publicField(this, "hitTimer", null);
      __publicField(this, "pointer", { x: 0, y: 0 });
      __publicField(this, "sending", false);
      __publicField(this, "lastSentAt", null);
      __publicField(this, "lastText", "");
      __publicField(this, "started", false);
      __publicField(this, "onPointerMove", (event) => {
        this.pointer.x = event.clientX;
        this.pointer.y = event.clientY;
        if (this.paused) {
          this.updatePaused(event.clientX, event.clientY);
          return;
        }
        this.scheduleHit();
      });
      __publicField(this, "onPointerDown", (event) => {
        if (!this.paused) return;
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (this.deps.panel.el.contains(target)) return;
        if (this.deps.surface.element.contains(target)) this.resume("tap");
      });
      __publicField(this, "onViewportChange", () => {
        if (this.paused) this.resume("viewport");
      });
      this.deps = deps;
    }
    updateSettings(settings) {
      this.deps = { ...this.deps, settings };
    }
    start() {
      if (this.started) return;
      this.started = true;
      document.addEventListener("pointermove", this.onPointerMove, { capture: true, passive: true });
      document.addEventListener("pointerdown", this.onPointerDown, true);
      document.addEventListener("fullscreenchange", this.onViewportChange);
      window.addEventListener("resize", this.onViewportChange);
      window.addEventListener("blur", this.onViewportChange);
      this.aliveTimer = window.setInterval(() => {
        if (this.paused && !this.deps.surface.isAlive()) this.resume("recycled");
      }, 250);
    }
    stop() {
      if (!this.started) return;
      this.started = false;
      document.removeEventListener("pointermove", this.onPointerMove, true);
      document.removeEventListener("pointerdown", this.onPointerDown, true);
      document.removeEventListener("fullscreenchange", this.onViewportChange);
      window.removeEventListener("resize", this.onViewportChange);
      window.removeEventListener("blur", this.onViewportChange);
      if (this.aliveTimer !== null) window.clearInterval(this.aliveTimer);
      this.aliveTimer = null;
      if (this.hitTimer !== null) window.clearTimeout(this.hitTimer);
      this.hitTimer = null;
      this.resume("stop");
    }
    /** 节流命中检测，但保证停下时的最后一个位置仍会被检测。 */
    scheduleHit() {
      const now = performance.now();
      const elapsed = now - this.lastHitAt;
      if (elapsed >= HIT_THROTTLE_MS) {
        this.lastHitAt = now;
        this.updateIdle(this.pointer.x, this.pointer.y);
        return;
      }
      if (this.hitTimer !== null) return;
      this.hitTimer = window.setTimeout(() => {
        this.hitTimer = null;
        this.lastHitAt = performance.now();
        if (!this.paused) this.updateIdle(this.pointer.x, this.pointer.y);
      }, HIT_THROTTLE_MS - elapsed);
    }
    updateIdle(x, y) {
      if (!this.deps.settings.enabled) return;
      const hit = this.deps.surface.hitTest(x, y);
      if (!hit) {
        this.cancelPending();
        return;
      }
      if (this.pending && this.pending.el === hit.el) return;
      this.cancelPending();
      const timer = window.setTimeout(() => this.activate(), this.deps.settings.hoverDelayMs);
      this.pending = { el: hit.el, timer };
    }
    activate() {
      this.pending = null;
      if (this.paused) return;
      const hit = this.deps.surface.hitTest(this.pointer.x, this.pointer.y);
      if (!hit) return;
      if (!this.deps.surface.pause(hit)) return;
      const rect = rectOf(hit.el);
      const item = { ...hit, rect };
      this.paused = {
        item,
        maxTimer: window.setTimeout(() => this.resume("max"), this.deps.settings.pauseMaxMs)
      };
      const container = document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : document.body;
      this.deps.panel.mount(container);
      this.deps.panel.show(item, this.deps.surface.bounds(), { onSend: () => {
        void this.send();
      } });
      const reason = this.staticReason(item);
      if (reason) this.deps.panel.setDisabled(reason);
      debug("paused", item.text);
    }
    staticReason(item) {
      if (item.hasEmoji) return "含表情的弹幕暂不支持 +1";
      if (!item.text) return "这条弹幕没有文字";
      if (item.text.length > this.deps.settings.maxTextLength) {
        return "原弹幕超过 " + this.deps.settings.maxTextLength + " 字，无法 +1";
      }
      if (!getCsrfToken()) return "请先登录 B 站";
      return "";
    }
    updatePaused(x, y) {
      if (!this.paused) return;
      const surfaceRect = this.deps.surface.pausedRect();
      const inItem = surfaceRect !== null && pointInRect(surfaceRect, x, y, 4);
      if (inItem || this.deps.panel.containsPoint(x, y)) {
        this.clearLeave();
        return;
      }
      if (this.leaveTimer === null) {
        this.leaveTimer = window.setTimeout(() => this.resume("leave"), this.deps.settings.resumeDelayMs);
      }
    }
    async send() {
      const paused = this.paused;
      if (!paused || this.sending) return;
      const item = paused.item;
      const csrf = getCsrfToken();
      const guard = checkSend(
        {
          text: item.text,
          hasEmoji: item.hasEmoji,
          loggedIn: csrf !== "",
          now: Date.now(),
          lastSentAt: this.lastSentAt,
          lastText: this.lastText
        },
        {
          maxTextLength: this.deps.settings.maxTextLength,
          cooldownMs: this.deps.settings.cooldownMs,
          dedupeMs: this.deps.settings.dedupeMs
        }
      );
      if (!guard.ok) {
        this.deps.panel.setState("error", guard.message);
        if (guard.code === "login" || guard.code === "empty" || guard.code === "emoji" || guard.code === "too_long") {
          this.deps.panel.setDisabled(guard.message);
        }
        if (guard.code === "cooldown" && guard.waitMs) {
          const wait = guard.waitMs;
          window.setTimeout(() => {
            if (this.paused && !this.sending) this.deps.panel.setState("ready");
          }, wait);
        }
        return;
      }
      this.sending = true;
      this.deps.panel.setState("sending");
      const roomId = await resolveRoomId();
      if (roomId === null) {
        this.sending = false;
        if (this.paused === paused) this.deps.panel.setState("error", "无法获取直播间号，请刷新页面");
        return;
      }
      const result = await sendDanmaku({ roomId, text: item.text, csrf });
      this.sending = false;
      if (this.paused !== paused) return;
      if (result.ok) {
        this.lastSentAt = Date.now();
        this.lastText = item.text;
        this.deps.panel.setState("sent");
        this.deps.toast("已 +1", "info");
        window.setTimeout(() => {
          if (this.paused === paused) this.resume("sent");
        }, 600);
        return;
      }
      this.deps.panel.setState("error", result.message || "发送失败，点击重试");
      this.deps.toast(result.message || "发送失败", "error");
      if (result.failure === "csrf") this.deps.panel.setDisabled("登录状态校验失败，请刷新页面");
    }
    resume(reason) {
      this.cancelPending();
      this.clearLeave();
      const paused = this.paused;
      if (!paused) {
        this.deps.panel.hide();
        return;
      }
      window.clearTimeout(paused.maxTimer);
      this.paused = null;
      this.sending = false;
      this.deps.surface.resume();
      this.deps.panel.hide();
      debug("resume", reason);
    }
    cancelPending() {
      if (!this.pending) return;
      window.clearTimeout(this.pending.timer);
      this.pending = null;
    }
    clearLeave() {
      if (this.leaveTimer === null) return;
      window.clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }
  class PlusOnePanel {
    constructor(doc = document) {
      __publicField(this, "el");
      __publicField(this, "button");
      __publicField(this, "hint");
      __publicField(this, "state", "ready");
      __publicField(this, "handlers", null);
      __publicField(this, "anchor", null);
      __publicField(this, "bounds", null);
      __publicField(this, "shown", false);
      __publicField(this, "onClick", (event) => {
        event.stopPropagation();
        if (this.state === "sending" || this.state === "sent" || this.state === "disabled") return;
        this.handlers?.onSend();
      });
      __publicField(this, "stopPropagation", (event) => {
        event.stopPropagation();
      });
      this.el = doc.createElement("div");
      this.el.className = "dmplus1-panel";
      this.el.setAttribute("role", "toolbar");
      this.el.setAttribute("aria-label", "弹幕 +1");
      this.button = doc.createElement("button");
      this.button.type = "button";
      this.button.className = "dmplus1-btn";
      this.button.textContent = "+1";
      this.hint = doc.createElement("span");
      this.hint.className = "dmplus1-hint";
      this.hint.style.display = "none";
      this.el.append(this.button, this.hint);
      this.el.style.display = "none";
      this.button.addEventListener("click", this.onClick);
      this.el.addEventListener("pointerdown", this.stopPropagation);
      this.el.addEventListener("click", this.stopPropagation);
      doc.body.appendChild(this.el);
    }
    /** 全屏时面板必须挂进全屏元素，否则不可见。 */
    mount(container) {
      if (this.el.parentElement !== container) container.appendChild(this.el);
    }
    show(anchor, bounds, handlers) {
      this.anchor = anchor;
      this.bounds = bounds;
      this.handlers = handlers;
      this.setState("ready", "");
      this.el.style.display = "flex";
      this.el.style.visibility = "hidden";
      this.shown = true;
      this.reposition();
      this.el.style.visibility = "";
    }
    setState(state, message = "") {
      this.state = state;
      this.button.disabled = state === "sending" || state === "sent" || state === "disabled";
      if (state === "sending") this.button.textContent = "…";
      else if (state === "sent") this.button.textContent = "已 +1 ✓";
      else if (state === "error") this.button.textContent = "重试";
      else this.button.textContent = "+1";
      this.hint.textContent = message;
      this.hint.style.display = message ? "" : "none";
    }
    setDisabled(message) {
      this.setState("disabled", message);
    }
    hide() {
      this.el.style.display = "none";
      this.shown = false;
      this.anchor = null;
      this.bounds = null;
      this.handlers = null;
      this.state = "ready";
    }
    containsPoint(x, y) {
      return this.shown && pointInRect(rectOf(this.el), x, y, 2);
    }
    destroy() {
      this.button.removeEventListener("click", this.onClick);
      this.el.removeEventListener("pointerdown", this.stopPropagation);
      this.el.removeEventListener("click", this.stopPropagation);
      this.el.remove();
    }
    reposition() {
      if (!this.anchor || !this.bounds) return;
      const width = this.el.offsetWidth;
      const height = this.el.offsetHeight;
      const pos = computePanelPosition(this.anchor.rect, width, height, this.bounds);
      this.el.style.left = Math.round(pos.left) + "px";
      this.el.style.top = Math.round(pos.top) + "px";
      this.el.dataset.placement = pos.placement;
    }
  }
  const DEFAULT_SETTINGS = {
    enabled: true,
    hoverDelayMs: 60,
    resumeDelayMs: 60,
    pauseMaxMs: 15e3,
    cooldownMs: 3e3,
    dedupeMs: 5e3,
    maxTextLength: 20,
    debug: false
  };
  const KEY = "dmplus1:settings:v1";
  function storageOrNull() {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  }
  function num(value, fallback, min, max) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }
  function loadSettings(storage = storageOrNull()) {
    if (!storage) return { ...DEFAULT_SETTINGS };
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SETTINGS.enabled,
        hoverDelayMs: num(parsed.hoverDelayMs, DEFAULT_SETTINGS.hoverDelayMs, 0, 2e3),
        resumeDelayMs: num(parsed.resumeDelayMs, DEFAULT_SETTINGS.resumeDelayMs, 50, 5e3),
        pauseMaxMs: num(parsed.pauseMaxMs, DEFAULT_SETTINGS.pauseMaxMs, 1e3, 6e4),
        cooldownMs: num(parsed.cooldownMs, DEFAULT_SETTINGS.cooldownMs, 0, 6e4),
        dedupeMs: num(parsed.dedupeMs, DEFAULT_SETTINGS.dedupeMs, 0, 6e5),
        maxTextLength: num(parsed.maxTextLength, DEFAULT_SETTINGS.maxTextLength, 1, 100),
        debug: typeof parsed.debug === "boolean" ? parsed.debug : DEFAULT_SETTINGS.debug
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(settings, storage = storageOrNull()) {
    try {
      storage?.setItem(KEY, JSON.stringify(settings));
    } catch {
    }
  }
  class SettingsStore {
    constructor(storage = storageOrNull()) {
      __publicField(this, "settings");
      __publicField(this, "listeners", /* @__PURE__ */ new Set());
      this.storage = storage;
      this.settings = loadSettings(storage);
    }
    get() {
      return this.settings;
    }
    patch(partial) {
      this.settings = { ...this.settings, ...partial };
      saveSettings(this.settings, this.storage);
      for (const listener of this.listeners) listener(this.settings);
    }
    subscribe(listener) {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }
  }
  const STYLE_ID = "dmplus1-styles";
  const CSS = [
    '.dmplus1-panel{position:fixed;z-index:2147483000;display:none;align-items:center;gap:6px;padding:3px 4px 3px 6px;border-radius:6px;background:rgba(20,20,24,.92);box-shadow:0 4px 16px rgba(0,0,0,.45);color:#fff;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;user-select:none;pointer-events:auto;}',
    ".dmplus1-btn{appearance:none;border:0;border-radius:4px;background:#00aeec;color:#fff;font-size:12px;font-weight:700;line-height:1;padding:5px 9px;cursor:pointer;min-width:34px;}",
    ".dmplus1-btn:hover:not(:disabled){background:#33bff0;}",
    ".dmplus1-btn:disabled{background:#4b4b52;color:#cfcfd4;cursor:default;}",
    ".dmplus1-hint{color:#c9c9cf;font-size:11px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".dmplus1-paused{outline:1px solid rgba(255,255,255,.9);outline-offset:1px;background:rgba(0,174,236,.22);border-radius:4px;}",
    ".dmplus1-toast-host{position:fixed;left:0;right:0;bottom:96px;z-index:2147483001;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;}",
    '.dmplus1-toast{max-width:70vw;padding:7px 14px;border-radius:6px;background:rgba(20,20,24,.92);color:#fff;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);opacity:0;transform:translateY(6px);transition:opacity .18s ease,transform .18s ease;}',
    ".dmplus1-toast.show{opacity:1;transform:none;}",
    ".dmplus1-toast.error{background:rgba(120,20,24,.94);}"
  ].join("\n");
  function injectStyles(doc = document) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  const PAUSED_CLASS = "dmplus1-paused";
  function signature(el) {
    return (el.textContent ?? "").trim() + "|" + el.querySelectorAll("img").length;
  }
  class NativeSurface {
    constructor(root) {
      __publicField(this, "paused", null);
      this.root = root;
    }
    static findRoot(doc = document) {
      const player = doc.querySelector("#live-player");
      if (player && player.querySelector(".danmaku-item-container")) return player;
      const layer = doc.querySelector(".web-player-danmaku");
      if (layer) return layer.parentElement ?? layer;
      return null;
    }
    get element() {
      return this.root;
    }
    bounds() {
      return rectOf(this.root);
    }
    /** 当前可见的弹幕。只读一次布局，调用方需自行节流。 */
    scan() {
      const out = [];
      const containers = this.root.querySelectorAll(".danmaku-item-container");
      for (const container of Array.from(containers)) {
        const style = getComputedStyle(container);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (container.getBoundingClientRect().height < 2) continue;
        const items = container.querySelectorAll(".bili-danmaku-x-dm");
        for (const el of Array.from(items)) {
          if (!el.isConnected) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          out.push({
            el,
            text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
            hasEmoji: el.querySelector("img") !== null,
            rect: { left: r.left, top: r.top, width: r.width, height: r.height }
          });
        }
      }
      return out;
    }
    hitTest(x, y) {
      return pickTopmost(this.scan(), x, y);
    }
    pause(item) {
      this.resume();
      const anims = item.el.getAnimations();
      if (anims.length === 0) return false;
      for (const anim of anims) anim.pause();
      item.el.classList.add(PAUSED_CLASS);
      this.paused = { el: item.el, anims, sig: signature(item.el) };
      return true;
    }
    resume() {
      const paused = this.paused;
      if (!paused) return;
      this.paused = null;
      paused.el.classList.remove(PAUSED_CLASS);
      for (const anim of paused.anims) {
        try {
          anim.play();
        } catch {
        }
      }
    }
    get hasPaused() {
      return this.paused !== null;
    }
    pausedRect() {
      return this.paused ? rectOf(this.paused.el) : null;
    }
    /** 暂停期间原生层是否把该节点回收/复用。 */
    isAlive() {
      if (!this.paused) return false;
      return this.paused.el.isConnected && signature(this.paused.el) === this.paused.sig;
    }
  }
  let host = null;
  function ensureHost() {
    if (host && host.isConnected) return host;
    host = document.createElement("div");
    host.className = "dmplus1-toast-host";
    document.body.appendChild(host);
    return host;
  }
  function toast(message, kind = "info", duration = 2400) {
    if (!message) return;
    const container = ensureHost();
    const item = document.createElement("div");
    item.className = "dmplus1-toast" + (kind === "error" ? " error" : "");
    item.textContent = message;
    container.appendChild(item);
    requestAnimationFrame(() => item.classList.add("show"));
    window.setTimeout(() => {
      item.classList.remove("show");
      window.setTimeout(() => item.remove(), 220);
    }, duration);
  }
  const RETRY_MS = 1e3;
  function createDanmakuPlus1() {
    injectStyles();
    const store = new SettingsStore();
    setDebug(store.get().debug);
    let panel = null;
    let surface = null;
    let controller = null;
    let timer = null;
    let disposed = false;
    const teardown = () => {
      controller?.stop();
      controller = null;
      surface = null;
    };
    const attach = () => {
      const root = NativeSurface.findRoot();
      if (!root) {
        if (surface) teardown();
        return;
      }
      if (surface && surface.element === root && root.isConnected) return;
      teardown();
      surface = new NativeSurface(root);
      panel ?? (panel = new PlusOnePanel());
      controller = new HoverController({ surface, panel, settings: store.get(), toast });
      controller.start();
      info("已启用：悬停弹幕显示 +1");
    };
    const tick = () => {
      if (!disposed) attach();
    };
    const unsubscribe = store.subscribe((next) => {
      setDebug(next.debug);
      controller?.updateSettings(next);
    });
    tick();
    timer = window.setInterval(tick, RETRY_MS);
    return {
      dispose() {
        if (disposed) return;
        disposed = true;
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        unsubscribe();
        teardown();
        panel?.destroy();
        panel = null;
      }
    };
  }
  function boot() {
    if (window.__DM_PLUS1__) return;
    const handle = createDanmakuPlus1();
    window.__DM_PLUS1__ = handle;
    window.addEventListener("pagehide", () => {
      handle.dispose();
      delete window.__DM_PLUS1__;
    }, { once: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
