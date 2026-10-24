import { describe, it, expect, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { enqueueJob, processJobBatch, MAX_ATTEMPTS, type JobMessage, type JobRecord } from "../jobs";
import type { Env } from "../types";

describe("JOBS queue retry budget", () => {
  it("gives the queue a delivery past MAX_ATTEMPTS to report crashed attempts", () => {
    const toml = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
    const consumer = toml.split("[[queues.consumers]]")[1] ?? "";
    const m = consumer.match(/^max_retries\s*=\s*(\d+)/m);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(MAX_ATTEMPTS);
  });
});

// Derived from the consumer's signature: the Workers ambient types aren't
// loaded under the bun test tsconfig.
type Batch = Parameters<typeof processJobBatch>[0];
type Msg = Batch["messages"][number];
type SendOptions = { contentType?: string; delaySeconds?: number };

interface Sent {
  body: JobMessage;
  options?: SendOptions;
}

function fakeEnv(kv: Map<string, string> = new Map()): {
  env: Env;
  kv: Map<string, string>;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const env = {
    GITHUB_REPO: "o/r",
    GITHUB_TOKEN: "t",
    TELEGRAM_BOT_TOKEN: "bot",
    ASK_CACHE: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => {
        kv.set(key, value);
      },
      delete: async (key: string) => {
        kv.delete(key);
      },
    },
    JOBS: {
      send: async (body: JobMessage, options?: SendOptions) => {
        sent.push({ body, options });
      },
    },
  } as unknown as Env;
  return { env, kv, sent };
}

function fakeMessage(body: JobMessage, attempts = 1) {
  const calls = { ack: 0, retry: 0 };
  const msg = {
    id: "m1",
    timestamp: new Date(),
    body,
    attempts,
    ack: () => {
      calls.ack++;
    },
    retry: () => {
      calls.retry++;
    },
  } as unknown as Msg;
  return { msg, calls };
}

function batchOf(msg: Msg): Batch {
  return { queue: "plantyj-jobs", messages: [msg] } as unknown as Batch;
}

function confirmJob(commands: string[]): JobRecord {
  return {
    id: "confirm-1-2",
    kind: "confirm",
    chatId: 10,
    messageId: 20,
    userId: 1,
    commands,
    nextIndex: 0,
    results: [],
    createdAt: "2026-10-24T00:00:00Z",
  };
}

describe("JOBS queue consumer", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("sends messages as JSON so the inline size check matches what is stored", async () => {
    const { env, sent } = fakeEnv();
    await enqueueJob(env, confirmJob(["/addzone z1 Bed — east"]));
    expect(sent).toHaveLength(1);
    expect(sent[0].options?.contentType).toBe("json");
    expect("job" in sent[0].body).toBe(true);
  });

  it("acks a redelivered inline job that already finished without running it", async () => {
    const { env } = fakeEnv(new Map([["jobdone:confirm-1-2:0", "done"]]));
    let fetches = 0;
    globalThis.fetch = (() => {
      fetches++;
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;
    const { msg, calls } = fakeMessage({ job: confirmJob(["/addzone z1 Bed"]) });
    await processJobBatch(batchOf(msg), env);
    expect(fetches).toBe(0);
    expect(calls).toEqual({ ack: 1, retry: 0 });
  });

  it("does not retry a /confirm chunk whose commit partly landed", async () => {
    const { env, kv } = fakeEnv();
    const puts: string[] = [];
    const replies: string[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("api.telegram.org")) {
        replies.push(JSON.parse(String(init?.body)).text);
        return Promise.resolve(new Response("{}"));
      }
      if (init?.method === "PUT") {
        puts.push(url);
        // zones.json lands, relationships.json fails.
        return Promise.resolve(
          url.endsWith("zones.json")
            ? new Response("{}")
            : new Response("conflict", { status: 409 }),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as unknown as typeof fetch;

    const { msg, calls } = fakeMessage({
      job: confirmJob(["/addzone z1 Bed", "/reltype t1 // Name // Desc // directional"]),
    });
    await processJobBatch(batchOf(msg), env);

    expect(puts).toHaveLength(2);
    expect(calls).toEqual({ ack: 1, retry: 0 });
    expect(kv.get("jobdone:confirm-1-2:0")).toBe("done");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("only partly saved");
  });

  it("retries a /confirm chunk when nothing was committed", async () => {
    const { env, kv } = fakeEnv();
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PUT") return Promise.resolve(new Response("boom", { status: 500 }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as unknown as typeof fetch;

    const { msg, calls } = fakeMessage({ job: confirmJob(["/addzone z1 Bed"]) });
    await processJobBatch(batchOf(msg), env);

    expect(calls).toEqual({ ack: 0, retry: 1 });
    expect(kv.has("jobdone:confirm-1-2:0")).toBe(false);
  });
});
