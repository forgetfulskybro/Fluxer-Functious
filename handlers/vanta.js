const { inspect } = require("util");
const color = require("../functions/colorCodes");

const REDACTED = "[REDACTED]";

const hide = (target, key, value) => {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return value;
};

const isSecretKey = (key = "") => {
  const k = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    k === "token" ||
    k === "client" ||
    k.includes("token") ||
    k.includes("apikey") ||
    k.includes("secret") ||
    k.includes("password") ||
    k.includes("passphrase") ||
    k.includes("authorization") ||
    k.includes("connectionstring") ||
    k.includes("privatekey") ||
    k.includes("accesskey")
  );
};

module.exports = class VantaHandler {
  constructor(options = {}) {
    this.source = options.source || "node";
    this.debug = options.debug ?? false;
    this.apiUrl = options.apiUrl;

    hide(this, "apiKey", options.apiKey || process.env.VANTA || process.env.VANTA_API_KEY);
    hide(this, "client", null);
    hide(this, "_ready", false);
    hide(this, "_initPromise", null);
    hide(this, "_state", "stopped");
    hide(this, "_paused", false);
    hide(this, "_startedAt", null);
    hide(this, "_restarts", 0);
    hide(this, "_dropped", 0);
    hide(this, "_delivered", 0);
    hide(this, "_heartbeats", new Map());
    hide(this, "_autoHeartbeat", options.heartbeat ?? null);
    hide(this, "_lastError", null);
  }

  get ready() {
    return this._ready;
  }

  get state() {
    return this._state;
  }

  get paused() {
    return this._paused;
  }

  setApiKey(apiKey) {
    if (!apiKey) return false;
    this.apiKey = apiKey;
    this._lastError = null;
    this._log(`API key rotated (${REDACTED})`, 6);
    return true;
  }

  async init() {
    if (this._ready) return this.client;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        const { Vanta } = require("@vanta-dev/node");

        const config = {
          apiKey: this.apiKey,
          source: this.source,
          onDeliveryError: (err, events) => {
            this._handleDeliveryError(err, events);
          },
        };
        if (this.apiUrl) config.apiUrl = this.apiUrl;

        const vanta = new Vanta(config);
        this._protect(vanta);

        hide(this, "client", vanta);
        this._ready = true;
        this._state = "running";
        this._lastError = null;

        this._log("Client initialized", 6);
        return vanta;
      } catch (err) {
        this._state = "error";
        this._lastError = err?.message || String(err);
        this._log(`Init failed: ${this._lastError}`, 4);
        throw err;
      }
    })();

    return this._initPromise;
  }

  async ensureReady() {
    if (!this.apiKey) {
      throw new Error("VantaHandler: missing apiKey (set VANTA or VANTA_API_KEY, or pass apiKey)");
    }
    return this.init();
  }

  async start(options = {}) {
    if (options.apiKey) this.setApiKey(options.apiKey);
    if (options.source) this.source = options.source;
    if (options.apiUrl) this.apiUrl = options.apiUrl;
    if (options.heartbeat !== undefined) this._autoHeartbeat = options.heartbeat;

    this._paused = false;
    this._state = "starting";
    this._startedAt = Date.now();

    try {
      await this.ensureReady();

      const heartbeat = options.heartbeat ?? this._autoHeartbeat;
      if (heartbeat && heartbeat !== false) {
        const config = typeof heartbeat === "string" ? { slug: heartbeat } : heartbeat;
        const slug = config.slug || "bot";
        const intervalMs = config.intervalMs ?? 60_000;
        await this.startHeartbeat(slug, {
          intervalMs,
          graceMs: config.graceMs ?? 30_000,
          metadata: config.metadata,
        });
      }

      this._state = "running";
      this._log(`Started (source: ${this.source})`, 6);
      return this.status();
    } catch (err) {
      this._state = "error";
      this._lastError = err?.message || String(err);
      throw err;
    }
  }

  async stop(options = {}) {
    this._state = "stopping";
    const stopped = this.stopAllHeartbeats();

    if (options.flush !== false) await this.flush();

    await this.shutdown();

    this._state = "stopped";
    this._paused = false;
    this._startedAt = null;
    this._log(`Stopped (${stopped.length} heartbeat(s) ended)`, 3);
    return this.status();
  }

  async restart(options = {}) {
    this._restarts++;
    this._log("Restarting...", 3);

    try {
      await this.stop(options);
    } catch (err) {
      this._log(`Stop during restart failed: ${err?.message || err}`, 4);
    }

    try {
      return await this.start({ ...options, heartbeat: options.heartbeat ?? this._autoHeartbeat });
    } catch (err) {
      this._state = "error";
      this._lastError = err?.message || String(err);
      throw err;
    }
  }

  async pause() {
    this._paused = true;
    this._log("Paused - queued events are being dropped", 3);
    return this.status();
  }

  async resume() {
    this._paused = false;
    this._log("Resumed - events are being accepted again", 6);
    return this.status();
  }

  async status() {
    return {
      state: this._state,
      ready: this._ready,
      paused: this._paused,
      source: this.source,
      apiUrl: this.apiUrl || "https://vantapi.pancake.wtf",
      apiKey: this.apiKey ? REDACTED : null,
      hasApiKey: Boolean(this.apiKey),
      debug: this.debug,
      startedAt: this._startedAt,
      uptimeMs: this._startedAt ? Date.now() - this._startedAt : 0,
      restarts: this._restarts,
      dropped: this._dropped,
      heartbeats: [...this._heartbeats.keys()],
      queuedEvents: await this.queueSize(),
      lastError: this._lastError,
    };
  }

  async flush() {
    if (!this._ready) return false;
    try {
      if (typeof this.client?.flush === "function") return await this.client.flush();
      return false;
    } catch (err) {
      this._handleError("flush", err);
      return false;
    }
  }

  async queueSize() {
    if (!this._ready) return 0;
    try {
      if (typeof this.client?.queueSize === "function") return await this.client.queueSize();
      return 0;
    } catch {
      return 0;
    }
  }

  async verify() {
    const started = Date.now();
    try {
      await this.ensureReady();
      const monitors = await this.client.uptime.listMonitors();
      this._lastError = null;
      return {
        ok: true,
        latencyMs: Date.now() - started,
        monitors: Array.isArray(monitors) ? monitors.length : 0,
      };
    } catch (err) {
      this._lastError = err?.message || String(err);
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: this._lastError,
        statusCode: err?.statusCode ?? null,
        code: err?.code ?? null,
      };
    }
  }

  async ping() {
    return this.verify();
  }

  redact(value, options = {}) {
    const maxDepth = options.depth ?? 4;
    const seen = new WeakSet();

    const walk = (input, depth) => {
      if (input === null || input === undefined) return input;
      if (typeof input !== "object") return input;
      if (seen.has(input)) return "[Circular]";
      if (depth > maxDepth) return "[Object]";
      seen.add(input);

      if (Array.isArray(input)) return input.map((item) => walk(item, depth + 1));

      if (input instanceof Date) return input;
      if (input instanceof Error) {
        return { name: input.name, message: walk(input.message, depth + 1), stack: input.stack };
      }
      if (input instanceof Map) {
        return Object.fromEntries([...input.entries()].map(([k, v]) => [walk(k, depth + 1), walk(v, depth + 1)]));
      }
      if (input instanceof Set) {
        return [...input].map((item) => walk(item, depth + 1));
      }

      const output = {};
      for (const key of Object.keys(input)) {
        let raw;
        try {
          raw = input[key];
        } catch {
          output[key] = "[Unreadable]";
          continue;
        }

        if (isSecretKey(key)) {
          const isFlag = typeof raw === "boolean" || typeof raw === "number";
          output[key] = raw === null || raw === undefined || isFlag ? raw : REDACTED;
          continue;
        }

        output[key] = typeof raw === "function" ? `[Function ${raw.name || "anonymous"}]` : walk(raw, depth + 1);
      }

      return output;
    };

    return walk(value, 0);
  }

  async shutdown() {
    if (!this.client) return;
    const vanta = this.client;
    hide(this, "client", null);
    this._ready = false;
    this._initPromise = null;
    try {
      await vanta.shutdown();
      this._log("Shutdown complete", 6);
    } catch (err) {
      this._log(`Shutdown error: ${err.message}`, 4);
    }
  }

  async track(opts = {}) {
    if (this._skip("track")) return null;
    await this.ensureReady();
    try {
      const result = await this.client.track({
        ...opts,
        source: opts.source ?? this.source,
      });
      this._delivered++;
      return result;
    } catch (err) {
      this._handleError("track", err);
      return null;
    }
  }

  async trackAndIdentify(eventOpts, identifyOpts) {
    const results = await Promise.allSettled([
      this.track(eventOpts),
      this.identify(identifyOpts),
    ]);
    return results;
  }

  async error(err, extra = {}) {
    if (this._skip("error")) return null;
    await this.ensureReady();
    try {
      const result = await this.client.error(err, extra);
      this._delivered++;
      return result;
    } catch (e) {
      this._handleError("error", e);
      return null;
    }
  }

  async identify(opts = {}) {
    if (this._skip("identify")) return null;
    await this.ensureReady();
    try {
      const result = await this.client.identify(opts);
      this._delivered++;
      return result;
    } catch (err) {
      this._handleError("identify", err);
      return null;
    }
  }

  async group(opts = {}) {
    if (this._skip("group")) return null;
    await this.ensureReady();
    try {
      const result = await this.client.group(opts);
      this._delivered++;
      return result;
    } catch (err) {
      this._handleError("group", err);
      return null;
    }
  }

  async measure(opts = {}) {
    if (this._skip("measure")) return null;
    await this.ensureReady();
    try {
      const result = await this.client.measure(opts);
      this._delivered++;
      return result;
    } catch (err) {
      this._handleError("measure", err);
      return null;
    }
  }

  async increment(name, value = 1, tags) {
    if (this._skip("increment")) return null;
    await this.ensureReady();
    try {
      if (tags) {
        return (await this.client.metrics?.submit?.({
          name,
          value,
          type: "counter",
          tags,
        })) ?? (await this.client.increment(name, value));
      }
      return await this.client.increment(name, value);
    } catch (err) {
      this._handleError("increment", err);
      return null;
    }
  }

  async decrement(name, value = 1) {
    if (this._skip("decrement")) return null;
    await this.ensureReady();
    try {
      return await this.client.decrement(name, value);
    } catch (err) {
      this._handleError("decrement", err);
      return null;
    }
  }

  async queryMetric(opts) {
    await this.ensureReady();
    try {
      return await this.client.metrics.query(opts);
    } catch (err) {
      this._handleError("metrics.query", err);
      return null;
    }
  }

  async metricTimeseries(opts) {
    await this.ensureReady();
    try {
      return await this.client.metrics.timeseries(opts);
    } catch (err) {
      this._handleError("metrics.timeseries", err);
      return null;
    }
  }

  async metricCurrent(name) {
    await this.ensureReady();
    try {
      return await this.client.metrics.current({ name });
    } catch (err) {
      this._handleError("metrics.current", err);
      return null;
    }
  }

  async listMetrics() {
    await this.ensureReady();
    try {
      return await this.client.metrics.list();
    } catch (err) {
      this._handleError("metrics.list", err);
      return null;
    }
  }

  async queryEvents(opts = {}) {
    await this.ensureReady();
    try {
      return await this.client.queryEvents(opts);
    } catch (err) {
      this._handleError("queryEvents", err);
      return null;
    }
  }

  async getEvent(eventId) {
    await this.ensureReady();
    try {
      return await this.client.getEvent(eventId);
    } catch (err) {
      this._handleError("getEvent", err);
      return null;
    }
  }

  async count(opts = {}) {
    await this.ensureReady();
    try {
      return await this.client.count(opts);
    } catch (err) {
      this._handleError("count", err);
      return null;
    }
  }

  async groupBy(opts = {}) {
    await this.ensureReady();
    try {
      return await this.client.groupBy(opts);
    } catch (err) {
      this._handleError("groupBy", err);
      return null;
    }
  }

  async timeseries(opts = {}) {
    await this.ensureReady();
    try {
      return await this.client.timeseries(opts);
    } catch (err) {
      this._handleError("timeseries", err);
      return null;
    }
  }

  async aggregate(opts = {}) {
    await this.ensureReady();
    try {
      return await this.client.aggregate(opts);
    } catch (err) {
      this._handleError("aggregate", err);
      return null;
    }
  }

  async unique(opts = {}) {
    await this.ensureReady();
    try {
      return await this.client.unique(opts);
    } catch (err) {
      this._handleError("unique", err);
      return null;
    }
  }

  async heartbeat(slug, opts = {}) {
    await this.ensureReady();
    try {
      return await this.client.uptime.heartbeat(slug, opts);
    } catch (err) {
      this._handleError("uptime.heartbeat", err);
      return null;
    }
  }

  async startHeartbeat(slug, opts = {}) {
    await this.ensureReady();
    try {
      const existing = this._heartbeats.get(slug);
      if (existing) {
        try {
          existing.stop();
        } catch {}
        this._heartbeats.delete(slug);
      }

      const runner = this.client.uptime.start(slug, opts);
      this._heartbeats.set(slug, runner);
      this._log(`Heartbeat started: ${slug}`, 6);
      return runner;
    } catch (err) {
      this._handleError("uptime.start", err);
      return null;
    }
  }

  stopHeartbeat(slug) {
    const runner = this._heartbeats.get(slug);
    if (!runner) return false;
    try {
      runner.stop();
    } catch (err) {
      this._handleError("uptime.stop", err);
    }
    this._heartbeats.delete(slug);
    this._log(`Heartbeat stopped: ${slug}`, 3);
    return true;
  }

  stopAllHeartbeats() {
    const slugs = [...this._heartbeats.keys()];
    for (const slug of slugs) this.stopHeartbeat(slug);
    return slugs;
  }

  listHeartbeats() {
    return [...this._heartbeats.keys()];
  }

  async monitorStop() {
    return this.stop();
  }

  async createMonitor(opts = {}) {
    await this.ensureReady();
    try {
      const monitor = await this.client.uptime.createMonitor(opts);
      return monitor;
    } catch (err) {
      this._handleError("uptime.createMonitor", err);
      return null;
    }
  }

  async getMonitor(idOrSlug) {
    await this.ensureReady();
    try {
      return await this.client.uptime.getMonitor(idOrSlug);
    } catch (err) {
      this._handleError("uptime.getMonitor", err);
      return null;
    }
  }

  async listMonitors() {
    await this.ensureReady();
    try {
      return await this.client.uptime.listMonitors();
    } catch (err) {
      this._handleError("uptime.listMonitors", err);
      return null;
    }
  }

  async updateMonitor(id, data = {}) {
    await this.ensureReady();
    try {
      return await this.client.uptime.updateMonitor(id, data);
    } catch (err) {
      this._handleError("uptime.updateMonitor", err);
      return null;
    }
  }

  async stopMonitor(id) {
    await this.ensureReady();
    try {
      return await this.client.uptime.stopMonitor(id);
    } catch (err) {
      this._handleError("uptime.stopMonitor", err);
      return null;
    }
  }

  async deleteMonitor(id) {
    await this.ensureReady();
    try {
      const result = await this.client.uptime.deleteMonitor(id);
      return result;
    } catch (err) {
      this._handleError("uptime.deleteMonitor", err);
      return null;
    }
  }

  async getHeartbeats(monitorId, opts = {}) {
    await this.ensureReady();
    try {
      return await this.client.uptime.getHeartbeats(monitorId, opts);
    } catch (err) {
      this._handleError("uptime.getHeartbeats", err);
      return null;
    }
  }

  async getIncidents(monitorId, opts = {}) {
    await this.ensureReady();
    try {
      return await this.client.uptime.getIncidents(monitorId, opts);
    } catch (err) {
      this._handleError("uptime.getIncidents", err);
      return null;
    }
  }

  async getUptimeStats(monitorId, range = "7d") {
    await this.ensureReady();
    try {
      return await this.client.uptime.getStats(monitorId, range);
    } catch (err) {
      this._handleError("uptime.getStats", err);
      return null;
    }
  }

  _skip(method) {
    if (!this._paused) return false;
    this._dropped++;
    if (this.debug) this._log(`${method} skipped (paused)`, 3);
    return true;
  }

  _protect(vanta) {
    const mask = (holder) => {
      if (!holder || typeof holder !== "object") return;
      if (!Object.prototype.hasOwnProperty.call(holder, "apiKey")) return;

      const value = holder.apiKey;
      try {
        Object.defineProperty(holder, "apiKey", {
          get: () => value,
          set: () => {},
          enumerable: false,
          configurable: true,
        });
      } catch {}
    };

    mask(vanta.config);
    mask(vanta.transport);
  }

  _log(message, level = 6) {
    console.log(color("%", `%${level}[Vanta]%7 :: ${message}`));
  }

  [inspect.custom]() {
    return {
      state: this._state,
      ready: this._ready,
      paused: this._paused,
      source: this.source,
      apiUrl: this.apiUrl || "https://vantapi.pancake.wtf",
      apiKey: this.apiKey ? REDACTED : null,
      hasApiKey: Boolean(this.apiKey),
      debug: this.debug,
      startedAt: this._startedAt,
      restarts: this._restarts,
      dropped: this._dropped,
      delivered: this._delivered,
      heartbeats: [...this._heartbeats.keys()],
      lastError: this._lastError,
    };
  }

  toJSON() {
    return {
      state: this._state,
      ready: this._ready,
      paused: this._paused,
      source: this.source,
      apiUrl: this.apiUrl || "https://vantapi.pancake.wtf",
      apiKey: this.apiKey ? REDACTED : null,
      hasApiKey: Boolean(this.apiKey),
      heartbeats: [...this._heartbeats.keys()],
      dropped: this._dropped,
      delivered: this._delivered,
      restarts: this._restarts,
      startedAt: this._startedAt,
      lastError: this._lastError,
    };
  }

  _handleError(method, err) {
    this._lastError = err?.message || String(err);
    try {
      const { RateLimitError, AuthenticationError, VantaError } = require("@vanta-dev/node");

      if (err instanceof RateLimitError) {
        console.log(color("%", `%3[Vanta]%7 :: ${method} rate-limited - retry after ${err.retryAfter}s`));
        return;
      }

      if (err instanceof AuthenticationError) {
        console.log(color("%", `%4[Vanta]%7 :: ${method} authentication failed - check VANTA`));
        return;
      }

      if (err instanceof VantaError) {
        console.log(color("%", `%4[Vanta]%7 :: ${method} failed [${err.statusCode ?? "??"} ${err.code ?? "unknown"}]: ${err.message}`));
        return;
      }
    } catch {}

    const msg = err?.message || String(err);
    console.log(color("%", `%4[Vanta]%7 :: ${method} failed: ${msg}`));
    if (err?.stack) console.log(err.stack);
  }

  _handleDeliveryError(err, events) {
    const count = Array.isArray(events) ? events.length : "?";
    this._lastError = err?.message || String(err);
    try {
      const { RateLimitError, AuthenticationError, VantaError } = require("@vanta-dev/node");

      if (err instanceof RateLimitError) {
        console.log(color("%", `%3[Vanta]%7 :: delivery rate-limited (${count} event(s)) - retry after ${err.retryAfter}s`));
        return;
      }

      if (err instanceof AuthenticationError) {
        console.log(color("%", `%4[Vanta]%7 :: delivery authentication failed (${count} event(s)) - check VANTA`));
        return;
      }

      if (err instanceof VantaError) {
        console.log(color("%", `%4[Vanta]%7 :: delivery failed (${count} event(s)) [${err.statusCode ?? "??"} ${err.code ?? "unknown"}]: ${err.message}`));
        return;
      }
    } catch {}

    const msg = err?.message || String(err);
    console.log(color("%", `%4[Vanta]%7 :: delivery failed (${count} event(s)): ${msg}`));
  }
};
