import type { ProposedCommand } from "../ask";

export interface PendingDo {
  proposals: ProposedCommand[];
  createdAt: string;
}

export const PENDING_DO_KEY = (userId: number) => `pending:do:${userId}`;
export const STYLE_KEY = (userId: number) => `style:${userId}`;
export const THREAD_KEY = (userId: number) => `thread:${userId}`;

/** Chunk size for a /confirm batch; also drives the ETA quoted back to the user. */
export const CONFIRM_BATCH_RATE_PER_MIN = 25;
