import { all, emailOf, fail, field, iso, localeOf, localePrefix, query, siteOrigin } from "./core.mjs";
import { calculateQuote, demoEnabled, getDemoCatalog, publicCatalog, publicContent } from "./catalog.mjs";
import { enqueueDelivery, mailInsert, orderConfirmation } from "./email.mjs";
import { checkRate, constantEqual, digest, isToken } from "./security.mjs";

const orderIdPattern = /^[a-f0-9-]{36}$/;
const fulfillmentTransitions = {
  unfulfilled: ["preparing", "shipped", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function quoteOrder(settings, env, locale, { quantity, demo }) {
  const catalog = demo === true ? getDemoCatalog(settings, env, locale) : publicCatalog(settings, env, locale);
  return calculateQuote(catalog, quantity);
}

function shippingDetails(body) {
  const shipping = body.shipping ?? {};
  const address = {
    line1: field(shipping.line1, 240, "Street address", true),
    line2: field(shipping.line2, 200, "Apartment or unit"),
    city: field(shipping.city, 120, "City", true),
    county: field(shipping.county, 100, "County", true),
    postalCode: field(shipping.postalCode, 6, "Postal code", true),
    phone: field(shipping.phone, 22, "Phone number", true),
    country: "RO",
  };
  if (!/^\d{6}$/.test(address.postalCode)) fail(400, "Enter a six-digit postal code.", "invalid_postal_code");
  if (!/^\+?[\d ()-]+$/.test(address.phone) || address.phone.replace(/\D/g, "").length < 9) {
    fail(400, "Enter a valid delivery phone number.", "invalid_phone");
  }
  return address;
}

function orderReceiptUrl(order) {
  return localePrefix(order.locale) + "/checkout/receipt/" + order.id;
}

function orderNumber(id) {
  return "ED-" + id.replaceAll("-", "").slice(0, 12).toUpperCase();
}

export function publishedOrder(order, privateDetails = false) {
  const {
    id, number, mode, status, currency, name, email,
    fulfillment_status, product_title, unit_minor, regular_minor,
    delivery_minor, total_minor, quantity, created_at, paid_at,
    preorder, delivery_terms, shipping,
  } = order;
  return {
    id, number, mode, status, currency, quantity,
    fulfillment: fulfillment_status,
    title: product_title,
    unitPriceMinor: unit_minor,
    regularPriceMinor: regular_minor,
    subtotalMinor: quantity * unit_minor,
    deliveryMinor: delivery_minor,
    totalMinor: total_minor,
    savingsMinor: quantity * (regular_minor - unit_minor),
    preorder: Boolean(preorder),
    deliveryTerms: delivery_terms,
    createdAt: iso(created_at),
    paidAt: iso(paid_at),
    ...(privateDetails ? { name, email, shipping: JSON.parse(shipping) } : {}),
  };
}

async function findOrder(db, id) {
  if (!orderIdPattern.test(id)) return null;
  return query(db, "SELECT * FROM store_orders WHERE id = ?", id).first();
}

async function buyerOrder(db, id, user, receipt) {
  const order = await findOrder(db, id);
  if (!order) fail(404, "Order not found.", "order_missing");
  if (user && order.user_id === user.id) return order;
  if (isToken(receipt) && constantEqual(order.receipt_hash, await digest(receipt))) return order;
  fail(404, "Order not found.", "order_missing");
}

function sessionParameters(request, env, order) {
  const receipt = new URL(orderReceiptUrl(order), siteOrigin(request, env));
  const cancel = new URL(receipt);
  cancel.searchParams.set("cancelled", "1");
  const fields = new URLSearchParams({
    mode: "payment",
    locale: order.locale,
    currency: "ron",
    client_reference_id: order.id,
    customer_email: order.email,
    success_url: receipt.href,
    cancel_url: cancel.href,
    "metadata[order_id]": order.id,
    "payment_method_types[0]": "card",
    "line_items[0][quantity]": String(order.quantity),
    "line_items[0][price_data][currency]": "ron",
    "line_items[0][price_data][unit_amount]": String(order.unit_minor),
    "line_items[0][price_data][product_data][name]": order.product_title,
  });
  if (order.delivery_minor > 0) {
    fields.set("line_items[1][quantity]", "1");
    fields.set("line_items[1][price_data][currency]", "ron");
    fields.set("line_items[1][price_data][unit_amount]", String(order.delivery_minor));
    fields.set("line_items[1][price_data][product_data][name]", order.locale === "ro" ? "Livrare în România" : "Delivery in Romania");
  }
  return fields;
}

async function stripeSession(request, env, order) {
  const endpoint = "https://api.stripe.com/v1/checkout/sessions";
  const authorization = { Authorization: "Bearer " + env.STRIPE_SECRET_KEY };
  let session;
  try {
    const response = order.provider_session
      ? await fetch(endpoint + "/" + encodeURIComponent(order.provider_session), {
        headers: authorization, signal: AbortSignal.timeout(15_000),
      })
      : await fetch(endpoint, {
        method: "POST",
        headers: {
          ...authorization,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": "educat-it/" + order.id,
        },
        body: sessionParameters(request, env, order),
        signal: AbortSignal.timeout(15_000),
      });
    if (!response.ok) throw new Error("Stripe session request failed");
    session = await response.json();
    if (typeof session.id !== "string" || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(session.id) ||
        session.livemode !== (order.mode === "stripe_live")) {
      throw new Error("Invalid Stripe session");
    }
  } catch {
    fail(502, "The payment page is temporarily unavailable. Please try again.", "payment_unavailable");
  }
  await query(env.DB, "UPDATE store_orders SET provider_session = ? WHERE id = ? AND provider_session IS NULL",
    session.id, order.id).run();
  if (session.status !== "open") return orderReceiptUrl(order);
  try {
    const url = new URL(session.url);
    if (url.origin === "https://checkout.stripe.com") return url.href;
  } catch {
    // Treat an invalid provider URL as an unavailable payment page.
  }
  fail(502, "The payment page is temporarily unavailable. Please try again.", "payment_unavailable");
}

export async function startCheckout(request, env, settings, user, body) {
  if (!isToken(body.receipt)) fail(400, "Start checkout from the order form.", "invalid_receipt");
  if (body.acceptedTerms !== true) fail(400, "Confirm the order terms before continuing.", "terms_required");
  const locale = localeOf(body.locale);
  const name = field(body.name, 120, "Full name", true);
  const email = user?.email ?? emailOf(body.email);
  const shipping = shippingDetails(body);
  const receiptHash = await digest(body.receipt);
  const requested = {
    name, email, shipping, locale, userId: user?.id ?? null, quantity: body.quantity,
    demo: body.demo === true, total: body.expectedTotalMinor, unit: body.expectedUnitMinor,
  };
  const fingerprint = await digest(JSON.stringify(requested));
  let order = await query(env.DB, "SELECT * FROM store_orders WHERE receipt_hash = ?", receiptHash).first();
  if (!order) {
    await checkRate(request, env, "checkout", 15, 60 * 60_000, user?.id ?? email);
    await checkRate(request, env, "checkout-source", 75, 60 * 60_000);
    const quote = quoteOrder(settings, env, locale, body);
    if (quote.totalMinor !== requested.total || quote.unitPriceMinor !== requested.unit) {
      fail(409, "The price or delivery charge changed. Review the updated total.", "quote_changed");
    }
    const id = crypto.randomUUID();
    await query(env.DB, `
      INSERT INTO store_orders (
        id, number, user_id, receipt_hash, name, email, shipping, mode, product_title, currency,
        quantity, unit_minor, regular_minor, delivery_minor, total_minor, created_at, locale,
        preorder, request_fingerprint, delivery_terms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(receipt_hash) DO NOTHING
    `, id, orderNumber(id), user?.id ?? null, receiptHash, name, email, JSON.stringify(shipping),
    quote.mode, settings.catalog.title, quote.currency, quote.quantity, quote.unitPriceMinor,
    quote.regularPriceMinor, quote.deliveryMinor, quote.totalMinor, Date.now(), locale,
    Number(quote.regularPriceMinor > quote.unitPriceMinor), fingerprint,
    publicContent(settings, locale).delivery).run();
    order = await query(env.DB, "SELECT * FROM store_orders WHERE receipt_hash = ?", receiptHash).first();
  }
  if (order.request_fingerprint !== fingerprint) {
    fail(409, "The checkout details changed. Review your order and try again.", "checkout_conflict");
  }
  const receiptUrl = orderReceiptUrl(order);
  const mode = order.mode;
  let paymentUrl = receiptUrl;
  if (order.status === "pending" && mode.startsWith("stripe_")) {
    const catalog = body.demo === true ? getDemoCatalog(settings, env, locale) : publicCatalog(settings, env, locale);
    if (catalog?.checkoutMode !== mode) fail(409, "Checkout is currently closed.", "checkout_closed");
    if (Date.now() - order.created_at > 24 * 60 * 60_000 && !order.provider_session) {
      fail(409, "The order payment window has expired.", "payment_expired");
    }
    paymentUrl = await stripeSession(request, env, order);
  }
  return { id: order.id, mode, paymentUrl };
}

export async function getReceipt(request, env, user, id) {
  const receipt = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  return publishedOrder(await buyerOrder(env.DB, id, user, receipt));
}

async function applyPayment(env, ctx, order, eventId, eventType, status, providerSession = null) {
  const now = Date.now();
  const statements = [query(env.DB, `
    INSERT INTO store_payment_events (id, order_id, event_type, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
  `, eventId, order.id, eventType, now)];
  if (providerSession) {
    statements.push(query(env.DB, `
      UPDATE store_orders SET provider_session = ? WHERE id = ? AND provider_session IS NULL
    `, providerSession, order.id));
  }
  let mailId;
  if (status === "paid") {
    mailId = "order-confirmation-" + order.id;
    statements.push(query(env.DB, `
      UPDATE store_orders SET status = 'paid', paid_at = ?
      WHERE id = ? AND status <> 'paid'
    `, now, order.id));
    statements.push(mailInsert(env.DB, {
      ...orderConfirmation(order),
      id: mailId,
      kind: "order-confirmation",
      recipient: order.email,
      mode: order.mode === "stripe_live" ? "live" : "demo",
      createdAt: now,
    }));
  } else if (status) {
    statements.push(query(env.DB, `
      UPDATE store_orders SET status = ?
      WHERE id = ? AND status = 'pending'
    `, status, order.id));
  }
  await env.DB.batch(statements);
  if (mailId) await enqueueDelivery(env, mailId, ctx);
}

export async function finishDemo(env, ctx, user, body) {
  if (!demoEnabled(env)) fail(404, "Test payment is unavailable.", "checkout_closed");
  const order = await buyerOrder(env.DB, body.id, user, body.receipt);
  if (order.mode !== "demo") fail(404, "Test payment is unavailable.", "checkout_closed");
  if (!["paid", "failed", "cancelled"].includes(body.result)) fail(400, "Choose a test result.", "invalid_result");
  if (order.status === "pending") {
    // Only the first terminal demo result wins, including simultaneous clicks.
    const now = Date.now();
    const id = "demo:" + order.id;
    const mail = orderConfirmation(order);
    const statements = [
      query(env.DB, `
        UPDATE store_orders SET status = ?, paid_at = ? WHERE id = ? AND status = 'pending'
      `, body.result, body.result === "paid" ? now : null, order.id),
      query(env.DB, `
        INSERT INTO store_payment_events (id, order_id, event_type, created_at)
        SELECT ?, id, 'demo.' || status, ? FROM store_orders WHERE id = ?
        ON CONFLICT(id) DO NOTHING
      `, id, now, order.id),
      query(env.DB, `
        INSERT INTO store_mail (id, kind, recipient, subject, body, mode, created_at)
        SELECT ?, 'order-confirmation', email, ?, ?, 'demo', ?
        FROM store_orders WHERE id = ? AND status = 'paid'
        ON CONFLICT(id) DO NOTHING
      `, "order-confirmation-" + order.id, mail.subject, mail.body, now, order.id),
    ];
    await env.DB.batch(statements);
  }
  return publishedOrder(await findOrder(env.DB, order.id));
}

const paymentEvents = new Map([
  ["checkout.session.completed", "paid"],
  ["checkout.session.async_payment_succeeded", "paid"],
  ["checkout.session.async_payment_failed", "failed"],
  ["checkout.session.expired", "cancelled"],
]);

async function verifiedStripeEvent(payload, signature, secret) {
  const entries = signature.split(",").map(part => part.trim().split("=", 2));
  const timestamp = entries.find(([key]) => key === "t")?.[1];
  const signatures = entries.filter(([key, value]) => key === "v1" && /^[a-f0-9]{64}$/.test(value ?? ""));
  if (!/^\d{10}$/.test(timestamp ?? "") || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !signatures.length) {
    fail(400, "Invalid payment signature.", "invalid_signature");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + "." + payload)));
  const expected = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
  if (!signatures.some(([, value]) => constantEqual(expected, value))) {
    fail(400, "Invalid payment signature.", "invalid_signature");
  }
  try {
    return JSON.parse(payload);
  } catch {
    fail(400, "Invalid payment event.", "invalid_event");
  }
}

export async function stripeWebhook(env, ctx, payload, signature) {
  if (!/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET ?? "")) fail(404, "Payment events are unavailable.", "webhook_disabled");
  const event = await verifiedStripeEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!event || !paymentEvents.has(event.type)) return;
  const session = event.data?.object;
  const id = session?.metadata?.order_id;
  if (!id || id !== session.client_reference_id) return;
  const order = await findOrder(env.DB, id);
  if (!order || order.mode === "demo") return;
  if (!/^evt_[A-Za-z0-9]+$/.test(event.id ?? "") ||
      session.object !== "checkout.session" || session.mode !== "payment" ||
      !/^cs_(live|test)_[A-Za-z0-9]+$/.test(session.id ?? "") ||
      (order.provider_session && order.provider_session !== session.id) ||
      session.amount_total !== order.total_minor || session.currency !== "ron" ||
      event.livemode !== (order.mode === "stripe_live") ||
      session.livemode !== event.livemode) {
    fail(400, "The payment event does not match the order.", "payment_mismatch");
  }
  const state = paymentEvents.get(event.type);
  const payment = state === "paid" && session.payment_status !== "paid" ? null : state;
  await applyPayment(env, ctx, order, event.id, event.type, payment, session.id);
}

export async function customerOrders(db, user) {
  const orders = await all(db, "SELECT * FROM store_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", user.id);
  return orders.map(row => publishedOrder(row));
}

export async function adminOrders(db) {
  const orders = await all(db, "SELECT * FROM store_orders ORDER BY created_at DESC LIMIT 100");
  return orders.map(row => publishedOrder(row, true));
}

export async function updateFulfillment(db, id, next) {
  const order = await findOrder(db, id);
  if (!order) fail(404, "Order not found.", "order_missing");
  if (next === order.fulfillment_status) return publishedOrder(order, true);
  if (order.status !== "paid" || !fulfillmentTransitions[order.fulfillment_status].includes(next)) {
    fail(409, "This order cannot move to that delivery status.", "invalid_fulfillment");
  }
  const result = await query(db, `
    UPDATE store_orders SET fulfillment_status = ? WHERE id = ? AND status = 'paid' AND fulfillment_status = ?
  `, next, id, order.fulfillment_status).run();
  if (!result.meta.changes) fail(409, "The order changed. Refresh and try again.", "order_changed");
  return publishedOrder(await findOrder(db, id), true);
}
