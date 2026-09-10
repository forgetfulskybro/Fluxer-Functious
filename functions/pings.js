const Polls = require("../models/polls");

async function Pings(client) {
  async function Database() {
    let beforeCall = Date.now();
    let pollCount = await Polls.countDocuments();
    return { ping: Date.now() - beforeCall, pollCount };
  }
  
  // async function botPing() {
  //   try {
  //     const start = Date.now();
  //     await client.rest.get("/gateway/bot");
  //     return Date.now() - start;
  //   } catch {
  //     return 0;
  //   }
  // }

  const gatewayPing = client.ws.ping;
  const [dbPing] = await Promise.all([Database()]);

  const memory = () => {
    const used = process.memoryUsage().heapUsed;
    return Number((used / 1048576).toFixed(2));
  };

  const memoryUsage = memory();
  
  await Promise.allSettled([
    client.vanta.measure({ name: "ping.gateway", value: gatewayPing, unit: "ms", tags: { type: "gateway" } }),
    client.vanta.measure({ name: "ping.db",      value: dbPing.ping,  unit: "ms", tags: { type: "database" } }),
    client.vanta.measure({ name: "ping.memory",  value: memoryUsage,  unit: "MB", tags: { type: "memory" } }),
  ]);

  return { gatewayPing, dbPing: dbPing.ping, pollCount: dbPing.pollCount, memory: memoryUsage };
}

module.exports = Pings;
