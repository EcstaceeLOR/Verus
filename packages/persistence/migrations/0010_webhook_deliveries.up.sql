CREATE TABLE webhook_deliveries (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  delivery_id text NOT NULL,
  idempotency_key text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  audience text NOT NULL,
  endpoint_id text NOT NULL,
  endpoint_url text NOT NULL CHECK (endpoint_url ~ '^https://'),
  body text NOT NULL CHECK (jsonb_typeof(body::jsonb) = 'object'),
  state text NOT NULL CHECK (state IN ('pending', 'delivering', 'retry', 'delivered', 'dead_letter')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 32),
  next_attempt_at timestamptz NOT NULL,
  lease_until timestamptz,
  ordering_key text,
  sequence bigint CHECK (sequence IS NULL OR sequence >= 0),
  replay_of text,
  replay_reason text CHECK (replay_reason IS NULL OR length(replay_reason) BETWEEN 8 AND 256),
  last_status integer CHECK (last_status IS NULL OR last_status BETWEEN 100 AND 599),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  PRIMARY KEY (workspace_id, delivery_id),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, replay_of) REFERENCES webhook_deliveries(workspace_id, delivery_id) ON DELETE RESTRICT,
  CHECK ((replay_of IS NULL) = (replay_reason IS NULL)),
  CHECK ((state = 'delivering') = (lease_until IS NOT NULL)),
  CHECK ((state = 'delivered') = (delivered_at IS NOT NULL))
);

CREATE INDEX webhook_delivery_work_idx
  ON webhook_deliveries (workspace_id, next_attempt_at, sequence, created_at)
  WHERE state IN ('pending', 'retry', 'delivering');
CREATE INDEX webhook_delivery_event_idx
  ON webhook_deliveries (workspace_id, event_id, created_at DESC);
CREATE INDEX webhook_delivery_dead_letter_idx
  ON webhook_deliveries (workspace_id, updated_at DESC)
  WHERE state = 'dead_letter';

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON webhook_deliveries
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
