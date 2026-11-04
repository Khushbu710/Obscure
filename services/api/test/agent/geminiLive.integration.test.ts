import { describe, expect, it } from "vitest";
import { GeminiLlmDriver } from "../../src/agent/geminiDriver.js";

/**
 * REAL, LIVE Gemini API integration test. Only runs if GEMINI_API_KEY is
 * set - no credentials were available when this driver was built. A green
 * run of the rest of the suite is NOT evidence this ran or passed.
 */
const apiKey = process.env.GEMINI_API_KEY;

describe.skipIf(!apiKey)("Gemini live driver (requires GEMINI_API_KEY)", () => {
  it("gets a real tool_use or final_text step back from the live API", async () => {
    const driver = new GeminiLlmDriver(apiKey!);
    const step = await driver.nextStep({
      systemPrompt: "You are a test assistant. Call the ping tool.",
      tools: [{ name: "ping", description: "Replies with pong", inputSchema: { type: "object", properties: {} } }],
      transcript: [{ role: "user", content: [{ type: "text", text: "call ping" }] }],
    });
    expect(["tool_use", "final_text"]).toContain(step.kind);
  });
});
