const color = require("../functions/colorCodes");

module.exports = class VantaHandler {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.VANTA_API_KEY;
    this.apiUrl = options.apiUrl;
    this.source = options.source || "node";
    this.debug = options.debug ?? false;

    this.client = null;
    this._ready = false;
    this._initPromise = null;
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
        };
        if (this.apiUrl) config.apiUrl = this.apiUrl;

        this.client = new Vanta(config);
        this._ready = true;

        console.log(color("%", "%6[Vanta]%7 :: Client initialized"));
        return this.client;
      } catch (err) {
        console.log(color("%", `%4[Vanta]%7 :: Init failed: ${err.message}`));
        throw err;
      }
    })();

    return this._initPromise;
  }

  async ensureReady() {
    if (!this.apiKey) {
      throw new Error("VantaHandler: missing apiKey (set VANTA_API_KEY or pass apiKey)");
    }
    return this.init();
  }

  async shutdown() {
    if (!this.client) return;
    try {
      await this.client.shutdown();
      console.log(color("%", "%6[Vanta]%7 :: Shutdown complete"));
    } catch (err) {
      console.log(color("%", `%4[Vanta]%7 :: Shutdown error: ${err.message}`));
    } finally {
      this.client = null;
      this._ready = false;
      this._initPromise = null;
    }
  }

  async track(opts = {}) {
    await this.ensureReady();
    try {
      return await this.client.track({
        ...opts,
        source: opts.source ?? this.source,
      });
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
    await this.ensureReady();
    try {
      return await this.client.error(err, extra);
    } catch (e) {
      this._handleError("error", e);
      return null;
    }
  }

  async identify(opts = {}) {
    await this.ensureReady();
    try {
      const result = await this.client.identify(opts);
      return result;
    } catch (err) {
      this._handleError("identify", err);
      return null;
    }
  }

  async group(opts = {}) {
    await this.ensureReady();
    try {
      const result = await this.client.group(opts);
      return result;
    } catch (err) {
      this._handleError("group", err);
      return null;
    }
  }
  
  async measure(opts = {}) {
    await this.ensureReady();
    try {
      return await this.client.measure(opts);
    } catch (err) {
      this._handleError("measure", err);
      return null;
    }
  }

  async increment(name, value = 1, tags) {
    await this.ensureReady();
    try {
      if (tags) {
        return await this.client.metrics?.submit?.({
          name,
          value,
          type: "counter",
          tags,
        }) ?? await this.client.increment(name, value);
      }
      return await this.client.increment(name, value);
    } catch (err) {
      this._handleError("increment", err);
      return null;
    }
  }

  async decrement(name, value = 1) {
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
      const runner = this.client.uptime.start(slug, opts);
      return runner;
    } catch (err) {
      this._handleError("uptime.start", err);
      return null;
    }
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
  
  _handleError(method, err) {
    const msg = err?.message || String(err);
    console.log(color("%", `%4[Vanta]%7 :: ${method} failed: ${msg}`));
    console.log(err.stack);
  }
};