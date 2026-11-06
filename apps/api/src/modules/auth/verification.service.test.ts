import { expect, test } from "bun:test";

async function resetWithFailedDelivery(accountExists: boolean) {
  const script = `
    import { render } from '@react-email/render';
    import { VerificationService } from ${JSON.stringify(new URL("./verification.service.ts", import.meta.url).href)};
    import { logger } from ${JSON.stringify(new URL("../../common/logger/index.ts", import.meta.url).href)};
    const logs = [];
    logger.error = (...args) => logs.push(args);
    let mailAttempts = 0;
    let tokens = 0;
    const db = {
      user: {findUnique: async () => (${accountExists ? "{id: 'fixture-owner', email: 'private-recipient@example.invalid'}" : "null"})},
      verificationToken: {
        deleteMany: async () => ({count: 0}),
        create: async () => {tokens++;},
      },
    };
    const mailer = {send: async (message) => {
      mailAttempts++;
      const body = await render(message.react, {plainText: true});
      throw new Error('PRIVATE_PROVIDER_DIAGNOSTIC ' + message.to + ' ' + body);
    }};
    const service = new VerificationService(db, mailer, {});
    const result = await service.requestPasswordReset('private-recipient@example.invalid');
    console.log('RESULT:' + JSON.stringify({result, mailAttempts, tokens}));
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
      APP_URL: "https://jobpilot.example.invalid",
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
  return stdout + stderr;
}

test("password reset acknowledges existing and missing accounts even when private provider errors occur", async () => {
  const existing = await resetWithFailedDelivery(true);
  const missing = await resetWithFailedDelivery(false);
  expect(existing).toContain('RESULT:{"result":{"ok":true},"mailAttempts":1,"tokens":1}');
  expect(missing).toContain('RESULT:{"result":{"ok":true},"mailAttempts":0,"tokens":0}');
  expect(existing).toContain('LOGS:[["Password-reset email delivery failed"]]');
  expect(missing).toContain("LOGS:[]");
  for (const value of [
    "PRIVATE_PROVIDER_DIAGNOSTIC",
    "private-recipient@example.invalid",
    "reset-password?token=",
    "fixture-owner",
  ]) {
    expect(existing).not.toContain(value);
    expect(missing).not.toContain(value);
  }
});
