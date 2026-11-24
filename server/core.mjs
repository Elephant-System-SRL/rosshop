export class HttpError extends Error {
  constructor(status, message, code = "request_failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fail(status, message, code) {
  throw new HttpError(status, message, code);
}

export const enabled = (value) => value === true || value === "true";
export const localeOf = (value) => value === "ro" ? "ro" : "en";
export const localePrefix = (locale) => locale === "ro" ? "" : "/en";

export function query(db, sql, ...args) {
  const statement = db.prepare(sql);
  return args.length ? statement.bind(...args) : statement;
}

export async function all(db, sql, ...args) {
  return (await query(db, sql, ...args).all()).results;
}

export function respond(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function configuredOrigin(env) {
  try {
    const url = new URL(env.APP_ORIGIN);
    if (url.protocol === "https:" && url.href === url.origin + "/") {
      return url.origin;
    }
  } catch {
    // Production links are enabled only with a canonical HTTPS origin.
  }
  return null;
}

export function siteOrigin(request, env) {
  return configuredOrigin(env) ?? new URL(request.url).origin;
}

export async function readText(request, maxBytes) {
  if (Number(request.headers.get("Content-Length")) > maxBytes) {
    fail(413, "Request is too large.", "too_large");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let value = "";
  while (true) {
    const { value: bytes, done } = await reader.read();
    if (done) break;
    received += bytes.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      fail(413, "Request is too large.", "too_large");
    }
    value += decoder.decode(bytes, { stream: true });
  }
  return value + decoder.decode();
}

export async function jsonBody(request, maxBytes = 16_384) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) {
    fail(415, "Send an application/json request.", "invalid_content_type");
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    fail(403, "The request origin is invalid.", "invalid_origin");
  }
  try {
    const value = JSON.parse(await readText(request, maxBytes));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
  }
  fail(400, "Send a valid JSON object.", "invalid_json");
}

export function field(value, maximum, label, required = false) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string" || value.length > maximum) {
    fail(400, label + " is invalid.", "invalid_field");
  }
  const result = value.trim();
  if (required && !result) fail(400, label + " is required.", "required_field");
  return result;
}

export function emailOf(value, required = true) {
  const email = field(value, 254, "Email address", required).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, "Enter a valid email address.", "invalid_email");
  }
  return email;
}

export const iso = (timestamp) => timestamp === null ? null : new Date(timestamp).toISOString();

export function money(value, locale) {
  return new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", {
    style: "currency",
    currency: "RON",
    currencyDisplay: "code",
  }).format(value / 100);
}
