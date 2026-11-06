import { expect, test } from "bun:test";

async function sendIn(mode: "development" | "production") {
  const script = `
    import { createElement } from 'react';
    import { ConsoleMailer } from ${JSON.stringify(new URL("./console.mailer.ts", import.meta.url).href)};
    function Message() {
      console.log('MAIL_BODY_RENDERED');
      return createElement('p', {}, 'https://jobpilot.example.invalid/reset-password?token=PRIVATE_RESET_TOKEN');
    }
    try {
      await new ConsoleMailer().send({to: 'private-recipient@example.invalid', subject: 'PRIVATE_SUBJECT', react: createElement(Message)});
      console.log('MAIL_ACCEPTED');
    } catch (error) {
      console.log('MAIL_REJECTED:' + error.message);
    }
  `;
  const child = Bun.spawn({
    cmd: [process.execPath, "--eval", script],
    cwd: new URL("../../../", import.meta.url).pathname,
    env: {
      NODE_ENV: mode,
      DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
      SECRET_MASTER_KEY: Buffer.alloc(32).toString("base64"),
      LOG_LEVEL: "info",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode).toBe(0);
  return stdout + stderr;
}

test("production without a mail provider rejects before rendering or logging private mail", async () => {
  const output = await sendIn("production");
  expect(output).toContain("MAIL_REJECTED:Transactional email is unavailable");
  for (const value of [
    "MAIL_BODY_RENDERED",
    "MAIL_ACCEPTED",
    "PRIVATE_RESET_TOKEN",
    "private-recipient@example.invalid",
    "PRIVATE_SUBJECT",
  ])
    expect(output).not.toContain(value);
});

test("local development retains rendered email links for testing", async () => {
  const output = await sendIn("development");
  expect(output).toContain("MAIL_BODY_RENDERED");
  expect(output).toContain("MAIL_ACCEPTED");
  expect(output).toContain("PRIVATE_RESET_TOKEN");
  expect(output).toContain("private-recipient@example.invalid");
  expect(output).not.toContain("MAIL_REJECTED");
});
