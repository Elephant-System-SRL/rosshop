import { emailOf, enabled, fail, field, localeOf, query } from "./core.mjs";
import { enqueueDelivery, mailInsert, passwordResetMail, resetMailMode } from "./email.mjs";

const encoder = new TextEncoder();
const sessionSeconds = 7 * 24 * 60 * 60;
const cookieName = "rps_session";
const resetMinutes = 20;
const maxPortableIterations = 100_000;
const preferredIterations = 600_000;

export function hex(bytes) {
  return Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
}

export function unhex(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function secret() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export const isToken = (raw) => typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw);

export async function digest(value) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export function constantEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    fail(400, "Use a password between 12 and 128 characters.", "invalid_password");
  }
  return password;
}

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: unhex(salt),
    iterations,
  }, key, 256);
  return hex(new Uint8Array(bits));
}

async function newPassword(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  let iterations = preferredIterations;
  let hash;
  try {
    hash = await derivePassword(password, salt, iterations);
  } catch (error) {
    if (!/iteration/i.test(String(error))) throw error;
    iterations = maxPortableIterations;
    hash = await derivePassword(password, salt, iterations);
  }
  return { salt, passwordHash: iterations + "$" + hash };
}

async function matchesPassword(user, password) {
  const [iterations, expected] = user?.password_hash.split("$") ?? [maxPortableIterations, ""];
  const salt = user?.salt ?? "24a4e7befc6a9476164bdee915aa5831";
  const actual = await derivePassword(password, salt, Number(iterations));
  return Boolean(user && constantEqual(actual, expected));
}

function parseSessionCookie(request) {
  const match = (request.headers.get("Cookie") ?? "").match(/(?:^|;\s*)rps_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1] ?? null;
}

function sessionCookie(request, token, seconds) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return cookieName + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + seconds + secure;
}

export async function authenticatedUser(request, env) {
  const token = parseSessionCookie(request);
  if (!token) return null;
  return query(env.DB, `
    SELECT u.id, u.name, u.email, u.role
    FROM store_users u
    JOIN store_sessions s ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `, await digest(token), Date.now()).first();
}

export function isAdmin(request, env, user) {
  if (user?.role === "admin") return true;
  if (!enabled(env.TRUST_SITES_IDENTITY) || !enabled(env.DEMO_MODE) || env.STRIPE_MODE === "live") {
    return false;
  }
  const dispatchId = request.headers.get("oai-authenticated-user-id");
  if (!dispatchId) return false;
  const dispatchEmail = request.headers.get("oai-authenticated-user-email")?.toLowerCase();
  return Boolean((env.PREVIEW_OWNER_ID && dispatchId === env.PREVIEW_OWNER_ID) ||
    (env.PREVIEW_OWNER_EMAIL && dispatchEmail === env.PREVIEW_OWNER_EMAIL.toLowerCase()));
}

export function profile(request, env, user) {
  return {
    user,
    canAdmin: isAdmin(request, env, user),
    resetAvailable: Boolean(resetMailMode(env)),
  };
}

export async function checkRate(request, env, scope, cap, windowMs, label = "") {
  const ip = enabled(env.TRUST_SITES_IDENTITY) ? request.headers.get("CF-Connecting-IP") : null;
  const bucket = scope + ":" + await digest(label || ip || "standalone-preview");
  const now = Date.now();
  const row = await query(env.DB, `
    INSERT INTO store_request_limits (bucket, hits, reset_at)
    VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET
      hits = CASE WHEN reset_at <= ? THEN 1 ELSE hits + 1 END,
      reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
    RETURNING hits
  `, bucket, now + windowMs, now, now).first();
  if (row.hits > cap) fail(429, "Please wait before trying again.", "rate_limited");
}

async function createSession(request, env, user) {
  const token = secret();
  const now = Date.now();
  await query(env.DB, "INSERT INTO store_sessions VALUES (?, ?, ?)",
    await digest(token), user.id, now + sessionSeconds * 1000).run();
  return { data: profile(request, env, user), cookie: sessionCookie(request, token, sessionSeconds) };
}

export async function register(request, env, body) {
  await checkRate(request, env, "register", 12, 60 * 60_000);
  const name = field(body.name, 120, "Name", true);
  const email = emailOf(body.email);
  const password = validatePassword(body.password);
  const { salt, passwordHash } = await newPassword(password);
  const user = { id: crypto.randomUUID(), name, email, role: "customer" };
  const result = await query(env.DB, `
    INSERT INTO store_users (id, name, email, salt, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO NOTHING
  `, user.id, name, email, salt, passwordHash, Date.now()).run();
  if (!result.meta.changes) fail(409, "An account already uses this email. Sign in or reset your password.", "email_in_use");
  return createSession(request, env, user);
}

export async function login(request, env, body) {
  const email = emailOf(body.email);
  const password = validatePassword(body.password);
  await checkRate(request, env, "login-source", 50, 15 * 60_000);
  await checkRate(request, env, "login-address", 8, 15 * 60_000, email);
  const user = await query(env.DB, `
    SELECT id, name, email, role, salt, password_hash FROM store_users WHERE email = ?
  `, email).first();
  if (!(await matchesPassword(user, password))) {
    fail(401, "The email or password is incorrect.", "login_failed");
  }
  const token = parseSessionCookie(request);
  if (token) await query(env.DB, "DELETE FROM store_sessions WHERE token_hash = ?", await digest(token)).run();
  const { id, name, role } = user;
  return createSession(request, env, { id, name, email, role });
}

export async function logout(request, env) {
  const token = parseSessionCookie(request);
  if (token) await query(env.DB, "DELETE FROM store_sessions WHERE token_hash = ?", await digest(token)).run();
  return { data: profile(request, env, null), cookie: sessionCookie(request, "", 0) };
}

export async function requestPasswordReset(request, env, body, ctx) {
  const mode = resetMailMode(env);
  if (!mode) fail(503, "Password reset email is not available yet.", "email_unavailable");
  const email = emailOf(body.email);
  await checkRate(request, env, "reset-source", 20, 60 * 60_000);
  await checkRate(request, env, "reset-address", 4, 60 * 60_000, email);
  const user = await query(env.DB, "SELECT id FROM store_users WHERE email = ?", email).first();
  if (!user) return;

  const token = secret();
  const expiry = Date.now() + resetMinutes * 60_000;
  const mail = passwordResetMail(request, env, email, localeOf(body.locale), token, expiry, mode);
  const statements = [
    query(env.DB, `
      INSERT INTO store_password_resets (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at
    `, await digest(token), user.id, expiry),
    mailInsert(env.DB, mail),
  ];
  await env.DB.batch(statements);
  await enqueueDelivery(env, mail.id, ctx);
}

export async function resetPassword(request, env, body) {
  await checkRate(request, env, "reset-attempt", 30, 60 * 60_000);
  if (!isToken(body.token)) fail(400, "This reset link is invalid or has expired.", "invalid_reset");
  const tokenHash = await digest(body.token);
  const stored = await query(env.DB, `
    SELECT user_id FROM store_password_resets WHERE token_hash = ? AND expires_at > ?
  `, tokenHash, Date.now()).first();
  if (!stored) fail(400, "This reset link is invalid or has expired.", "invalid_reset");

  const { salt, passwordHash } = await newPassword(validatePassword(body.password));
  const now = Date.now();
  const [updated] = await env.DB.batch([
    query(env.DB, `
      UPDATE store_users SET salt = ?, password_hash = ?
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM store_password_resets WHERE token_hash = ? AND expires_at > ?
      )
    `, salt, passwordHash, stored.user_id, tokenHash, now),
    query(env.DB, `
      DELETE FROM store_sessions WHERE user_id = ? AND EXISTS (
        SELECT 1 FROM store_password_resets WHERE token_hash = ? AND expires_at > ?
      )
    `, stored.user_id, tokenHash, now),
    query(env.DB, "DELETE FROM store_password_resets WHERE token_hash = ?", tokenHash),
  ]);
  if (!updated.meta.changes) fail(400, "This reset link is invalid or has expired.", "invalid_reset");
}

export async function bootstrapAdmin(request, env, user, body) {
  if (!user) fail(401, "Sign in to continue.", "sign_in_required");
  await checkRate(request, env, "bootstrap", 5, 60 * 60_000, user.id);
  if (typeof env.ADMIN_BOOTSTRAP_SECRET !== "string" || env.ADMIN_BOOTSTRAP_SECRET.length < 24) {
    fail(403, "Admin setup is unavailable.", "admin_forbidden");
  }
  const provided = field(body.secret, 400, "Setup secret", true);
  const expected = await digest(env.ADMIN_BOOTSTRAP_SECRET);
  if (!constantEqual(await digest(provided), expected)) {
    fail(403, "Admin setup is unavailable.", "admin_forbidden");
  }
  const result = await query(env.DB, `
    UPDATE store_users SET role = 'admin' WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM store_users WHERE role = 'admin')
  `, user.id).run();
  if (!result.meta.changes && user.role !== "admin") {
    fail(409, "An administrator is already configured.", "admin_exists");
  }
  return profile(request, env, { ...user, role: "admin" });
}
