import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import type { Content, GenerateContentResponse, Part } from "@google/genai";
import type { AgentContentBlock, AgentLlmDriver, AgentMessage, AgentStepResult, AgentToolSpec } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 1024;
/** A Google-maintained alias that always points at their current fast model - see https://ai.google.dev/gemini-api/docs/models. Good fit for an agent loop: low latency, supports function calling. */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

/**
 * Thrown for any failure talking to the real Gemini API (network error,
 * timeout, non-2xx response, SDK-level error) - never a raw SDK exception,
 * and never includes the API key (the SDK's own error messages don't embed
 * it, and we don't add anything that would).
 */
export class AgentDriverError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AgentDriverError";
  }
}

/** Minimal surface of GoogleGenAI this driver actually calls - lets tests inject a fake without constructing a real client. */
export interface GeminiClientLike {
  models: {
    generateContent(params: unknown): Promise<GenerateContentResponse>;
  };
}

/**
 * PRODUCTION driver wrapping the real Gemini `generateContent` API with
 * function calling (replaces the former Anthropic-based driver - same
 * AgentLlmDriver contract, same tool list, same orchestration loop in
 * orchestrator.ts, unchanged).
 *
 * STATUS: implemented but NOT live-verified - no GEMINI_API_KEY was
 * available in this environment (same situation as the Bitrefill client
 * before it had real credentials - see verification-matrix.md). Do not
 * treat a passing test suite as evidence this driver works against the
 * real API; only test/agent/geminiLive.integration.test.ts (skipped
 * without a key) would prove that, and it has not run.
 */
export class GeminiLlmDriver implements AgentLlmDriver {
  private readonly client: GeminiClientLike;

  constructor(
    apiKey: string,
    private readonly model: string = DEFAULT_GEMINI_MODEL,
    private readonly maxTokens: number = DEFAULT_MAX_TOKENS,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    /** Test-only injection point - never used in production wiring. */
    injectedClient?: GeminiClientLike,
  ) {
    // The SDK's own httpOptions.timeout bounds the HTTP call itself - this is
    // in addition to, not instead of, AgentOrchestrator's own per-step
    // timeout (defense in depth: the orchestrator's bound holds even if a
    // future driver forgets to set one).
    this.client = injectedClient ?? new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
  }

  async nextStep(params: { systemPrompt: string; tools: AgentToolSpec[]; transcript: AgentMessage[] }): Promise<AgentStepResult> {
    let response: GenerateContentResponse;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: toGeminiContents(params.transcript),
        config: {
          systemInstruction: params.systemPrompt,
          maxOutputTokens: this.maxTokens,
          tools: [
            {
              functionDeclarations: params.tools.map((t) => ({
                name: t.name,
                description: t.description,
                // The tool specs are already plain JSON Schema (see tools.ts) -
                // parametersJsonSchema accepts that directly, no translation needed.
                parametersJsonSchema: t.inputSchema,
              })),
            },
          ],
        },
      });
    } catch (err) {
      // Never let a raw SDK/network exception escape - fail closed with a
      // typed, auditable error instead of an unhandled technical failure.
      const message = err instanceof Error ? err.message : String(err);
      throw new AgentDriverError(`Gemini API call failed: ${message}`, err);
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const functionCallParts = parts.filter((p): p is Part & { functionCall: NonNullable<Part["functionCall"]> } => p.functionCall != null);

    if (functionCallParts.length > 1) {
      // Parallel tool calls are not supported by this orchestration loop
      // (it expects exactly one function call per turn, matched by one
      // function response before the next turn). Rather than silently
      // picking one and dropping the other(s) - which could silently drop a
      // propose_purchase call, or silently drop a safety-relevant tool
      // call - fail closed and loudly.
      throw new AgentDriverError(
        `Model returned ${functionCallParts.length} function calls in one turn; this orchestrator only supports one tool call per turn.`,
      );
    }

    if (functionCallParts.length === 1) {
      const call = functionCallParts[0].functionCall;
      if (!call.name) {
        throw new AgentDriverError("Gemini returned a function call with no name.");
      }
      // Gemini populates `id` when there could be multiple calls to correlate;
      // for a single call it may be absent - mint one so the orchestrator
      // always has a stable correlator to echo back in the function response.
      return { kind: "tool_use", id: call.id ?? randomUUID(), name: call.name, input: call.args ?? {} };
    }

    if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") {
      // The response was truncated - treat as no usable output rather than
      // risk acting on a partial/malformed text block.
      throw new AgentDriverError("Gemini response was truncated (finishReason: MAX_TOKENS) before completion.");
    }

    const textPart = parts.find((p) => typeof p.text === "string");
    return { kind: "final_text", text: textPart?.text ?? "" };
  }
}

/**
 * Translates the provider-agnostic AgentMessage[] transcript (orchestrator.ts)
 * into Gemini's Content[] wire format. A tool_result block only carries the
 * id it responds to (tool_use_id, inherited from the Anthropic-shaped
 * AgentContentBlock type - see types.ts) - Gemini's FunctionResponse also
 * requires the function `name`, so this tracks id->name from each
 * immediately-preceding tool_use block as it walks the transcript in order
 * (orchestrator.ts always pushes a tool_use message directly followed by its
 * tool_result message, so the name is always seen first).
 */
function toGeminiContents(transcript: AgentMessage[]): Content[] {
  const toolNameById = new Map<string, string>();
  return transcript.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: message.content.map((block) => blockToPart(block, toolNameById)),
  }));
}

function blockToPart(block: AgentContentBlock, toolNameById: Map<string, string>): Part {
  if (block.type === "text") {
    return { text: block.text };
  }
  if (block.type === "tool_use") {
    toolNameById.set(block.id, block.name);
    return { functionCall: { id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> } };
  }
  // tool_result
  const name = toolNameById.get(block.tool_use_id);
  if (!name) {
    throw new AgentDriverError(`No matching tool_use found for tool_result id "${block.tool_use_id}" - transcript is malformed.`);
  }
  return {
    functionResponse: {
      id: block.tool_use_id,
      name,
      response: block.is_error ? { error: block.content } : { output: block.content },
    },
  };
}
