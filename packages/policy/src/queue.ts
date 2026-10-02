export type QueueStatus = "open" | "assigned" | "escalated" | "resolved";
export interface QueueItem {
  readonly id: string;
  readonly capsuleVersion: string;
  readonly priority: "normal" | "high";
  readonly status: QueueStatus;
  readonly version: number;
  readonly assignee?: string;
  readonly approvals: readonly string[];
}
export function assign(item: QueueItem, reviewer: string, expected: number): QueueItem {
  if (item.version !== expected) throw new Error("REVIEW_CONFLICT");
  if (item.status === "resolved") throw new Error("REVIEW_RESOLVED");
  return Object.freeze({
    ...item,
    status: "assigned",
    assignee: reviewer,
    version: item.version + 1,
  });
}
export function approve(item: QueueItem, reviewer: string, expected: number): QueueItem {
  if (item.version !== expected) throw new Error("REVIEW_CONFLICT");
  if (item.approvals.includes(reviewer)) throw new Error("DUPLICATE_APPROVAL");
  const approvals = Object.freeze([...item.approvals, reviewer]);
  if (item.priority === "high" && approvals.length < 2)
    return Object.freeze({ ...item, approvals, version: item.version + 1 });
  return Object.freeze({ ...item, approvals, status: "resolved", version: item.version + 1 });
}
