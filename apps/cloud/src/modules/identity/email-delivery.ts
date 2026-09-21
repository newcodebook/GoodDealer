import { createConnection, isIP, type Socket } from "node:net";

export interface IdentityEmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailDeliveryPort {
  deliver(message: IdentityEmailMessage): Promise<void>;
}

export class DenyingEmailDeliveryPort implements EmailDeliveryPort {
  async deliver(): Promise<void> {
    throw new Error("email delivery is disabled");
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

  async deliver(message: IdentityEmailMessage): Promise<void> {
    if (!mailbox(message.to) || !headerValue(message.subject) || !bodyValue(message.text)) {
      throw new TypeError("identity email message is invalid");
    }
    const socket = createConnection({ host: this.#configuration.host, port: this.#configuration.port });
    socket.setTimeout(this.#configuration.timeoutMs);
    try {
      await smtpExchange(socket, [
        [null, [220]],
        [`EHLO account.gooddealer.com\r\n`, [250]],
        [`MAIL FROM:<${this.#configuration.from}>\r\n`, [250]],
        [`RCPT TO:<${message.to}>\r\n`, [250, 251]],
        ["DATA\r\n", [354]],
        [smtpMessage(this.#configuration.from, message), [250]],
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

function smtpMessage(from: string, message: IdentityEmailMessage): string {
  const escaped = message.text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
    .split("\n").map((line) => line.startsWith(".") ? `.${line}` : line).join("\r\n");
  return `From: GoodDealer <${from}>\r\nTo: <${message.to}>\r\nSubject: ${message.subject}\r\nContent-Type: text/plain; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${escaped}\r\n.\r\n`;
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
