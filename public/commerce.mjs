import { bookCover, displayedCatalog, isDemo, isOpen, priceDetails, statusLabel } from "./editorial.mjs";
import {
  action, api, button, checkbox, description, esc, field, formMessage, formStatus, handleForm,
  localDate, locale, money, navLink, notice, page, pageHeading, params, path, post, safeGet, safeSet, section, t, totals,
} from "./ui.mjs";

const title = "RouterOS pas cu pas";
const cartKey = "educatit-cart";
const activeOrder = "educatit-active-order";
const checkoutAttempt = "educatit-checkout-attempt";
const receiptKey = (id) => "educatit-receipt-" + id;
const defaultCart = { quantity: 0, demo: false };
const passwordAttrs = 'required minlength="12" maxlength="128"';
const emailAttrs = 'required maxlength="254" autocomplete="email"';
const states = {
  pending: "transactionPending", paid: "paid", failed: "failed", cancelled: "cancelled",
};

export function cart() {
  try {
    const value = JSON.parse(safeGet(localStorage, cartKey));
    if (Number.isInteger(value?.quantity) && value.quantity >= 1 && value.quantity <= 25) {
      return { quantity: value.quantity, demo: value.demo === true };
    }
  } catch {
    // A malformed cart can be replaced by a new one.
  }
  return defaultCart;
}

function setCart(quantity, demo = false) {
  return safeSet(localStorage, cartKey, quantity > 0 ? JSON.stringify({ quantity, demo }) : null);
}

function quantityField(value) {
  return '<div class="qty"><button type="button" data-qty="-1" aria-label="' + t("decrease") + '">−</button>' +
    '<input type="number" name="quantity" min="1" max="25" value="' + value + '" required aria-label="' + t("quantity") + '">' +
    '<button type="button" data-qty="1" aria-label="' + t("increase") + '">+</button></div>';
}

function catalogDetails(catalog, deliveryTerms) {
  return '<div class="stack"><p class="status-label">' + statusLabel(catalog.availability) + '</p>' +
    description(catalog.description) + '<p><strong>' + esc(catalog.edition) + '</strong>' +
    (catalog.bookLanguage ? ' · ' + esc(catalog.bookLanguage) : '') + '</p>' +
    priceDetails(catalog) + description(deliveryTerms || t("shippingPending")) + '</div>';
}

function shop(store) {
  const catalog = displayedCatalog(store);
  const demo = isDemo(catalog);
  return pageHeading(title, "", t("shop")) + section('<div class="two-col shop-layout"><div class="shop-cover">' +
    bookCover(catalog, true) + '<a class="text-link" href="' + path("gallery") + '">' + t("gallery") + '</a></div>' +
    '<div class="card stack shop-purchase">' + catalogDetails(catalog, store.content.delivery) +
    (demo ? notice(t("demoNote")) : "") +
    (isOpen(catalog)
      ? '<form data-add class="card-form"><div><p>' + t("quantity") + '</p>' + quantityField(1) + '</div>' +
        button(t(demo ? "addTestToCart" : "addToCart"), 'type="submit"') + formStatus +
        '<a class="text-link" href="' + path("cart") + '">' + t("viewCart") + '</a></form>'
      : '<div class="action-row">' + action(path("contact"), t("contact"), "button--ghost") + '</div>') +
    '</div></div>');
}

const quoteFor = (current) => post("quote", { ...current, locale });

function cartSummary(quote, store, next = "") {
  return '<div class="card"><h2>' + t("summary") + '</h2><p>' + title + '</p><div data-totals>' + totals(quote) + '</div>' +
    (store.content.delivery ? description(store.content.delivery) : "") +
    (next ? action(path("checkout"), next, "button--wide") : "") + '</div>';
}

async function cartPage(store) {
  const current = cart();
  const heading = pageHeading(t("cart"));
  if (current.quantity === 0) {
    return heading + section('<div class="card"><p>' + t("emptyCart") + '</p><div class="action-row">' +
      action(path("shop"), t("viewBook")) + '</div></div>', "narrow");
  }
  let quote;
  try {
    quote = await quoteFor(current);
  } catch {
    return heading + section(notice(t("comingSoon")) + '<div class="action-row">' + action(path("shop"), t("viewBook")) + '</div>');
  }
  return heading + section('<div class="checkout-grid"><div class="card stack">' +
    (current.demo ? notice(t("demoNote")) : "") + '<div class="cart-item">' + bookCover(displayedCatalog(store)) +
    '<div><h2>' + title + '</h2><p>' + esc(store.catalog.edition) + '</p></div></div>' +
    '<form data-cart class="card-form"><div><p>' + t("quantity") + '</p>' + quantityField(current.quantity) +
    '</div>' + button(t("remove"), 'type="button" data-remove', "button--ghost") + formStatus + '</form></div>' +
    cartSummary(quote, store, t(current.demo ? "demoCheckout" : "checkout")) + '</div>');
}

function signInLink() {
  return '<a class="text-link" href="' + path("account?next=checkout") + '">' + t("signIn") + '</a>';
}

async function checkout(store, profile) {
  const heading = pageHeading(t("checkout"));
  const current = cart();
  if (!current.quantity) return heading + section(notice(t("emptyCart")) + '<div class="action-row">' +
    action(path("shop"), t("shop")) + '</div>', "narrow");
  let quote;
  try {
    quote = await quoteFor(current);
  } catch (error) {
    return heading + section(notice(error.code === "checkout_closed" ? t("comingSoon") : t("unavailable"), "error") +
      '<div class="action-row">' + action(path("shop"), t("shop")) + '</div>', "narrow");
  }
  const { user } = profile;
  const submitLabel = t(current.demo ? "submitDemo" : "submitOrder");
  return heading + section('<div class="checkout-grid"><div class="card stack">' +
    (current.demo ? notice(t("demoNote")) : notice(t("hostedPayment"))) +
    (user ? '<p>' + t("loggedAs") + ' <strong>' + esc(user.email) + '</strong></p>' :
      '<div><p>' + t("chooseGuest") + '</p>' + signInLink() + '</div>') +
    '<form id="checkout-form" class="card-form" data-unit="' + quote.unitPriceMinor +
    '" data-total="' + quote.totalMinor + '"><h2>' + t("buyerInfo") + '</h2><div class="form-grid">' +
    field("name", t("fullName"), { value: user?.name, attrs: 'required autocomplete="name" maxlength="120"' }) +
    field("email", t("emailAddress"), { type: "email", value: user?.email, attrs: emailAttrs + (user ? " readonly" : "") }) +
    '</div><h2>' + t("shippingAddress") + '</h2><div class="form-grid">' +
    field("line1", t("street"), { full: true, attrs: 'required maxlength="240" autocomplete="address-line1"' }) +
    field("line2", t("streetExtra"), { full: true, attrs: 'maxlength="200" autocomplete="address-line2"' }) +
    field("city", t("city"), { attrs: 'required maxlength="120" autocomplete="address-level2"' }) +
    field("county", t("county"), { attrs: 'required maxlength="100" autocomplete="address-level1"' }) +
    field("postalCode", t("postal"), { attrs: 'required pattern="[0-9]{6}" maxlength="6" inputmode="numeric" autocomplete="postal-code"' }) +
    field("phone", t("phone"), { type: "tel", attrs: 'required maxlength="22" autocomplete="tel"' }) +
    '</div><p><strong>' + t("country") + '</strong> · ' + t("romania") + '</p>' +
    '<p class="checkout-policies">' + navLink("terms", "terms") + navLink("privacy", "privacy") + '</p>' +
    checkbox("acceptedTerms", t("acceptTerms"), "required") +
    button(submitLabel, 'type="submit"') + formStatus + '</form></div>' +
    cartSummary(quote, store) + '</div>');
}

function orderHeading(order) {
  const status = t(states[order.status]);
  return '<span class="status-label">' + status + '</span>' +
    (order.mode !== "stripe_live" ? '<span class="status-label status-label--test">' + t("demoOrder") + '</span>' : "");
}

function receiptActions(order) {
  if (order.status === "pending" && order.mode === "demo") {
    return '<form id="demo-pay" class="card-form"><div class="action-row">' +
      button(t("simulatePaid"), 'type="submit" name="result" value="paid"') +
      button(t("simulateFailed"), 'type="submit" name="result" value="failed"', "button--ghost") +
      button(t("simulateCancelled"), 'type="submit" name="result" value="cancelled"', "button--ghost") +
      '</div>' + formStatus + '</form>';
  }
  if (order.status === "pending") {
    const cancelled = params.get("cancelled") === "1";
    return description(t(cancelled ? "cancelledHelp" : "pendingHelp")) + '<div class="action-row">' +
      (cancelled ? action(path("checkout"), t("checkout")) : button(t("refresh"), 'type="button" data-refresh')) + '</div>';
  }
  if (order.status === "paid") {
    return description(t(order.mode === "stripe_live" ? "paidHelp" : "demoPaidHelp"));
  }
  return '<div class="action-row">' + action(path("checkout"), t("tryAgain")) + '</div>';
}

async function receipt(id) {
  const key = safeGet(sessionStorage, receiptKey(id));
  let order;
  try {
    order = await api("orders/" + encodeURIComponent(id), { headers: key ? { Authorization: "Bearer " + key } : {} });
  } catch {
    return pageHeading(t("receipt")) + section(notice(t("receiptMissing")) + '<div class="action-row">' +
      action(path("dashboard"), t("dashboard")) + action(path("shop"), t("shop"), "button--ghost") + '</div>', "narrow");
  }
  if (order.status === "paid" && safeGet(sessionStorage, activeOrder) === id) {
    setCart(0);
    safeSet(sessionStorage, checkoutAttempt, null);
    safeSet(sessionStorage, activeOrder, null);
  } else if (["failed", "cancelled"].includes(order.status) && safeGet(sessionStorage, activeOrder) === id) {
    safeSet(sessionStorage, checkoutAttempt, null);
  }
  return pageHeading(t("receipt"), order.number) + section('<div class="card stack"><div class="action-row">' +
    orderHeading(order) + '</div><h2>' + esc(order.title) + '</h2>' + totals(order) +
    (order.preorder ? '<p><strong>' + t("orderType") + '</strong> · ' + t("preorder") + '</p>' : "") +
    (order.status === "paid" ? '<p>' + t("delivery") + ' · ' + t(order.fulfillment === "cancelled" ? "fulfilmentCancelled" : order.fulfillment) + '</p>' : "") +
    description(order.deliveryTerms) + receiptActions(order) + '</div>', "narrow");
}

function authForm(view, profile) {
  const signingUp = view === "register";
  const follow = params.get("next") === "checkout" ? "?next=checkout" : "";
  const heading = t(signingUp ? "register" : "signIn");
  return pageHeading(heading, t("signInHelp")) + section('<form id="auth-form" class="card card-form" data-action="' + view + '">' +
    (signingUp ? field("name", t("fullName"), { attrs: 'required maxlength="120" autocomplete="name"' }) : "") +
    field("email", t("emailAddress"), { type: "email", attrs: emailAttrs }) +
    field("password", t("password"), { type: "password", attrs: passwordAttrs + ' autocomplete="' + (signingUp ? "new-password" : "current-password") + '"' }) +
    (signingUp ? '<p class="subtle">' + t("passwordHelp") + '</p>' : "") +
    button(heading, 'type="submit"') + formStatus + '<div class="action-row">' +
    action(path(signingUp ? "account" + follow : "account/register" + follow), t(signingUp ? "signIn" : "register"), "button--ghost") +
    (!signingUp && profile.resetAvailable ? '<a class="text-link" href="' + path("account/forgot") + '">' + t("forgot") + '</a>' : "") +
    '</div></form>', "narrow");
}

function forgotten(profile) {
  return pageHeading(t("forgot")) + section(profile.resetAvailable ?
    '<form id="forgot-form" class="card card-form">' +
    field("email", t("emailAddress"), { type: "email", attrs: emailAttrs }) +
    button(t("sendReset"), 'type="submit"') + formStatus + '</form>' : notice(t("unavailable")), "narrow");
}

function resetPage() {
  return pageHeading(t("reset")) + section('<form id="reset-form" class="card card-form">' +
    field("password", t("newPassword"), { type: "password", attrs: passwordAttrs + ' autocomplete="new-password"' }) +
    '<p class="subtle">' + t("passwordHelp") + '</p>' + button(t("reset"), 'type="submit"') + formStatus +
    '<a class="text-link" href="' + path("account") + '">' + t("signIn") + '</a></form>', "narrow");
}

function unsubscribePage() {
  return pageHeading(t("unsubscribe")) + section('<form id="unsubscribe-form" class="card card-form">' +
    button(t("unsubscribeAction"), 'type="submit"') + formStatus + '</form>', "narrow");
}

async function dashboard(profile) {
  if (!profile.user) return authForm("login", profile);
  const { orders } = await api("orders");
  return pageHeading(t("dashboard"), escAccountName(profile.user)) + section('<div class="checkout-grid">' +
    '<div class="card"><h2>' + t("orders") + '</h2>' +
    (orders.length ? '<div class="order-list">' + orders.map(order =>
      '<article class="order-line"><div><h3><a href="' + path("checkout/receipt/" + order.id) + '">' +
      esc(order.number) + '</a></h3><p>' + localDate(order.createdAt) + ' · ' + esc(order.quantity) + ' × ' + esc(order.title) + '</p></div>' +
      '<div>' + orderHeading(order) + '<strong>' + money(order.totalMinor) + '</strong></div></article>').join("") + '</div>'
      : '<p>' + t("noOrders") + '</p><div class="action-row">' + action(path("shop"), t("shop")) + '</div>') + '</div>' +
    '<div class="card stack"><h2>' + t("account") + '</h2><p>' + esc(profile.user.email) + '</p>' +
    '<form id="profile-form" class="card-form">' + field("name", t("fullName"), {
      value: profile.user.name, attrs: 'required maxlength="120" autocomplete="name"',
    }) + button(t("changeName"), 'type="submit"', "button--ghost") + formStatus + '</form>' +
    '<form id="logout-form" class="card-form">' + button(t("signOut"), 'type="submit"', "button--ghost") + formStatus +
    '</form></div></div>');
}

function escAccountName(user) {
  return user.name + " · " + user.email;
}

export async function commercePage(name, store, profile) {
  switch (name) {
    case "shop": return shop(store);
    case "cart": return cartPage(store);
    case "checkout":
      return page[1] === "receipt" && /^[a-f0-9-]{36}$/.test(page[2] ?? "") ? receipt(page[2]) : checkout(store, profile);
    case "dashboard": return dashboard(profile);
    case "account":
      if (page[1] === "forgot") return forgotten(profile);
      if (page[1] === "reset") return resetPage();
      if (page[1] === "unsubscribe") return unsubscribePage();
      if (profile.user) return dashboard(profile);
      return authForm(page[1] === "register" ? "register" : "login", profile);
    default:
      return pageHeading(t("notFound")) + section(action(path(), t("home")));
  }
}

function notifyCart() {
  document.dispatchEvent(new CustomEvent("educatit-cart-change"));
}

async function attemptToken(body) {
  const input = new TextEncoder().encode(JSON.stringify(body));
  const key = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", input)), n => n.toString(16).padStart(2, "0")).join("");
  const stored = safeGet(sessionStorage, checkoutAttempt);
  if (stored?.startsWith(key + ":")) return stored.slice(key.length + 1);
  const receipt = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");
  if (!safeSet(sessionStorage, checkoutAttempt, key + ":" + receipt)) throw new Error(t("unavailable"));
  return receipt;
}

function readOneTimeToken() {
  const hash = location.hash.slice(1);
  const candidate = params.get("token") || (/^[a-f0-9]{64}$/.test(hash) ? hash : "");
  if (candidate) {
    safeSet(sessionStorage, "educatit-link-" + page[1], candidate);
    history.replaceState(null, "", location.pathname);
  }
  return candidate || safeGet(sessionStorage, "educatit-link-" + page[1]) || "";
}

export function bindCommerce(root, store) {
  const add = root.querySelector("[data-add]");
  const editCart = root.querySelector("[data-cart]");
  const form = root.querySelector("#checkout-form");
  for (const widget of root.querySelectorAll(".qty")) {
    const input = widget.querySelector("input");
    widget.addEventListener("click", event => {
      const control = event.target.closest("[data-qty]");
      if (!control) return;
      input.value = Math.max(1, Math.min(25, (Number(input.value) || 1) + Number(control.dataset.qty)));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  handleForm(add, ({ quantity }) => {
    const demo = isDemo(displayedCatalog(store));
    const existing = cart();
    const total = (existing.demo === demo ? existing.quantity : 0) + Number(quantity);
    if (total > 25) {
      const error = new Error("Choose between 1 and 25 books.");
      error.code = "invalid_quantity";
      throw error;
    }
    if (!setCart(total, demo)) throw new Error(t("unavailable"));
    formMessage(add, t("added"), true);
    notifyCart();
  });
  if (editCart) {
    editCart.addEventListener("submit", event => event.preventDefault());
    let generation = 0;
    const quantity = editCart.elements.namedItem("quantity");
    const refresh = root.querySelector("[data-totals]");
    quantity.addEventListener("change", async () => {
      if (!quantity.reportValidity()) return;
      const old = cart();
      const updated = Number(quantity.value);
      const snapshot = ++generation;
      try {
        const quote = await quoteFor({ quantity: updated, demo: old.demo });
        if (generation !== snapshot) return;
        if (!setCart(updated, old.demo)) throw new Error(t("unavailable"));
        refresh.innerHTML = totals(quote);
        formMessage(editCart, "");
        notifyCart();
      } catch {
        if (generation !== snapshot) return;
        quantity.value = old.quantity;
        formMessage(editCart, t("unavailable"));
      }
    });
    editCart.querySelector("[data-remove]").addEventListener("click", () => {
      setCart(0);
      location.reload();
    });
  }

  handleForm(form, async ({ name, email, acceptedTerms, ...shipping }) => {
    const body = {
      ...cart(), locale, name, email, shipping, acceptedTerms: Boolean(acceptedTerms),
      expectedTotalMinor: Number(form.dataset.total), expectedUnitMinor: Number(form.dataset.unit),
    };
    const token = await attemptToken(body);
    const order = await post("checkout", { ...body, receipt: token });
    if (!safeSet(sessionStorage, receiptKey(order.id), token) || !safeSet(sessionStorage, activeOrder, order.id)) {
      throw new Error(t("unavailable"));
    }
    location.assign(order.paymentUrl);
  }, async error => {
    if (error.code !== "quote_changed") return;
    try {
      const updated = await quoteFor(cart());
      form.dataset.total = updated.totalMinor;
      form.dataset.unit = updated.unitPriceMinor;
      root.querySelector("[data-totals]").innerHTML = totals(updated);
      form.elements.namedItem("acceptedTerms").checked = false;
    } catch {
      formMessage(form, t("unavailable"));
    }
  });

  handleForm(root.querySelector("#demo-pay"), async (_, event) => {
    const id = page[2];
    const result = event.submitter?.value;
    if (!result) return;
    await post("checkout/demo", { id, result, receipt: safeGet(sessionStorage, receiptKey(id)) });
    location.reload();
  });
  root.querySelector("[data-refresh]")?.addEventListener("click", () => location.reload());

  const auth = root.querySelector("#auth-form");
  handleForm(auth, async data => {
    await post("account/" + auth.dataset.action, data);
    location.assign(path(params.get("next") === "checkout" ? "checkout" : "dashboard"));
  });
  const forgot = root.querySelector("#forgot-form");
  handleForm(forgot, async data => {
    await post("account/forgot", { ...data, locale });
    forgot.reset();
    formMessage(forgot, t("resetSent"), true);
  });
  const reset = root.querySelector("#reset-form");
  const unsubscribe = root.querySelector("#unsubscribe-form");
  const oneTime = reset || unsubscribe ? readOneTimeToken() : "";
  handleForm(reset, async data => {
    await post("account/reset", { ...data, token: oneTime });
    safeSet(sessionStorage, "educatit-link-reset", null);
    reset.reset();
    formMessage(reset, t("resetDone"), true);
  });
  handleForm(unsubscribe, async () => {
    await post("unsubscribe", { token: oneTime });
    safeSet(sessionStorage, "educatit-link-unsubscribe", null);
    formMessage(unsubscribe, t("unsubscribed"), true);
  });
  const profile = root.querySelector("#profile-form");
  handleForm(profile, async (data) => {
    await api("account", { method: "PATCH", body: data });
    formMessage(profile, t("saved"), true);
  });
  handleForm(root.querySelector("#logout-form"), async () => {
    await post("account/logout");
    location.assign(path("account"));
  });
}
