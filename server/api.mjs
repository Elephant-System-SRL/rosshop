import { HttpError, emailOf, fail, field, jsonBody, localeOf, localePrefix, query, readText, respond, siteOrigin } from "./core.mjs";
import { cleanSettings, getDemoCatalog, getSettings, publicCatalog, publicContent } from "./catalog.mjs";
import { enqueueDelivery, launchSignupMail, listTestMail, realMailEnabled, retryMail } from "./email.mjs";
import { adminOrders, customerOrders, finishDemo, getReceipt, quoteOrder, startCheckout, stripeWebhook, updateFulfillment } from "./orders.mjs";
import {
  authenticatedUser, bootstrapAdmin, checkRate, digest, isAdmin, isToken, login, logout, profile,
  register, requestPasswordReset, resetPassword, secret,
} from "./security.mjs";

function withSession({ data, cookie }, status = 200) {
  return respond(data, status, { "Set-Cookie": cookie });
}

function requireUser(user) {
  if (!user) fail(401, "Sign in to continue.", "sign_in_required");
  return user;
}

function requireAdmin(request, env, user) {
  if (!isAdmin(request, env, user)) fail(403, "Administrator access is required.", "admin_forbidden");
}

async function readAdminSettings(db) {
  const row = await query(db, "SELECT updated_at, body FROM store_settings WHERE id = 1").first();
  return { settings: cleanSettings(row ? JSON.parse(row.body) : {}), revision: row?.updated_at ?? 0 };
}

async function saveSettings(db, body) {
  const next = cleanSettings(body.settings ?? {});
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) {
    fail(400, "Refresh settings before saving.", "invalid_revision");
  }
  const revision = Math.max(Date.now(), body.revision + 1);
  const write = body.revision === 0
    ? query(db, "INSERT INTO store_settings (id, body, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING",
      JSON.stringify(next), revision)
    : query(db, "UPDATE store_settings SET body = ?, updated_at = ? WHERE id = 1 AND updated_at = ?",
      JSON.stringify(next), revision, body.revision);
  if (!(await write.run()).meta.changes) fail(409, "Settings changed. Reload before saving.", "settings_changed");
  return { settings: next, revision };
}

async function subscribe(request, env, ctx, body) {
  if (!realMailEnabled(env)) fail(503, "Launch notifications are unavailable.", "email_unavailable");
  if (body.consent !== true) fail(400, "Please give consent to receive the launch notification.", "consent_required");
  const email = emailOf(body.email);
  await checkRate(request, env, "launch", 30, 60 * 60_000);
  await checkRate(request, env, "launch-email", 3, 60 * 60_000, email);
  const token = secret();
  const tokenHash = await digest(token);
  const locale = localeOf(body.locale);
  const link = new URL(localePrefix(locale) + "/account/unsubscribe", siteOrigin(request, env));
  link.hash = token;
  const mail = launchSignupMail(email, locale, link.href);
  await env.DB.batch([
    query(env.DB, `
      INSERT INTO store_launch_signups (email, consent_at, unsubscribe_hash)
      VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING
    `, email, Date.now(), tokenHash),
    query(env.DB, `
      INSERT INTO store_mail (id, kind, recipient, subject, body, mode, created_at)
      SELECT ?, ?, email, ?, ?, ?, ? FROM store_launch_signups WHERE unsubscribe_hash = ?
    `, mail.id, mail.kind, mail.subject, mail.body, mail.mode, mail.createdAt, tokenHash),
  ]);
  await enqueueDelivery(env, mail.id, ctx);
}

async function routeApi(request, env, ctx, url) {
  const path = url.pathname;
  const method = request.method;
  const locale = localeOf(url.searchParams.get("locale"));

  if (method === "POST" && path === "/api/payments/stripe") {
    const payload = await readText(request, 256_000);
    await stripeWebhook(env, ctx, payload, request.headers.get("Stripe-Signature") ?? "");
    return respond({ received: true });
  }
  if (method === "GET" && path === "/api/store") {
    const settings = await getSettings(env.DB);
    return respond({
      catalog: publicCatalog(settings, env, locale),
      demo: getDemoCatalog(settings, env, locale),
      content: publicContent(settings, locale),
      launchSignup: realMailEnabled(env),
    });
  }
  if (method === "POST" && path === "/api/quote") {
    const body = await jsonBody(request);
    return respond(quoteOrder(await getSettings(env.DB), env, localeOf(body.locale), body));
  }
  if (method === "POST" && path === "/api/subscribe") {
    await subscribe(request, env, ctx, await jsonBody(request));
    return respond({ accepted: true });
  }
  if (method === "POST" && path === "/api/unsubscribe") {
    const { token } = await jsonBody(request);
    if (isToken(token)) {
      await query(env.DB, "DELETE FROM store_launch_signups WHERE unsubscribe_hash = ?", await digest(token)).run();
    }
    return respond({ accepted: true });
  }

  if (method === "POST" && path === "/api/account/register") {
    return withSession(await register(request, env, await jsonBody(request)), 201);
  }
  if (method === "POST" && path === "/api/account/login") {
    return withSession(await login(request, env, await jsonBody(request)));
  }
  if (method === "POST" && path === "/api/account/logout") {
    await jsonBody(request);
    return withSession(await logout(request, env));
  }
  if (method === "POST" && path === "/api/account/forgot") {
    await requestPasswordReset(request, env, await jsonBody(request), ctx);
    return respond({ accepted: true });
  }
  if (method === "POST" && path === "/api/account/reset") {
    await resetPassword(request, env, await jsonBody(request));
    return respond({ accepted: true });
  }

  const user = await authenticatedUser(request, env);
  if (method === "GET" && path === "/api/account") return respond(profile(request, env, user));
  if (method === "PATCH" && path === "/api/account") {
    requireUser(user);
    const { name: rawName } = await jsonBody(request);
    const name = field(rawName, 120, "Name", true);
    await query(env.DB, "UPDATE store_users SET name = ? WHERE id = ?", name, user.id).run();
    return respond(profile(request, env, { ...user, name }));
  }
  if (method === "POST" && path === "/api/checkout") {
    const body = await jsonBody(request);
    return respond(await startCheckout(request, env, await getSettings(env.DB), user, body), 201);
  }
  if (method === "POST" && path === "/api/checkout/demo") {
    return respond(await finishDemo(env, ctx, user, await jsonBody(request)));
  }
  if (method === "GET" && path === "/api/orders") {
    return respond({ orders: await customerOrders(env.DB, requireUser(user)) });
  }
  const receipt = /^\/api\/orders\/([a-f0-9-]{36})$/.exec(path);
  if (method === "GET" && receipt) return respond(await getReceipt(request, env, user, receipt[1]));

  if (method === "POST" && path === "/api/admin/setup") {
    return respond(await bootstrapAdmin(request, env, user, await jsonBody(request)));
  }
  if (path.startsWith("/api/admin/")) {
    requireAdmin(request, env, user);
    if (path === "/api/admin/settings") {
      if (method === "GET") return respond(await readAdminSettings(env.DB));
      if (method === "PUT") return respond(await saveSettings(env.DB, await jsonBody(request, 256_000)));
    }
    if (method === "GET" && path === "/api/admin/orders") {
      return respond({ orders: await adminOrders(env.DB) });
    }
    if (method === "GET" && path === "/api/admin/test-mail") {
      return respond({ mail: await listTestMail(env.DB) });
    }
    if (method === "POST" && path === "/api/admin/mail-retry") {
      await jsonBody(request);
      return respond(await retryMail(env));
    }
    const orderRoute = /^\/api\/admin\/orders\/([a-f0-9-]{36})$/.exec(path);
    if (method === "PATCH" && orderRoute) {
      const { status } = await jsonBody(request);
      return respond(await updateFulfillment(env.DB, orderRoute[1], status));
    }
  }
  fail(404, "This page could not be found.", "not_found");
}

export async function handleApi(request, env, ctx) {
  try {
    if (!env.DB) fail(503, "The store database is unavailable.", "database_unavailable");
    return await routeApi(request, env, ctx, new URL(request.url));
  } catch (error) {
    if (error instanceof HttpError) return respond({ error: error.message, code: error.code }, error.status);
    throw error;
  }
}
