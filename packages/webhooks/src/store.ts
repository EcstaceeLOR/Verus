import type { Pool, PoolClient, QueryResultRow } from "pg";

export type DeliveryState = "dead_letter" | "delivered" | "delivering" | "pending" | "retry";

export interface DeliveryRecord {
  readonly attempt: number;
  readonly audience: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly endpointUrl: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly idempotencyKey: string;
  readonly leaseUntil?: Date | undefined;
  readonly maxAttempts: number;
  readonly nextAttemptAt: Date;
  readonly orderingKey?: string;
  readonly replayOf?: string;
  readonly replayReason?: string;
  readonly sequence?: number;
  readonly state: DeliveryState;
  readonly workspaceId: string;
}
export interface DeliveryStore {
  enqueue(record: DeliveryRecord): Promise<"duplicate" | "queued">;
  claim(workspaceId: string, now: Date, leaseUntil: Date): Promise<DeliveryRecord | undefined>;
  delivered(
    workspaceId: string,
    deliveryId: string,
    deliveredAt: Date,
    status: number,
  ): Promise<void>;
  failed(
    workspaceId: string,
    deliveryId: string,
    input: Readonly<{
      errorCode: string;
      nextAttemptAt?: Date;
      status?: number;
      terminal: boolean;
    }>,
  ): Promise<void>;
  get(workspaceId: string, deliveryId: string): Promise<DeliveryRecord | undefined>;
}
export class InMemoryDeliveryStore implements DeliveryStore {
  readonly #records = new Map<string, DeliveryRecord>();
  readonly #idempotency = new Set<string>();
  async enqueue(record: DeliveryRecord): Promise<"duplicate" | "queued"> {
    const idempotency = `${record.workspaceId}\0${record.idempotencyKey}`;
    if (this.#idempotency.has(idempotency)) return "duplicate";
    this.#idempotency.add(idempotency);
    this.#records.set(`${record.workspaceId}\0${record.deliveryId}`, Object.freeze({ ...record }));
    return "queued";
  }
  async claim(
    workspaceId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<DeliveryRecord | undefined> {
    const records = [...this.#records.values()].filter((item) => item.workspaceId === workspaceId);
    const record = records
      .filter(
        (item) =>
          ((item.state === "pending" || item.state === "retry") && item.nextAttemptAt <= now) ||
          (item.state === "delivering" && item.leaseUntil !== undefined && item.leaseUntil <= now),
      )
      .sort(
        (left, right) =>
          (left.sequence ?? Number.MAX_SAFE_INTEGER) -
            (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
          left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .find(
        (candidate) =>
          candidate.orderingKey === undefined ||
          candidate.sequence === undefined ||
          !records.some(
            (earlier) =>
              earlier.deliveryId !== candidate.deliveryId &&
              earlier.orderingKey === candidate.orderingKey &&
              earlier.sequence !== undefined &&
              earlier.sequence < Number(candidate.sequence) &&
              (earlier.state === "pending" ||
                earlier.state === "retry" ||
                (earlier.state === "delivering" &&
                  earlier.leaseUntil !== undefined &&
                  earlier.leaseUntil > now)),
          ),
      );
    if (record === undefined) return undefined;
    const claimed = Object.freeze({
      ...record,
      attempt: record.attempt + 1,
      leaseUntil,
      state: "delivering" as const,
    });
    this.#records.set(`${workspaceId}\0${record.deliveryId}`, claimed);
    return claimed;
  }
  async delivered(
    workspaceId: string,
    deliveryId: string,
    deliveredAt: Date,
    status: number,
  ): Promise<void> {
    void deliveredAt;
    void status;
    this.#change(workspaceId, deliveryId, { leaseUntil: undefined, state: "delivered" });
  }
  async failed(
    workspaceId: string,
    deliveryId: string,
    input: Readonly<{ nextAttemptAt?: Date; terminal: boolean }>,
  ): Promise<void> {
    this.#change(workspaceId, deliveryId, {
      leaseUntil: undefined,
      state: input.terminal ? "dead_letter" : "retry",
      ...(input.nextAttemptAt === undefined ? {} : { nextAttemptAt: input.nextAttemptAt }),
    });
  }
  async get(workspaceId: string, deliveryId: string): Promise<DeliveryRecord | undefined> {
    return this.#records.get(`${workspaceId}\0${deliveryId}`);
  }
  #change(workspaceId: string, deliveryId: string, change: Partial<DeliveryRecord>): void {
    const key = `${workspaceId}\0${deliveryId}`;
    const current = this.#records.get(key);
    if (current === undefined) throw new Error("Webhook delivery does not exist.");
    this.#records.set(key, Object.freeze({ ...current, ...change }));
  }
}

export type SqlPool = Pool;
type DeliveryRow = QueryResultRow & {
  attempt: number;
  audience: string;
  body: unknown;
  created_at: Date;
  delivery_id: string;
  endpoint_url: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  idempotency_key: string;
  lease_until: Date | null;
  max_attempts: number;
  next_attempt_at: Date;
  ordering_key: string | null;
  replay_of: string | null;
  replay_reason: string | null;
  sequence: string | null;
  state: DeliveryState;
  workspace_id: string;
};
function fromRow(row: DeliveryRow): DeliveryRecord {
  return Object.freeze({
    attempt: row.attempt,
    audience: row.audience,
    body: typeof row.body === "string" ? row.body : JSON.stringify(row.body),
    createdAt: new Date(row.created_at),
    deliveryId: row.delivery_id,
    endpointId: row.endpoint_id,
    endpointUrl: row.endpoint_url,
    eventId: row.event_id,
    eventType: row.event_type,
    idempotencyKey: row.idempotency_key,
    ...(row.lease_until === null ? {} : { leaseUntil: new Date(row.lease_until) }),
    maxAttempts: row.max_attempts,
    nextAttemptAt: new Date(row.next_attempt_at),
    ...(row.ordering_key === null ? {} : { orderingKey: row.ordering_key }),
    ...(row.replay_of === null ? {} : { replayOf: row.replay_of }),
    ...(row.replay_reason === null ? {} : { replayReason: row.replay_reason }),
    ...(row.sequence === null ? {} : { sequence: Number(row.sequence) }),
    state: row.state,
    workspaceId: row.workspace_id,
  });
}
/** PostgreSQL adapter. Every operation starts a workspace-scoped transaction for forced RLS. */
export class PostgresDeliveryStore implements DeliveryStore {
  constructor(readonly pool: Pool) {}
  async #transaction<T>(
    workspaceId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  enqueue(record: DeliveryRecord): Promise<"duplicate" | "queued"> {
    return this.#transaction(record.workspaceId, async (client) => {
      const result = await client.query(
        `INSERT INTO webhook_deliveries
          (workspace_id, delivery_id, idempotency_key, event_id, event_type, audience,
           endpoint_id, endpoint_url, body, state, attempt, max_attempts, next_attempt_at,
           ordering_key, sequence, replay_of, replay_reason, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (workspace_id, idempotency_key) DO NOTHING RETURNING delivery_id`,
        [
          record.workspaceId,
          record.deliveryId,
          record.idempotencyKey,
          record.eventId,
          record.eventType,
          record.audience,
          record.endpointId,
          record.endpointUrl,
          record.body,
          record.attempt,
          record.maxAttempts,
          record.nextAttemptAt,
          record.orderingKey ?? null,
          record.sequence ?? null,
          record.replayOf ?? null,
          record.replayReason ?? null,
          record.createdAt,
        ],
      );
      return result.rowCount === 1 ? "queued" : "duplicate";
    });
  }
  claim(workspaceId: string, now: Date, leaseUntil: Date): Promise<DeliveryRecord | undefined> {
    return this.#transaction(workspaceId, async (client) => {
      const result = await client.query<DeliveryRow>(
        `WITH candidate AS (
           SELECT delivery_id FROM webhook_deliveries
           WHERE workspace_id=$1 AND ((state IN ('pending','retry') AND next_attempt_at <= $2)
             OR (state='delivering' AND lease_until <= $2))
             AND NOT EXISTS (
               SELECT 1 FROM webhook_deliveries earlier
               WHERE earlier.workspace_id=$1 AND earlier.ordering_key=webhook_deliveries.ordering_key
                 AND earlier.delivery_id <> webhook_deliveries.delivery_id
                 AND (earlier.state IN ('pending','retry') OR (earlier.state='delivering' AND earlier.lease_until > $2))
                 AND earlier.sequence < webhook_deliveries.sequence)
           ORDER BY sequence NULLS LAST, created_at, delivery_id FOR UPDATE SKIP LOCKED LIMIT 1)
         UPDATE webhook_deliveries delivery SET state='delivering', attempt=attempt+1, lease_until=$3
         FROM candidate WHERE delivery.workspace_id=$1 AND delivery.delivery_id=candidate.delivery_id
         RETURNING delivery.*`,
        [workspaceId, now, leaseUntil],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : fromRow(row);
    });
  }
  delivered(workspaceId: string, deliveryId: string, at: Date, status: number): Promise<void> {
    return this.#update(
      workspaceId,
      `UPDATE webhook_deliveries SET state='delivered', delivered_at=$3, last_status=$4, lease_until=NULL, updated_at=clock_timestamp() WHERE workspace_id=$1 AND delivery_id=$2 AND state='delivering'`,
      [workspaceId, deliveryId, at, status],
    );
  }
  failed(
    workspaceId: string,
    deliveryId: string,
    input: Readonly<{
      errorCode: string;
      nextAttemptAt?: Date;
      status?: number;
      terminal: boolean;
    }>,
  ): Promise<void> {
    return this.#update(
      workspaceId,
      `UPDATE webhook_deliveries SET state=$3, next_attempt_at=COALESCE($4,next_attempt_at), last_status=$5, error_code=$6, lease_until=NULL, updated_at=clock_timestamp() WHERE workspace_id=$1 AND delivery_id=$2 AND state='delivering'`,
      [
        workspaceId,
        deliveryId,
        input.terminal ? "dead_letter" : "retry",
        input.nextAttemptAt ?? null,
        input.status ?? null,
        input.errorCode,
      ],
    );
  }
  get(workspaceId: string, deliveryId: string): Promise<DeliveryRecord | undefined> {
    return this.#transaction(workspaceId, async (client) => {
      const result = await client.query<DeliveryRow>(
        "SELECT * FROM webhook_deliveries WHERE workspace_id=$1 AND delivery_id=$2",
        [workspaceId, deliveryId],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : fromRow(row);
    });
  }
  async #update(workspaceId: string, sql: string, values: unknown[]): Promise<void> {
    await this.#transaction(workspaceId, async (client) => {
      const result = await client.query(sql, values);
      if (result.rowCount !== 1) throw new Error("Webhook delivery state changed concurrently.");
    });
  }
}
