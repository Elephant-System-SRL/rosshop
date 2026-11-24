import { roErrors, translate } from "./text.mjs";

export const english = location.pathname === "/en" || location.pathname.startsWith("/en/");
export const locale = english ? "en" : "ro";
export const base = english ? "/en" : "";
export const page = (english ? location.pathname.slice(3) : location.pathname).split("/").filter(Boolean);
export const params = new URLSearchParams(location.search);
export const t = (key) => translate(locale, key);
export const path = (route = "") => base + "/" + route;
export const esc = (value = "") => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
export const money = (value) => new Intl.NumberFormat(english ? "en-GB" : "ro-RO", {
  style: "currency", currency: "RON", currencyDisplay: "code",
  minimumFractionDigits: Number(value) % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
}).format(value / 100);
export const localDate = (value) => new Intl.DateTimeFormat(english ? "en-GB" : "ro-RO", {
  dateStyle: "medium", timeZone: "Europe/Bucharest",
}).format(new Date(value));

const paths = {
  book: '<path d="M12 7v13M12 7C9 4 6 3 3 4v14c4-1 6 0 9 2 3-2 5-3 9-2V4c-3-1-6 0-9 3Z"/>',
  bag: '<path d="M5 7h14l2 14H3L5 7Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
  user: '<circle cx="12" cy="7" r="3.5"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  lab: '<path d="M5 4h14v16H5zM8 8l3 3-3 3m5 0h3"/>',
  network: '<rect x="8" y="3" width="8" height="5" rx="1"/><path d="M12 8v4m-7 4v-4h14v4"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/>',
  laptop: '<path d="M5 5h14v12H5zM2 20h20"/>',
  router: '<rect x="3" y="11" width="18" height="8" rx="2"/><path d="M6 11V5m12 6V5M7 15h.1m4 0h.1"/>',
  box: '<path d="m12 3 9 4.5v9L12 21l-9-4.5v-9L12 3zm9 4.5-9 5-9-5m9 5V21m-4-16 9 4.5"/>',
};

export const icon = (name) => '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + paths[name] + '</svg>';

export const navLink = (route, key) => '<a href="' + path(route) + '">' + esc(t(key)) + '</a>';
export const action = (href, text, modifier = "") => '<a class="button ' + modifier + '" href="' + esc(href) + '">' + esc(text) + '</a>';
export const button = (text, attrs = "", modifier = "") => '<button class="button ' + modifier + '" ' + attrs + '>' + esc(text) + '</button>';
export const overline = (text) => '<span class="overline">' + esc(text) + '</span>';
export const description = (value) => value ? '<p class="prose">' + esc(value) + '</p>' : "";
export const pageHeading = (heading, intro = "", label = "") => '<section class="page-header"><div class="container">' +
  (label ? overline(label) : "") + '<h1>' + esc(heading) + '</h1>' + description(intro) + '</div></section>';
export const section = (content, modifier = "") => '<section class="page-content"><div class="container ' + modifier + '">' + content + '</div></section>';
export const notice = (text, style = "") => '<p class="notice ' + (style ? 'notice--' + style : '') + '">' + esc(text) + '</p>';
export const formStatus = '<p class="form-status" role="status" aria-live="polite"></p>';

export function field(name, label, { type = "text", value = "", attrs = "", full = false, textarea = false } = {}) {
  const control = textarea
    ? '<textarea name="' + name + '" ' + attrs + '>' + esc(value) + '</textarea>'
    : '<input type="' + type + '" name="' + name + '" value="' + esc(value) + '" ' + attrs + '>';
  return '<div class="field' + (full ? ' field--full' : '') + '"><label>' + esc(label) + control + '</label></div>';
}

export function checkbox(name, label, attrs = "") {
  return '<label class="checkbox"><input type="checkbox" name="' + name + '" ' + attrs + '><span>' + esc(label) + '</span></label>';
}

export function selectField(name, label, options, selected, attrs = "") {
  return '<div class="field"><label>' + esc(label) + '<select name="' + name + '" aria-label="' + esc(label) + '" ' + attrs + '>' +
    options.map(([value, text]) => '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(text) + '</option>').join("") +
    '</select></label></div>';
}

export function totalRow(label, value, className = "") {
  return '<div class="' + className + '"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
}

export function totals(order) {
  return '<dl class="totals">' +
    totalRow(t("quantity"), order.quantity) +
    totalRow(order.savingsMinor > 0 ? t("promo") : t("livePrice"), money(order.unitPriceMinor)) +
    totalRow(t("subtotal"), money(order.subtotalMinor)) +
    totalRow(t("deliveryRomania"), money(order.deliveryMinor)) +
    (order.savingsMinor > 0 ? totalRow(t("savings"), money(order.savingsMinor), "savings") : "") +
    totalRow(t("total"), money(order.totalMinor), "total") + '</dl>';
}

export async function api(route, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch("/api/" + route, {
    ...options,
    credentials: "same-origin",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  let detail;
  try {
    detail = await response.json();
  } catch {
    detail = { error: t("unavailable") };
  }
  if (!response.ok) {
    const error = new Error(detail.error ?? t("unavailable"));
    error.code = detail.code;
    throw error;
  }
  return detail;
}

export const post = (route, body = {}) => api(route, { method: "POST", body });

export function errorText(error) {
  if (!english) return roErrors[error.code] ?? t("unavailable");
  return error instanceof TypeError ? t("unavailable") : error.message;
}

export function dataOf(form) {
  return Object.fromEntries(new FormData(form));
}

export function formMessage(form, text, success = false) {
  const status = form.querySelector(".form-status");
  if (!status) return;
  status.classList.toggle("success-text", success);
  status.textContent = text;
}

export function handleForm(form, submit, onError) {
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const trigger = event.submitter;
    if (trigger?.disabled) return;
    if (trigger) trigger.disabled = true;
    formMessage(form, "");
    try {
      await submit(dataOf(form), event);
    } catch (error) {
      formMessage(form, errorText(error));
      if (onError) await onError(error);
    } finally {
      if (trigger) trigger.disabled = false;
    }
  });
}

export function safeGet(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}
export function safeSet(storage, key, value) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
    return true;
  } catch { return false; }
}
