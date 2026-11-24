import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorker } from "../server/index.mjs";
import { createLocalD1 } from "./sqlite-d1.mjs";

const bootstrap = "test-only-activate-owner-credentials";
const origin = "https://preview.example";
const token = () => randomBytes(32).toString("hex");
const profile = { name: "Cititor de test", email: "cititor@example.test", password: "some-good-length-password" };

function fixture(overrides = {}) {
  const DB = createLocalD1(":memory:", fileURLToPath(new URL("../migrations", import.meta.url)));
  const worker = createWorker(path => readFile(new URL("../public" + path, import.meta.url)).catch(() => null));
  const env = { DB, DEMO_MODE: "true", ADMIN_BOOTSTRAP_SECRET: bootstrap, ...overrides };
  let cookie = "";

  async function request(path, options = {}) {
    const { body, method = body === undefined ? "GET" : "POST", headers = {}, session = true, raw = undefined } = options;
    const response = await worker.fetch(new Request(origin + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
        ...(session && cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : raw !== undefined ? { body: raw } : {}),
    }), env);
    const setCookie = response.headers.get("Set-Cookie");
    if (session && setCookie) cookie = setCookie.split(";")[0];
    const data = response.headers.get("Content-Type")?.includes("application/json")
      ? await response.json() : await response.text();
    return { status: response.status, data, headers: response.headers };
  }

  async function admin() {
    assert.equal((await request("/api/account/register", { body: profile })).status, 201);
    assert.equal((await request("/api/admin/setup", { body: { secret: bootstrap } })).status, 200);
  }

  return { request, admin, env, close: () => DB.close() };
}

const customer = {
  name: "Client Test",
  email: "guest@example.test",
  shipping: { line1: "Str. Test 12", city: "Brașov", county: "Brașov", postalCode: "500001", phone: "0700000000" },
  acceptedTerms: true,
};

function orderBody(quantity = 1, demo = true) {
  return {
    ...customer, demo, locale: "ro", quantity, receipt: token(),
    expectedUnitMinor: 24900, expectedTotalMinor: 24900 * quantity + 2600,
  };
}

test("serves Romanian and English storefronts, available pricing and gated checkout", async t => {
  const f = fixture();
  t.after(f.close);
  const { data: ro } = await f.request("/api/store?locale=ro");
  const { data: en } = await f.request("/api/store?locale=en");
  assert.equal(ro.catalog.checkoutMode, "closed");
  assert.equal(ro.catalog.title, "RouterOS pas cu pas");
  assert.equal(ro.demo.edition, "Ediție tipărită");
  assert.equal(en.demo.edition, "Print edition");
  assert.equal(ro.demo.regularPriceMinor, 34900);
  assert.equal(ro.demo.preorderPriceMinor, 24900);
  assert.equal(ro.demo.deliveryMinor, 2600);
  const one = await f.request("/api/quote", { body: { quantity: 1, demo: true } });
  const two = await f.request("/api/quote", { body: { quantity: 2, demo: true } });
  assert.equal(one.data.totalMinor, 27500);
  assert.equal(two.data.totalMinor, 52400);
  assert.equal(two.data.savingsMinor, 20000);
  assert.equal((await f.request("/api/quote", { body: { quantity: 26, demo: true } })).status, 400);
  assert.equal((await f.request("/api/quote", { body: { quantity: 1, demo: false } })).status, 409);
  const rom = await f.request("/");
  const eng = await f.request("/en/shop");
  assert.equal(rom.headers.get("Content-Language"), "ro");
  assert.match(rom.data, /<html lang="ro"/);
  assert.match(eng.data, /<html lang="en"/);
  assert.match(eng.data, /hands-on MikroTik RouterOS labs/);
  assert.equal((await f.request("/en/shop/other")).status, 404);
  assert.equal((await f.request("/styles.css", { method: "HEAD" })).status, 200);
  assert.equal((await f.request("/app.mjs")).status, 200);
});

test("guest checkout retries return the same order, access stays private and payment settles once", async t => {
  const f = fixture();
  t.after(f.close);
  const body = orderBody();
  const [first, retry] = await Promise.all([
    f.request("/api/checkout", { body }),
    f.request("/api/checkout", { body }),
  ]);
  assert.equal(first.status, 201);
  assert.equal(first.data.id, retry.data.id);
  assert.equal((await f.request("/api/checkout", { body: { ...body, name: "A different customer" } })).status, 409);
  const id = first.data.id;
  assert.equal((await f.request("/api/orders/" + id)).status, 404);
  assert.equal((await f.request("/api/orders/" + id, { headers: { Authorization: "Bearer " + token() } })).status, 404);
  const options = { headers: { Authorization: "Bearer " + body.receipt } };
  const pending = await f.request("/api/orders/" + id, options);
  assert.equal(pending.data.status, "pending");
  assert.equal(pending.data.totalMinor, 27500);
  assert.equal(pending.data.email, undefined);
  assert.equal(pending.data.shipping, undefined);
  const result = { id, receipt: body.receipt, result: "paid" };
  await Promise.all([f.request("/api/checkout/demo", { body: result }), f.request("/api/checkout/demo", { body: result })]);
  const paid = await f.request("/api/orders/" + id, options);
  assert.equal(paid.data.status, "paid");
  assert.equal((await f.request("/api/admin/orders")).status, 403);
  await f.admin();
  const messages = await f.request("/api/admin/test-mail");
  assert.equal(messages.data.mail.length, 1);
  assert.match(messages.data.mail[0].subject, /^\[TEST\] Comanda/);
  const failed = await f.request("/api/checkout", { body: orderBody(2) });
  const failedId = failed.data.id;
  const failedReceipt = orderBody(2);
  const next = await f.request("/api/checkout", { body: failedReceipt });
  assert.notEqual(next.data.id, failedId);
  assert.equal((await f.request("/api/checkout/demo", { body: {
    id: next.data.id, receipt: failedReceipt.receipt, result: "failed",
  } })).data.status, "failed");
  assert.equal((await f.request("/api/checkout/demo", { body: {
    id: next.data.id, receipt: failedReceipt.receipt, result: "paid",
  } })).data.status, "failed");
  assert.equal((await f.request("/api/admin/test-mail")).data.mail.length, 1);
});

test("account checkout, administration, price snapshots and one-use password resets", async t => {
  const f = fixture();
  t.after(f.close);
  await f.admin();
  const before = await f.request("/api/admin/settings");
  const body = orderBody();
  const { data: order } = await f.request("/api/checkout", { body });
  assert.equal((await f.request("/api/orders")).data.orders[0].id, order.id);
  const sameEmail = await f.request("/api/account/register", { body: profile });
  assert.equal(sameEmail.status, 409);
  const settings = before.data.settings;
  settings.catalog.preorderPriceMinor = 25900;
  const saved = await f.request("/api/admin/settings", { method: "PUT", body: before.data });
  assert.equal(saved.status, 200);
  assert.equal((await f.request("/api/admin/settings", { method: "PUT", body: before.data })).status, 409);
  assert.equal((await f.request("/api/store?locale=en")).data.demo.preorderPriceMinor, 25900);
  const oldQuote = await f.request("/api/checkout", { body: orderBody() });
  assert.equal(oldQuote.data.code, "quote_changed");
  const snapshot = await f.request("/api/orders/" + order.id);
  assert.equal(snapshot.data.totalMinor, 27500);
  await f.request("/api/checkout/demo", { body: { id: order.id, result: "paid" } });
  const forwarded = await f.request("/api/admin/orders/" + order.id, { method: "PATCH", body: { status: "shipped" } });
  assert.equal(forwarded.data.fulfillment, "shipped");
  assert.equal((await f.request("/api/admin/orders/" + order.id, { method: "PATCH", body: { status: "preparing" } })).status, 409);
  const soldOut = { ...saved.data.settings, catalog: { ...settings.catalog, availability: "sold_out" } };
  assert.equal((await f.request("/api/admin/settings", { method: "PUT", body: {
    settings: soldOut, revision: saved.data.revision,
  } })).status, 200);
  assert.equal((await f.request("/api/store?locale=ro")).data.demo.availability, "sold_out");
  assert.equal((await f.request("/api/quote", { body: { quantity: 1, demo: true } })).status, 409);
  await f.request("/api/account/forgot", { body: { email: profile.email, locale: "en" } });
  const { data: inbox } = await f.request("/api/admin/test-mail");
  const resetEmail = inbox.mail.find(msg => msg.kind === "password-reset");
  const resetToken = resetEmail.text.match(/#([a-f0-9]{64})/)[1];
  const resetBody = { token: resetToken, password: "a-new-good-length-password" };
  assert.equal((await f.request("/api/account/reset", { body: resetBody })).status, 200);
  assert.equal((await f.request("/api/account/reset", { body: resetBody })).status, 400);
  assert.equal((await f.request("/api/orders")).status, 401);
  assert.equal((await f.request("/api/account/login", { body: profile })).status, 401);
  assert.equal((await f.request("/api/account/login", { body: { ...profile, password: resetBody.password } })).status, 200);
  assert.equal((await f.request("/api/orders")).data.orders.length, 1);
  await f.request("/api/account/logout", { body: {} });
  await f.request("/api/account/register", { body: { ...profile, email: "other@example.test" } });
  assert.equal((await f.request("/api/orders")).data.orders.length, 0);
  assert.equal((await f.request("/api/orders/" + order.id)).status, 404);
});

test("Stripe test requests use stored amounts and signed events handle duplicate and out-of-order status", async t => {
  const signingSecret = "whsec_local_unit_testing";
  const f = fixture({ STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_test_local_unit_testing", STRIPE_WEBHOOK_SECRET: signingSecret });
  t.after(f.close);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let stripeRequest;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
    stripeRequest = options;
    return Response.json({ id: "cs_test_mock", livemode: false, status: "open", url: "https://checkout.stripe.com/c/pay/cs_test_mock" });
  };
  const body = orderBody(2);
  const started = await f.request("/api/checkout", { body });
  assert.equal(started.status, 201);
  assert.equal(started.data.paymentUrl, "https://checkout.stripe.com/c/pay/cs_test_mock");
  assert.equal(stripeRequest.body.get("line_items[0][price_data][unit_amount]"), "24900");
  assert.equal(stripeRequest.body.get("line_items[1][price_data][unit_amount]"), "2600");
  assert.equal(stripeRequest.headers["Idempotency-Key"], "educat-it/" + started.data.id);
  const orderId = started.data.id;
  const baseEvent = { id: "evt_1", type: "checkout.session.completed", livemode: false, data: { object: {
    id: "cs_test_mock", object: "checkout.session", amount_total: 52400, currency: "ron", livemode: false,
    mode: "payment", payment_status: "paid", client_reference_id: orderId, metadata: { order_id: orderId },
  } } };
  async function send(event, secret = signingSecret) {
    const raw = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", secret).update(timestamp + "." + raw).digest("hex");
    return f.request("/api/payments/stripe", { method: "POST", headers: { "Stripe-Signature": "t=" + timestamp + ",v1=" + signature }, raw });
  }
  assert.equal((await send(baseEvent, "wrong_test_secret")).data.code, "invalid_signature");
  const incorrect = structuredClone(baseEvent);
  incorrect.data.object.amount_total = 1;
  assert.equal((await send(incorrect)).data.code, "payment_mismatch");
  const failure = structuredClone(baseEvent);
  failure.id = "evt_0";
  failure.type = "checkout.session.async_payment_failed";
  failure.data.object.payment_status = "unpaid";
  assert.equal((await send(failure)).status, 200);
  const receiptHeaders = { headers: { Authorization: "Bearer " + body.receipt } };
  assert.equal((await f.request("/api/orders/" + orderId, receiptHeaders)).data.status, "failed");
  assert.equal((await send(baseEvent)).status, 200);
  assert.equal((await send(baseEvent)).status, 200);
  const late = { ...failure, id: "evt_2" };
  assert.equal((await send(late)).status, 200);
  const paid = await f.request("/api/orders/" + orderId, receiptHeaders);
  assert.equal(paid.data.status, "paid");
  assert.equal(paid.data.totalMinor, 52400);
  await f.admin();
  assert.equal((await f.request("/api/admin/test-mail")).data.mail.length, 1);
  assert.equal((await f.env.DB.prepare("SELECT COUNT(*) AS count FROM store_payment_events").first()).count, 3);
});
