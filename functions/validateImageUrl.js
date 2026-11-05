const dns = require("dns").promises;
const net = require("net");

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_URL_LENGTH = 350;
const MAX_REDIRECTS = 3;

function isPrivateAddress(address) {
  const value = String(address ?? "").toLowerCase();

  if (net.isIPv4(value)) {
    const [a, b, c] = value.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }

  if (!net.isIPv6(value)) return true;

  if (value === "::" || value === "::1") return true;
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (value.startsWith("ff")) return true;
  if (value.startsWith("2001:db8")) return true;
  if (value.startsWith("100:")) return true;

  return false;
}

async function assertPublicHost(parsed) {
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("Image links must start with http:// or https://.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Image links cannot contain a username or password.");
  }

  const hostname = parsed.hostname.toLowerCase();

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("That image link is not publicly reachable.");
    }
    return;
  }

  let addresses = [];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("That image link could not be reached.");
  }

  if (
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateAddress(entry.address))
  ) {
    throw new Error("That image link is not publicly reachable.");
  }
}

async function probe(url) {
  let response;
  try {
    response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      headers: {
        Accept: "image/*",
        "User-Agent": "FunctiousTranslationBot/1.0",
      },
    });
  } catch {
    throw new Error("That image link could not be reached.");
  }

  if ([405, 501].includes(response.status)) {
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(6000),
        headers: {
          Accept: "image/*",
          "User-Agent": "FunctiousTranslationBot/1.0",
          Range: "bytes=0-0",
        },
      });
      await response.body?.cancel();
    } catch {
      throw new Error("That image link could not be reached.");
    }
  }

  return response;
}

async function validateImageUrl(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return "";
  if (input.length > MAX_URL_LENGTH) {
    throw new Error("That image link is too long.");
  }

  let current;
  try {
    current = new URL(input);
  } catch {
    throw new Error("Enter a valid image URL.");
  }

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await assertPublicHost(current);

    const response = await probe(current);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("That image link could not be followed.");
      try {
        current = new URL(location, current);
      } catch {
        throw new Error("That image link could not be followed.");
      }
      continue;
    }

    if (!response.ok) {
      throw new Error("That image link could not be loaded.");
    }

    const contentType = String(response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new Error(
        "Use a JPEG, PNG, GIF, WebP, or AVIF image link.",
      );
    }

    return current.toString();
  }

  throw new Error("That image link redirects too many times.");
}

module.exports = { validateImageUrl };
