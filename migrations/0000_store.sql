CREATE TABLE store_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    body TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE store_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    created_at INTEGER NOT NULL
);

CREATE TABLE store_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES store_users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);
CREATE INDEX store_sessions_user ON store_sessions(user_id);

CREATE TABLE store_password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES store_users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE TABLE store_request_limits (
    bucket TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
);

CREATE TABLE store_orders (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    user_id TEXT REFERENCES store_users(id) ON DELETE SET NULL,
    receipt_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    shipping TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('demo', 'stripe_test', 'stripe_live')),
    provider_session TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
    fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled'
        CHECK (fulfillment_status IN ('unfulfilled', 'preparing', 'shipped', 'delivered', 'cancelled')),
    product_title TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency = 'RON'),
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 25),
    unit_minor INTEGER NOT NULL CHECK (unit_minor >= 0),
    regular_minor INTEGER NOT NULL CHECK (regular_minor >= unit_minor),
    delivery_minor INTEGER NOT NULL CHECK (delivery_minor >= 0),
    total_minor INTEGER NOT NULL CHECK (total_minor = quantity * unit_minor + delivery_minor),
    created_at INTEGER NOT NULL,
    paid_at INTEGER
);
CREATE INDEX store_orders_user ON store_orders(user_id, created_at DESC);
CREATE INDEX store_orders_created ON store_orders(created_at DESC);

CREATE TABLE store_payment_events (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES store_orders(id),
    event_type TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE store_mail (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('order-confirmation', 'password-reset', 'launch-signup')),
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    sent_at INTEGER,
    sending_until INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    provider_id TEXT
);
CREATE INDEX store_mail_pending ON store_mail(mode, sent_at, created_at);

CREATE TABLE store_launch_signups (
    email TEXT PRIMARY KEY,
    consent_at INTEGER NOT NULL
);
