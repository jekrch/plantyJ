import type { ProposedCommand } from "../ask";

export interface PendingDo {
  proposals: ProposedCommand[];
  createdAt: string;
}

export const PENDING_DO_KEY = (userId: number) => `pending:do:${userId}`;
export const STYLE_KEY = (userId: number) => `style:${userId}`;
export const THREAD_KEY = (userId: number) => `thread:${userId}`;

/** Commands per /confirm chunk. A chunk costs ~5 GETs + ~5 PUTs (only the
 *  dirty manifests) regardless of size, plus 2 per image deletion, so 25
 *  stays well under the 50-subrequest cap of the queue invocation it runs in. */
export const CONFIRM_CHUNK_SIZE = 25;
