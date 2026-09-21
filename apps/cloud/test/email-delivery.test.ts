import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { LoopbackSmtpEmailDelivery } from "../src/modules/identity/email-delivery";

describe("loopback Mailpit SMTP adapter", () => {
  const servers: Server[] = [];
  afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

  async function smtpServer(): Promise<{ port: number; transcript: string[] }> {
    const transcript: string[] = [];
    const server = createServer((socket) => {
      socket.write("220 mailpit test\r\n");
      let buffer = "";
      let data = false;
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        for (;;) {
          const end = buffer.indexOf("\r\n");
          if (end < 0) return;
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          transcript.push(line);
          if (data) {
            if (line === ".") { data = false; socket.write("250 queued\r\n"); }
          } else if (line.startsWith("EHLO")) socket.write("250-mailpit\r\n250 PIPELINING\r\n");
          else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) socket.write("250 ok\r\n");
          else if (line === "DATA") { data = true; socket.write("354 continue\r\n"); }
          else if (line === "QUIT") socket.write("221 bye\r\n");
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("SMTP test address missing");
    return { port: address.port, transcript };
  }

  it("delivers a bounded message over loopback and dot-stuffs body lines", async () => {
    const test = await smtpServer();
    const delivery = new LoopbackSmtpEmailDelivery({
      host: "127.0.0.1", port: test.port, from: "account@gooddealer.invalid",
    });
    await delivery.deliver({ to: "owner@example.com", subject: "GoodDealer code", text: "first\n.secret" });
    expect(test.transcript).toContain("RCPT TO:<owner@example.com>");
    expect(test.transcript).toContain("..secret");
  });

  it("rejects non-loopback destinations and header injection before connecting", async () => {
    expect(() => new LoopbackSmtpEmailDelivery({
      host: "mail.example.com" as "127.0.0.1", port: 1025, from: "account@example.com",
    })).toThrow("loopback SMTP configuration is invalid");
    const delivery = new LoopbackSmtpEmailDelivery({
      host: "127.0.0.1", port: 1025, from: "account@example.com",
    });
    await expect(delivery.deliver({
      to: "victim@example.com\r\nBcc: attacker@example.com", subject: "code", text: "safe",
    })).rejects.toThrow("identity email message is invalid");
    await expect(delivery.deliver({
      to: "victim@example.com", subject: "code\r\nBcc: attacker@example.com", text: "safe",
    })).rejects.toThrow("identity email message is invalid");
  });
});
