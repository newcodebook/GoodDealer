import { createConnection, isIP, type Socket } from "node:net";

export interface IdentityEmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface IdentityEmailDelivery {
  /** Stable outbox identity. Production adapters MUST bind this to the provider idempotency mechanism. */
  readonly idempotencyKey: string;
  readonly message: IdentityEmailMessage;
}

export interface EmailDeliveryPort {
  deliver(delivery: IdentityEmailDelivery): Promise<void>;
}

export class DenyingEmailDeliveryPort implements EmailDeliveryPort {
  async deliver(): Promise<void> {
    throw new Error("email delivery is disabled");
  }
}

export interface ResendEmailDeliveryConfiguration {
  /** Resend API key. The value must only be supplied by secret custody. */
  readonly apiKey: string;
  /** Verified sender mailbox owned by the Resend account. */
  readonly from: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
}

/**
 * Production transaction-email transport.
 *
 * The durable outbox owns retry/idempotency semantics. This adapter binds the
 * same outbox identity to Resend's Idempotency-Key header and never includes
 * provider response bodies or credentials in thrown errors.
 */
export class ResendEmailDelivery implements EmailDeliveryPort {
  readonly #configuration: Required<ResendEmailDeliveryConfiguration>;

  constructor(configuration: ResendEmailDeliveryConfiguration) {
    const endpoint = configuration.endpoint ?? "https://api.resend.com/emails";
    const timeoutMs = configuration.timeoutMs ?? 10_000;
    if (typeof configuration.apiKey !== "string" || configuration.apiKey.length < 20
      || /[\r\n\u0000]/u.test(configuration.apiKey)
      || !mailbox(configuration.from)
      || !httpsEndpoint(endpoint)
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new TypeError("Resend email configuration is invalid");
    }
    this.#configuration = { ...configuration, endpoint, timeoutMs };
  }

  async deliver(delivery: IdentityEmailDelivery): Promise<void> {
    if (!idempotencyKey(delivery.idempotencyKey)
      || !mailbox(delivery.message.to)
      || !headerValue(delivery.message.subject)
      || !bodyValue(delivery.message.text)) {
      throw new TypeError("identity email message is invalid");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#configuration.timeoutMs);
    try {
      let response: Response;
      try {
        const request = globalThis.fetch;
        response = await request(this.#configuration.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#configuration.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": delivery.idempotencyKey,
          },
          body: JSON.stringify({
            from: `GoodDealer <${this.#configuration.from}>`,
            to: [delivery.message.to],
            subject: delivery.message.subject,
            text: delivery.message.text,
          }),
          signal: controller.signal,
        });
      } catch {
        throw new Error("Resend email request failed");
      }
      const body = await boundedResponseText(response);
      if (!response.ok) throw new Error("Resend email provider rejected message");
      if (!resendResponse(body)) throw new Error("Resend email provider response is invalid");
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface LoopbackSmtpConfiguration {
  readonly host: "127.0.0.1" | "::1";
  readonly port: number;
  readonly from: string;
  readonly timeoutMs?: number;
}

/** Development-only SMTP transport. It refuses every non-loopback destination and SMTP header injection. */
export class LoopbackSmtpEmailDelivery implements EmailDeliveryPort {
  readonly #configuration: Required<LoopbackSmtpConfiguration>;

  constructor(configuration: LoopbackSmtpConfiguration) {
    if ((configuration.host !== "127.0.0.1" && configuration.host !== "::1")
      || isIP(configuration.host) === 0
      || !Number.isSafeInteger(configuration.port) || configuration.port < 1_024 || configuration.port > 65_535
      || !mailbox(configuration.from)) {
      throw new TypeError("loopback SMTP configuration is invalid");
    }
    const timeoutMs = configuration.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new TypeError("loopback SMTP timeout is invalid");
    }
    this.#configuration = { ...configuration, timeoutMs };
  }

  async deliver(delivery: IdentityEmailDelivery): Promise<void> {
    if (!idempotencyKey(delivery.idempotencyKey)
      || !mailbox(delivery.message.to)
      || !headerValue(delivery.message.subject)
      || !bodyValue(delivery.message.text)) {
      throw new TypeError("identity email message is invalid");
    }
    const socket = createConnection({ host: this.#configuration.host, port: this.#configuration.port });
    socket.setTimeout(this.#configuration.timeoutMs);
    try {
      await smtpExchange(socket, [
        [null, [220]],
        [`EHLO account.gooddealer.com\r\n`, [250]],
        [`MAIL FROM:<${this.#configuration.from}>\r\n`, [250]],
        [`RCPT TO:<${delivery.message.to}>\r\n`, [250, 251]],
        ["DATA\r\n", [354]],
        [smtpMessage(this.#configuration.from, delivery), [250]],
        ["QUIT\r\n", [221]],
      ]);
    } finally {
      socket.destroy();
    }
  }
}

async function smtpExchange(
  socket: Socket,
  steps: readonly (readonly [string | null, readonly number[]])[],
): Promise<void> {
  let buffered = "";
  const replies: string[] = [];
  let wake: (() => void) | null = null;
  const failed = new Promise<never>((_resolve, reject) => {
    socket.once("error", reject);
    socket.once("timeout", () => reject(new Error("SMTP exchange timed out")));
    socket.once("close", () => reject(new Error("SMTP connection closed")));
  });
  socket.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    if (buffered.length > 16_384) socket.destroy(new Error("SMTP response exceeded limit"));
    for (;;) {
      const lineEnd = buffered.indexOf("\r\n");
      if (lineEnd < 0) break;
      const line = buffered.slice(0, lineEnd);
      buffered = buffered.slice(lineEnd + 2);
      replies.push(line);
      wake?.();
      wake = null;
    }
  });
  for (const [command, accepted] of steps) {
    if (command !== null) socket.write(command);
    const code = await Promise.race([readReply(replies, () => new Promise<void>((resolve) => { wake = resolve; })), failed]);
    if (!accepted.includes(code)) throw new Error("SMTP server rejected identity email");
  }
}

async function readReply(replies: string[], wait: () => Promise<void>): Promise<number> {
  for (;;) {
    while (replies.length === 0) await wait();
    const line = replies.shift();
    const match = /^(\d{3})([ -])/.exec(line ?? "");
    if (match === null) throw new Error("SMTP response is invalid");
    if (match[2] === " ") return Number(match[1]);
  }
}

function smtpMessage(from: string, delivery: IdentityEmailDelivery): string {
  const escaped = delivery.message.text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
    .split("\n").map((line) => line.startsWith(".") ? `.${line}` : line).join("\r\n");
  return `From: GoodDealer <${from}>\r\nTo: <${delivery.message.to}>\r\nSubject: ${delivery.message.subject}\r\nMessage-ID: <${delivery.idempotencyKey}@account.gooddealer.com>\r\nContent-Type: text/plain; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${escaped}\r\n.\r\n`;
}

function idempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,160}$/u.test(value);
}

function mailbox(value: string): boolean {
  return value.length >= 3 && value.length <= 320 && /^[^\s<>@\r\n]+@[^\s<>@\r\n]+$/u.test(value);
}

function headerValue(value: string): boolean {
  return value.length >= 1 && value.length <= 160 && !/[\r\n\u0000]/u.test(value);
}

function bodyValue(value: string): boolean {
  return value.length >= 1 && new TextEncoder().encode(value).length <= 16_384 && !value.includes("\u0000");
}

function httpsEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      && url.hash === "" && url.search === "" && url.pathname === "/emails";
  } catch {
    return false;
  }
}

async function boundedResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 8_192) throw new Error("response too large");
    return text;
  } catch {
    throw new Error("Resend email provider response is unreadable");
  }
}

function resendResponse(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      && Object.getPrototypeOf(parsed) === Object.prototype
      && typeof (parsed as { id?: unknown }).id === "string"
      && /^[A-Za-z0-9_-]{8,200}$/u.test((parsed as { id: string }).id);
  } catch {
    return false;
  }
}
