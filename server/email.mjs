import { all, configuredOrigin, enabled, iso, money, query, siteOrigin, localePrefix } from "./core.mjs";

const hours = 60 * 60 * 1000;

export function realMailEnabled(env) {
  return env.EMAIL_MODE === "live" &&
    !enabled(env.DEMO_MODE) &&
    /^re_/.test(env.RESEND_API_KEY ?? "") &&
    Boolean(env.EMAIL_FROM && configuredOrigin(env));
}

export function resetMailMode(env) {
  if (enabled(env.DEMO_MODE) && env.STRIPE_MODE !== "live") return "demo";
  return realMailEnabled(env) ? "live" : null;
}

export function mailInsert(db, { id, kind, recipient, subject, body, mode, createdAt, expiresAt = null }) {
  return query(db, `
    INSERT INTO store_mail (id, kind, recipient, subject, body, mode, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `, id, kind, recipient, subject, body, mode, createdAt, expiresAt);
}

export function passwordResetMail(request, env, email, locale, token, expiresAt, mode) {
  const link = new URL(localePrefix(locale) + "/account/reset", siteOrigin(request, env));
  link.hash = token;
  const isRomanian = locale === "ro";
  const body = isRomanian
    ? ["Ai solicitat schimbarea parolei pentru magazinul RouterOS pas cu pas.", "Alege o parolă nouă:", link.href, "Linkul expiră în 20 de minute. Dacă nu ai cerut schimbarea parolei, poți ignora acest mesaj."]
    : ["You asked to reset your password for the RouterOS pas cu pas store.", "Choose a new password:", link.href, "This link expires in 20 minutes. If you did not request it, you can disregard this email."];
  return {
    id: crypto.randomUUID(),
    kind: "password-reset",
    recipient: email,
    subject: (mode === "demo" ? "[TEST] " : "") + (isRomanian ? "Schimbă parola contului Educat IT" : "Reset your Educat IT password"),
    body: body.join("\n\n"),
    mode,
    createdAt: Date.now(),
    expiresAt,
  };
}

export function orderConfirmation(order) {
  const isRomanian = order.locale === "ro";
  const preview = order.mode === "stripe_live" ? "" : "[TEST] ";
  const subject = isRomanian
    ? "Comanda " + order.number + " este confirmată"
    : "Your order " + order.number + " is confirmed";
  const item = order.quantity + " × " + order.product_title;
  const total = money(order.total_minor, order.locale);
  const paragraphs = isRomanian
    ? ["Bună, " + order.name + ",", "Plata pentru comanda " + order.number + " a fost confirmată.", item, "Total plătit: " + total, "Mulțumim,\nEducat IT"]
    : ["Hello " + order.name + ",", "We received payment for order " + order.number + ".", item, "Total paid: " + total, "Thank you,\nEducat IT"];
  paragraphs.splice(4, 0, (isRomanian ? "Livrare: " : "Delivery: ") + money(order.delivery_minor, order.locale));
  if (order.delivery_terms) paragraphs.splice(5, 0, order.delivery_terms);
  return { subject: preview + subject, body: paragraphs.join("\n\n") };
}

export function launchSignupMail(email, locale, unsubscribeUrl) {
  const isRomanian = locale === "ro";
  return {
    id: crypto.randomUUID(),
    kind: "launch-signup",
    recipient: email,
    subject: isRomanian ? "Ești pe lista de lansare RouterOS pas cu pas" : "You're on the RouterOS pas cu pas launch list",
    body: isRomanian
      ? "Te-ai înscris pentru a primi anunțul de lansare al cărții RouterOS pas cu pas.\n\nTe poți dezabona aici: " + unsubscribeUrl + "\n\nEducat IT"
      : "You signed up to hear when RouterOS pas cu pas launches.\n\nYou can unsubscribe here: " + unsubscribeUrl + "\n\nEducat IT",
    mode: "live",
    createdAt: Date.now(),
  };
}

export async function deliverMail(env, id) {
  if (!realMailEnabled(env)) return false;
  const now = Date.now();
  const message = await query(env.DB, `
    UPDATE store_mail SET sending_until = ?, attempts = attempts + 1
    WHERE id = ? AND mode = 'live' AND sent_at IS NULL AND attempts < 6
      AND created_at > ? AND (expires_at IS NULL OR expires_at > ?)
      AND (sending_until IS NULL OR sending_until <= ?)
    RETURNING *
  `, now + 60_000, id, now - 23 * hours, now, now).first();
  if (!message) return false;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
        "Idempotency-Key": "educatit/" + message.id,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.recipient],
        subject: message.subject,
        text: message.body,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Email provider returned " + response.status);
    const result = await response.json();
    await query(env.DB, `
      UPDATE store_mail
      SET sent_at = ?, provider_id = ?, sending_until = NULL,
          body = CASE WHEN kind = 'password-reset' THEN '' ELSE body END
      WHERE id = ?
    `, Date.now(), result.id ?? null, id).run();
    return true;
  } catch {
    await query(env.DB, "UPDATE store_mail SET sending_until = NULL WHERE id = ?", id).run();
    return false;
  }
}

export function enqueueDelivery(env, id, ctx) {
  if (!realMailEnabled(env)) return Promise.resolve();
  const delivery = deliverMail(env, id).catch(() => false);
  if (!ctx?.waitUntil) return delivery;
  ctx.waitUntil(delivery);
  return Promise.resolve();
}

export async function retryMail(env) {
  if (!realMailEnabled(env)) return { attempted: 0, sent: 0 };
  const now = Date.now();
  const messages = await all(env.DB, `
    SELECT id FROM store_mail
    WHERE mode = 'live' AND sent_at IS NULL AND attempts < 6
      AND created_at > ? AND (expires_at IS NULL OR expires_at > ?)
      AND (sending_until IS NULL OR sending_until <= ?)
    ORDER BY created_at LIMIT 8
  `, now - 23 * hours, now, now);
  const results = await Promise.all(messages.map(({ id }) => deliverMail(env, id)));
  return { attempted: results.length, sent: results.filter(Boolean).length };
}

export async function listTestMail(db) {
  const rows = await all(db, `
    SELECT id, kind, recipient, subject, body, created_at FROM store_mail
    WHERE mode = 'demo' ORDER BY created_at DESC LIMIT 100
  `);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    to: row.recipient,
    subject: row.subject,
    text: row.body,
    createdAt: iso(row.created_at),
  }));
}
