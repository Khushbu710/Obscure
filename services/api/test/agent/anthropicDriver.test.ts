import { describe, expect, it } from "vitest";
import { AgentDriverError, AnthropicLlmDriver } from "../../src/agent/anthropicDriver.js";

/**
 * Tests the driver's own failure handling using an injected fake Anthropic
 * client (shape-compatible stub, not the real SDK) - no network, no live
 * credentials. This is distinct from anthropicLive.integration.test.ts,
 * which is the only thing that would prove real API compatibility and is
 * skipped without ANTHROPIC_API_KEY.
 */
function driverWithFakeClient(fakeCreate: (...args: unknown[]) => unknown): AnthropicLlmDriver {
  const fakeClient = { messages: { create: fakeCreate } } as unknown as ConstructorParameters<typeof AnthropicLlmDriver>[4];
  return new AnthropicLlmDriver("unused-key", "claude-sonnet-4-5", 1024, 30_000, fakeClient);
}

const BASE_PARAMS = {
  systemPrompt: "system",
  tools: [{ name: "ping", description: "ping", inputSchema: { type: "object" as const, properties: {} } }],
  transcript: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }],
};

describe("AnthropicLlmDriver - error handling (never a raw SDK/network exception)", () => {
  it("wraps a thrown network/API error in AgentDriverError, not the raw error", async () => {
    const driver = driverWithFakeClient(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(driver.nextStep(BASE_PARAMS)).rejects.toBeInstanceOf(AgentDriverError);
  });

  it("wraps a timeout-style abort error in AgentDriverError", async () => {
    const driver = driverWithFakeClient(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    await expect(driver.nextStep(BASE_PARAMS)).rejects.toBeInstanceOf(AgentDriverError);
  });

  it("never includes the API key in a thrown error's message", async () => {
    const apiKey = "sk-ant-super-secret-value";
    const fakeClient = {
      messages: {
        create: async () => {
          throw new Error("unauthorized");
        },
      },
    } as unknown as ConstructorParameters<typeof AnthropicLlmDriver>[4];
    const driver = new AnthropicLlmDriver(apiKey, "claude-sonnet-4-5", 1024, 30_000, fakeClient);

    try {
      await driver.nextStep(BASE_PARAMS);
      expect.fail("expected a rejection");
    } catch (err) {
      expect(String(err)).not.toContain(apiKey);
    }
  });
});

describe("AnthropicLlmDriver - malformed / unexpected responses", () => {
  it("fails closed (AgentDriverError) rather than silently picking one of multiple tool_use blocks", async () => {
    const driver = driverWithFakeClient(async () => ({
      content: [
        { type: "tool_use", id: "t1", name: "search_esims", input: {} },
        { type: "tool_use", id: "t2", name: "propose_purchase", input: {} },
      ],
      stop_reason: "tool_use",
    }));
    await expect(driver.nextStep(BASE_PARAMS)).rejects.toThrow(/multiple tool_use|tool_use blocks/i);
  });

  it("returns an empty final_text rather than crashing on an empty content array", async () => {
    const driver = driverWithFakeClient(async () => ({ content: [], stop_reason: "end_turn" }));
    const step = await driver.nextStep(BASE_PARAMS);
    expect(step).toEqual({ kind: "final_text", text: "" });
  });

  it("fails closed on a truncated response (stop_reason: max_tokens) with no tool_use", async () => {
    const driver = driverWithFakeClient(async () => ({
      content: [{ type: "text", text: "partial, cut off mid-" }],
      stop_reason: "max_tokens",
    }));
    await expect(driver.nextStep(BASE_PARAMS)).rejects.toBeInstanceOf(AgentDriverError);
  });

  it("maps a single tool_use block correctly (happy path, not a regression)", async () => {
    const driver = driverWithFakeClient(async () => ({
      content: [{ type: "tool_use", id: "t1", name: "search_esims", input: { query: "japan" } }],
      stop_reason: "tool_use",
    }));
    const step = await driver.nextStep(BASE_PARAMS);
    expect(step).toEqual({ kind: "tool_use", id: "t1", name: "search_esims", input: { query: "japan" } });
  });

  it("maps a plain text response correctly (happy path, not a regression)", async () => {
    const driver = driverWithFakeClient(async () => ({
      content: [{ type: "text", text: "I could not find a match." }],
      stop_reason: "end_turn",
    }));
    const step = await driver.nextStep(BASE_PARAMS);
    expect(step).toEqual({ kind: "final_text", text: "I could not find a match." });
  });
});
