import { describe, expect, it } from "vitest";
import { AgentDriverError, GeminiLlmDriver, type GeminiClientLike } from "../../src/agent/geminiDriver.js";

/**
 * Tests the driver's own failure handling using an injected fake Gemini
 * client (shape-compatible stub, not the real SDK) - no network, no live
 * credentials. This is distinct from geminiLive.integration.test.ts, which
 * is the only thing that would prove real API compatibility and is skipped
 * without GEMINI_API_KEY.
 */
function driverWithFakeClient(generateContent: GeminiClientLike["models"]["generateContent"]): GeminiLlmDriver {
  const fakeClient: GeminiClientLike = { models: { generateContent } };
  return new GeminiLlmDriver("unused-key", "gemini-flash-latest", 1024, 30_000, fakeClient);
}

const BASE_PARAMS = {
  systemPrompt: "system",
  tools: [{ name: "ping", description: "ping", inputSchema: { type: "object" as const, properties: {} } }],
  transcript: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }],
};

describe("GeminiLlmDriver - error handling (never a raw SDK/network exception)", () => {
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
    const apiKey = "gemini-super-secret-value";
    const driver = new GeminiLlmDriver(apiKey, "gemini-flash-latest", 1024, 30_000, {
      models: {
        generateContent: async () => {
          throw new Error("unauthorized");
        },
      },
    });

    try {
      await driver.nextStep(BASE_PARAMS);
      expect.fail("expected a rejection");
    } catch (err) {
      expect(String(err)).not.toContain(apiKey);
    }
  });
});

describe("GeminiLlmDriver - malformed / unexpected responses", () => {
  it("fails closed (AgentDriverError) rather than silently picking one of multiple function calls", async () => {
    const driver = driverWithFakeClient(async () =>
      fakeResponse([
        { functionCall: { id: "t1", name: "search_esims", args: {} } },
        { functionCall: { id: "t2", name: "propose_purchase", args: {} } },
      ]),
    );
    await expect(driver.nextStep(BASE_PARAMS)).rejects.toThrow(/multiple|function calls/i);
  });

  it("returns an empty final_text rather than crashing on an empty parts array", async () => {
    const driver = driverWithFakeClient(async () => fakeResponse([]));
    const step = await driver.nextStep(BASE_PARAMS);
    expect(step).toEqual({ kind: "final_text", text: "" });
  });

  it("fails closed on a truncated response (finishReason: MAX_TOKENS) with no function call", async () => {
    const driver = driverWithFakeClient(async () => fakeResponse([{ text: "partial, cut off mid-" }], "MAX_TOKENS"));
    await expect(driver.nextStep(BASE_PARAMS)).rejects.toBeInstanceOf(AgentDriverError);
  });

  it("maps a single function call correctly (happy path, not a regression)", async () => {
    const driver = driverWithFakeClient(async () => fakeResponse([{ functionCall: { id: "t1", name: "search_esims", args: { query: "japan" } } }]));
    const step = await driver.nextStep(BASE_PARAMS);
    expect(step).toEqual({ kind: "tool_use", id: "t1", name: "search_esims", input: { query: "japan" } });
  });

  it("mints an id when Gemini omits one on a single function call", async () => {
    const driver = driverWithFakeClient(async () => fakeResponse([{ functionCall: { name: "search_esims", args: {} } }]));
    const step = await driver.nextStep(BASE_PARAMS);
    expect(step.kind).toBe("tool_use");
    if (step.kind === "tool_use") expect(step.id).toBeTruthy();
  });

  it("maps a plain text response correctly (happy path, not a regression)", async () => {
    const driver = driverWithFakeClient(async () => fakeResponse([{ text: "I could not find a match." }]));
    const step = await driver.nextStep(BASE_PARAMS);
    expect(step).toEqual({ kind: "final_text", text: "I could not find a match." });
  });
});

describe("GeminiLlmDriver - transcript translation (tool_use/tool_result -> Gemini parts)", () => {
  it("sends the tool's name on the function response, derived from the preceding tool_use block", async () => {
    let captured: unknown;
    const driver = driverWithFakeClient(async (params) => {
      captured = params;
      return fakeResponse([{ text: "ok" }]);
    });
    await driver.nextStep({
      ...BASE_PARAMS,
      transcript: [
        { role: "user", content: [{ type: "text", text: "find a japan esim" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "search_esims", input: { query: "japan" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "[]", is_error: false }] },
      ],
    });
    const contents = (captured as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }).contents;
    const functionResponsePart = contents[2].parts[0] as { functionResponse: { id: string; name: string; response: Record<string, unknown> } };
    expect(functionResponsePart.functionResponse).toMatchObject({ id: "call-1", name: "search_esims", response: { output: "[]" } });
  });

  it("marks an error tool_result distinctly in the function response", async () => {
    let captured: unknown;
    const driver = driverWithFakeClient(async (params) => {
      captured = params;
      return fakeResponse([{ text: "ok" }]);
    });
    await driver.nextStep({
      ...BASE_PARAMS,
      transcript: [
        { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "get_product_details", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "not found", is_error: true }] },
      ],
    });
    const contents = (captured as { contents: Array<{ parts: Array<Record<string, unknown>> }> }).contents;
    const functionResponsePart = contents[1].parts[0] as { functionResponse: { response: Record<string, unknown> } };
    expect(functionResponsePart.functionResponse.response).toEqual({ error: "not found" });
  });

  it("passes the tool specs through as parametersJsonSchema unchanged", async () => {
    let captured: unknown;
    const driver = driverWithFakeClient(async (params) => {
      captured = params;
      return fakeResponse([{ text: "ok" }]);
    });
    await driver.nextStep(BASE_PARAMS);
    const config = (captured as { config: { tools: Array<{ functionDeclarations: Array<Record<string, unknown>> }> } }).config;
    expect(config.tools[0].functionDeclarations[0]).toMatchObject({
      name: "ping",
      description: "ping",
      parametersJsonSchema: { type: "object", properties: {} },
    });
  });
});

function fakeResponse(parts: Array<Record<string, unknown>>, finishReason?: string) {
  return { candidates: [{ content: { role: "model", parts }, finishReason }] } as unknown as Awaited<
    ReturnType<GeminiClientLike["models"]["generateContent"]>
  >;
}
