/* oxlint-disable unicorn/require-post-message-target-origin -- Workers and BroadcastChannels do not take a target origin. */
import type { Message, Operation, Result } from "./protocol.ts";

/** One instance per tab. Web Locks owns the entire Worker lifetime, including VFS installation. */
class WebData {
  private channel = new BroadcastChannel("anki-alarm:data:v1");
  private id = crypto.randomUUID();
  private worker: Worker | undefined;
  private leader: string | undefined;
  private failure?: string;
  private listeners = new Set<() => void>();
  private pending = new Map<
    string,
    { resolve: (value: Result) => void; reject: (error: Error) => void }
  >();
  private release?: () => void;
  private abort = new AbortController();

  constructor() {
    this.channel.addEventListener("message", ({ data }: MessageEvent<Message>) =>
      this.receive(data),
    );
    if (!navigator.locks || !navigator.storage?.getDirectory) {
      this.failure = "This browser does not support offline storage";
      return;
    }
    void navigator.locks
      .request("anki-alarm:database:v1", { signal: this.abort.signal }, async () => {
        await new Promise<void>((resolve) => {
          this.release = resolve;
          this.worker = new Worker(new URL("./database.worker.ts", import.meta.url), {
            type: "module",
          });
          this.worker.addEventListener("message", ({ data }) => {
            if (data.type === "ready") {
              this.leader = this.id;
              this.channel.postMessage({ type: "leader", id: this.id });
            } else if (data.type === "failed") {
              this.failure = data.error;
            } else if (data.type === "changed") {
              this.changed();
            } else {
              this.receive(data);
              this.channel.postMessage(data);
            }
          });
          this.worker.addEventListener("error", (event) => {
            this.failure = event.message;
          });
        });
        this.worker?.terminate();
        this.worker = undefined;
      })
      .catch((error: unknown) => {
        if (!this.abort.signal.aborted) this.failure = String(error);
      });
  }

  private receive(message: Message) {
    if (message.type === "discover" && this.leader === this.id)
      this.channel.postMessage({ type: "leader", id: this.id });
    if (message.type === "leader") this.leader = message.id;
    if (message.type === "changed") for (const listener of this.listeners) listener();
    if (message.type === "request" && message.leader === this.id) this.worker?.postMessage(message);
    if (message.type === "response") {
      const pending = this.pending.get(message.id);
      if (message.error) pending?.reject(new Error(message.error));
      else if (message.result !== undefined) pending?.resolve(message.result);
    }
  }

  private changed() {
    this.channel.postMessage({ type: "changed" });
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async request(operation: Operation): Promise<Result> {
    if (this.leader !== this.id) this.leader = undefined;
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let sent = false;
      const finish = (error?: Error, result?: Result) => {
        clearInterval(discovery);
        clearTimeout(timeout);
        this.pending.delete(id);
        if (error) reject(error);
        else resolve(result!);
      };
      const send = () => {
        if (this.failure) return finish(new Error(this.failure));
        if (sent) return;
        // Discover before sending so an old leader id is never reused after a handoff.
        if (!this.leader) {
          this.channel.postMessage({ type: "discover" });
          return;
        }
        sent = true;
        const request = { type: "request", id, leader: this.leader, operation } as const;
        if (this.leader === this.id) this.worker?.postMessage(request);
        else this.channel.postMessage(request);
      };
      this.pending.set(id, {
        resolve: (value) => finish(undefined, value),
        reject: (error) => finish(error),
      });
      const discovery = setInterval(send, 100);
      const timeout = setTimeout(() => {
        this.leader = undefined;
        finish(
          new Error(
            "Storage unavailable. The operation may have committed; reload before retrying.",
          ),
        );
      }, 20_000);
      send();
    });
  }

  close = () => {
    this.abort.abort();
    this.worker?.terminate();
    this.release?.();
    for (const pending of this.pending.values()) pending.reject(new Error("Tab closed"));
    this.channel.close();
  };
}

let instance: WebData | undefined;
export const webData = () => (instance ??= new WebData());
