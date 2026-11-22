BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS seller_id uuid;
ALTER TABLE public.wallet_entries ADD COLUMN IF NOT EXISTS sale_order_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='orders_seller_post_key') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_seller_post_key UNIQUE (id, seller_id, post_id),
      ADD CONSTRAINT orders_distinct_seller_check CHECK (seller_id IS NULL OR seller_id <> buyer_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.wallet_entries'::regclass AND conname='wallet_entries_sale_order_fk') THEN
    ALTER TABLE public.wallet_entries
      ADD CONSTRAINT wallet_entries_sale_order_key UNIQUE (sale_order_id),
      ADD CONSTRAINT wallet_entries_sale_order_fk FOREIGN KEY (sale_order_id, user_id, post_id)
        REFERENCES public.orders (id, seller_id, post_id);
  END IF;
END
$$;

ALTER TABLE public.wallet_entries DROP CONSTRAINT IF EXISTS wallet_entries_kind_check;
ALTER TABLE public.wallet_entries ADD CONSTRAINT wallet_entries_kind_check CHECK (
  (request_id IS NOT NULL AND order_id IS NULL AND sale_order_id IS NULL AND post_id IS NULL AND (
    (kind='TOP_UP' AND amount_vnd>0 AND actor_id IS NULL)
    OR (kind='ADMIN_CREDIT' AND amount_vnd>0 AND actor_id IS NOT NULL)
    OR (kind='ADMIN_DEBIT' AND amount_vnd<0 AND actor_id IS NOT NULL)
  ))
  OR (kind='PURCHASE' AND amount_vnd<0 AND request_id IS NULL AND order_id IS NOT NULL
      AND sale_order_id IS NULL AND post_id IS NOT NULL AND actor_id IS NULL)
  OR (kind='SALE_EARNING' AND amount_vnd>0 AND request_id IS NULL AND order_id IS NULL
      AND sale_order_id IS NOT NULL AND post_id IS NOT NULL AND actor_id IS NULL)
);

CREATE INDEX IF NOT EXISTS orders_seller_paid_idx ON public.orders (seller_id, paid_at) WHERE status='PAID';
CREATE INDEX IF NOT EXISTS orders_legacy_paid_idx ON public.orders (post_id, paid_at)
  WHERE seller_id IS NULL AND status='PAID';

COMMIT;
