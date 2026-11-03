import { z } from "zod/v4";
import { expect, test } from "bun:test";

const schema = z.object({
  active: z.boolean(),
  settings: z.object({
    availableInMCP: z.boolean(),
    saveDataErrorExecution: z.string(),
    saveDataSuccessExecution: z.string(),
    saveManualExecutions: z.boolean(),
  }),
  nodes: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      disabled: z.boolean().optional(),
      retryOnFail: z.boolean().optional(),
      credentials: z.unknown().optional(),
      parameters: z.record(z.string(), z.unknown()),
    }),
  ),
});
test("the separate n8n template cannot activate provider or application execution", async () => {
  const path = new URL(
    "../../../../../integrations/n8n/jobpilot-discovery.inactive.json",
    import.meta.url,
  );
  const workflow = schema.parse(await Bun.file(path).json());
  expect(workflow.active).toBe(false);
  expect(workflow.settings).toMatchObject({
    availableInMCP: false,
    saveDataErrorExecution: "none",
    saveDataSuccessExecution: "none",
    saveManualExecutions: false,
  });
  const schedule = workflow.nodes.filter((node) => node.type.endsWith("scheduleTrigger"));
  const http = workflow.nodes.filter((node) => node.type.endsWith("httpRequest"));
  expect(schedule).toHaveLength(1);
  expect(http).toHaveLength(1);
  expect(schedule[0]!.disabled).toBe(true);
  expect(http[0]!.disabled).toBe(true);
  expect(http[0]!.retryOnFail).toBe(false);
  expect(http[0]!.parameters.url).toBe("https://relay.example.invalid/trigger");
  for (const node of workflow.nodes) expect(node.credentials).toBeUndefined();
  const serialized = JSON.stringify(workflow);
  for (const forbidden of [
    "BEGIN PRIVATE KEY",
    "Telegram",
    "googleSheets",
    "googleDrive",
    "jsearch.p.rapidapi.com",
    "JOBPILOT_API_TOKEN",
  ])
    expect(serialized).not.toContain(forbidden);
});
