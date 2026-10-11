const { ThreadAutoArchiveDuration } = require("@fluxerjs/core");

const AUTO_ARCHIVE = ThreadAutoArchiveDuration.OneWeek;

function threadName(value, fallback = "Thread") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

async function createThread(source, options = {}) {
  const name = threadName(options.name, options.fallbackName || "Thread");
  const payload = {
    name,
    autoArchiveDuration: options.autoArchiveDuration || AUTO_ARCHIVE,
  };
  
  if (options.reason) payload.reason = options.reason;

  let thread;
  if (source && typeof source.startThread === "function") {
    thread = await source.startThread(payload);
  } else if (source && source.threads && typeof source.threads.create === "function") {
    thread = await source.threads.create(payload);
  } else {
    throw new TypeError("createThread requires a message or a thread-capable channel");
  }

  // const description = String(options.description ?? "").trim();
  // if (description) {
  //   await thread.send({ content: description.slice(0, 2000) }).catch(() => {});
  // }

  return thread;
}

module.exports = createThread;
module.exports.AUTO_ARCHIVE = AUTO_ARCHIVE;
module.exports.threadName = threadName;
