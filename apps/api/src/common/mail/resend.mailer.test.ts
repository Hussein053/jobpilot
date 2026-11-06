import { expect, test } from "bun:test";

async function sendWithProvider(mode: "response" | "exception" | "success") {
  const script = `
    import { mock } from 'bun:test';
    import { createElement } from 'react';
    import { logger } from ${JSON.stringify(new URL("../logger/index.ts", import.meta.url).href)};
    const logs = [];
    logger.error = (...args) => logs.push(args);
    let attempts = 0;
    mock.module('resend', () => ({Resend: class {
      emails = {send: async () => {
        attempts++;
        const detail = 'PRIVATE_PROVIDER_DIAGNOSTIC private-recipient@example.invalid https://jobpilot.example.invalid/reset-password?token=PRIVATE_RESET_TOKEN';
        if (${JSON.stringify(mode)} === 'exception') throw new Error(detail);
        return {error: ${JSON.stringify(mode)} === 'response' ? {message: detail} : null};
      }};
    }}));
    const { ResendMailer } = await import(${JSON.stringify(new URL("./resend.mailer.ts", import.meta.url).href)});
    try {
      await new ResendMailer().send({to: 'private-recipient@example.invalid', subject: 'PRIVATE_SUBJECT', react: createElement('p', {}, 'PRIVATE_MESSAGE')});
      console.log('MAIL_ACCEPTED');
    } catch (error) {
      console.log('MAIL_REJECTED:' + error.stack);
    }
    console.log('ATTEMPTS:' + attempts);
    console.log('LOGS:' + JSON.stringify(logs));
  `;
  const child = Bun.spawn({
    cmd: [process.execPath, "--eval", script],
    cwd: new URL("../../../", import.meta.url).pathname,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
      SECRET_MASTER_KEY: Buffer.alloc(32).toString("base64"),
      LOG_LEVEL: "info",
      RESEND_API_KEY: "fixture-key-not-used-on-network",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

test.each(["response", "exception"] as const)(
  "provider %s failures cannot expose account mail details through logs or thrown errors",
  async (mode) => {
    const output = await sendWithProvider(mode);
    expect(output).toContain("MAIL_REJECTED:Error: Transactional email delivery failed");
    expect(output).toContain('LOGS:[["Transactional email delivery failed"]]');
    expect(output).toContain("ATTEMPTS:1");
    for (const value of [
      "MAIL_ACCEPTED",
      "PRIVATE_PROVIDER_DIAGNOSTIC",
      "private-recipient@example.invalid",
      "PRIVATE_SUBJECT",
      "PRIVATE_MESSAGE",
      "PRIVATE_RESET_TOKEN",
    ])
      expect(output).not.toContain(value);
  },
);

test("successful provider dispatch remains successful without mail-detail logging", async () => {
  const output = await sendWithProvider("success");
  expect(output).toContain("MAIL_ACCEPTED");
  expect(output).toContain("ATTEMPTS:1");
  expect(output).toContain("LOGS:[]");
  expect(output).not.toContain("MAIL_REJECTED");
});
