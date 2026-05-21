import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sendReply, downloadFile, makeReplier } from "../telegram";
import type { Env, TelegramMessage } from "../types";

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: RecordedCall[] = [];
let responder: (url: string, init?: RequestInit) => Response | Promise<Response>;

beforeEach(() => {
  calls = [];
  responder = () => new Response("{}", { status: 200 });
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return Promise.resolve(responder(url, init));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function parseBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse((init?.body as string) ?? "{}");
}

describe("sendReply", () => {
  it("POSTs JSON to the sendMessage endpoint with reply_to_message_id on the first chunk", async () => {
    await sendReply("TOKEN", 123, 456, "hello");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(parseBody(calls[0].init)).toEqual({
      chat_id: 123,
      text: "hello",
      reply_to_message_id: 456,
    });
  });

  it("sends a single request for messages at or under the 4096-char limit", async () => {
    await sendReply("T", 1, 2, "a".repeat(4096));
    expect(calls).toHaveLength(1);
    expect((parseBody(calls[0].init).text as string).length).toBe(4096);
  });

  it("splits messages over 4096 chars into multiple requests", async () => {
    const text = "a".repeat(5000);
    await sendReply("T", 1, 2, text);
    expect(calls.length).toBeGreaterThan(1);
    const joined = calls.map((c) => parseBody(c.init).text as string).join("");
    expect(joined.length).toBe(text.length);
    expect(joined).toBe(text);
  });

  it("only attaches reply_to_message_id to the first chunk", async () => {
    await sendReply("T", 1, 99, "a".repeat(5000));
    const bodies = calls.map((c) => parseBody(c.init));
    expect(bodies[0].reply_to_message_id).toBe(99);
    for (const b of bodies.slice(1)) {
      expect(b.reply_to_message_id).toBeUndefined();
    }
  });

  it("prefers splitting on a newline when one falls in the upper half of the chunk", async () => {
    // Newline at position 4000 — within the upper half (>= 2048), so the
    // first chunk should be the part before the newline, and the newline
    // itself should be consumed (not duplicated at the start of chunk 2).
    const head = "x".repeat(4000);
    const tail = "y".repeat(2000);
    await sendReply("T", 1, 2, `${head}\n${tail}`);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const first = parseBody(calls[0].init).text as string;
    const second = parseBody(calls[1].init).text as string;
    expect(first).toBe(head);
    expect(second.startsWith("y")).toBe(true);
  });

  it("does not throw when Telegram returns a non-2xx status", async () => {
    responder = () => new Response("boom", { status: 500 });
    await expect(sendReply("T", 1, 2, "hi")).resolves.toBeUndefined();
  });
});

describe("makeReplier", () => {
  it("binds chat_id and reply_to_message_id from the message", async () => {
    const env = { TELEGRAM_BOT_TOKEN: "TOK" } as Env;
    const message = { message_id: 77, chat: { id: 42, type: "private" } } as TelegramMessage;
    const reply = makeReplier(env, message);
    await reply("hi");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.telegram.org/botTOK/sendMessage");
    expect(parseBody(calls[0].init)).toEqual({
      chat_id: 42,
      text: "hi",
      reply_to_message_id: 77,
    });
  });
});

describe("downloadFile", () => {
  it("calls getFile and then downloads the resolved file_path", async () => {
    responder = (url) => {
      if (url.includes("/getFile")) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: "photos/x.jpg" } }), {
          status: 200,
        });
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    };
    const buf = await downloadFile("FILE_ID", "TOKEN");
    expect(calls[0].url).toBe("https://api.telegram.org/botTOKEN/getFile?file_id=FILE_ID");
    expect(calls[1].url).toBe("https://api.telegram.org/file/botTOKEN/photos/x.jpg");
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("throws when getFile returns ok:false", async () => {
    responder = () =>
      new Response(JSON.stringify({ ok: false, description: "no such file" }), { status: 200 });
    await expect(downloadFile("BAD", "T")).rejects.toThrow(/getFile failed/);
  });

  it("throws when the download itself returns a non-2xx", async () => {
    responder = (url) => {
      if (url.includes("/getFile")) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: "p.jpg" } }), {
          status: 200,
        });
      }
      return new Response("nope", { status: 404 });
    };
    await expect(downloadFile("F", "T")).rejects.toThrow(/HTTP 404/);
  });
});
