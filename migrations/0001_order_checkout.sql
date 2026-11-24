ALTER TABLE store_orders ADD COLUMN locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('ro', 'en'));
--> statement-breakpoint
ALTER TABLE store_orders ADD COLUMN preorder INTEGER NOT NULL DEFAULT 0 CHECK (preorder IN (0, 1));
--> statement-breakpoint
ALTER TABLE store_orders ADD COLUMN request_fingerprint TEXT;
--> statement-breakpoint
ALTER TABLE store_orders ADD COLUMN delivery_terms TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX store_orders_receipt ON store_orders(receipt_hash);
--> statement-breakpoint
ALTER TABLE store_launch_signups ADD COLUMN unsubscribe_hash TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX store_launch_signups_unsubscribe ON store_launch_signups(unsubscribe_hash);
