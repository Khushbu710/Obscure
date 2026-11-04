import Anthropic from "@anthropic-ai/sdk";
import type { AgentLlmDriver, AgentMessage, AgentStepResult, AgentToolSpec } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Thrown for any failure talking to the real Anthropic API (network error,
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

/**
 * PRODUCTION driver wrapping the real Anthropic Messages API with tool use.
 *
 * STATUS: implemented but NOT live-verified - no ANTHROPIC_API_KEY was
 * available in this environment (same situation as the Bitrefill client
 * before it had real credentials - see verification-matrix.md). Do not
 * treat a passing test suite as evidence this driver works against the
 * real API; only test/agent/anthropicLive.integration.test.ts (skipped
 * without a key) would prove that, and it has not run.
 */
export class AnthropicLlmDriver implements AgentLlmDriver {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string = "claude-sonnet-4-5",
    private readonly maxTokens: number = DEFAULT_MAX_TOKENS,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    /** Test-only injection point - never used in production wiring. */
    injectedClient?: Anthropic,
  ) {
    // The SDK's own `timeout` option bounds the HTTP call itself - this is
    // in addition to, not instead of, AgentOrchestrator's own per-step
    // timeout (defense in depth: the orchestrator's bound holds even if a
    // future driver forgets to set one).
    this.client = injectedClient ?? new Anthropic({ apiKey, timeout: timeoutMs });
  }

  async nextStep(params: { systemPrompt: string; tools: AgentToolSpec[]; transcript: AgentMessage[] }): Promise<AgentStepResult> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: params.systemPrompt,
        tools: params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
        messages: params.transcript as unknown as Anthropic.MessageParam[],
      });
    } catch (err) {
      // Never let a raw SDK/network exception escape - fail closed with a
      // typed, auditable error instead of an unhandled technical failure.
      const message = err instanceof Error ? err.message : String(err);
      throw new AgentDriverError(`Anthropic API call failed: ${message}`, err);
    }

    const toolUseBlocks = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");

    if (toolUseBlocks.length > 1) {
      // Parallel tool calls are not supported by this orchestration loop
      // (it expects exactly one tool_use per turn, matched by one
      // tool_result before the next turn). Rather than silently picking
      // one and dropping the other(s) - which could silently drop a
      // propose_purchase call, or silently drop a safety-relevant tool
      // call - fail closed and loudly.
      throw new AgentDriverError(
        `Model returned ${toolUseBlocks.length} tool_use blocks in one turn; this orchestrator only supports one tool call per turn.`,
      );
    }

    if (toolUseBlocks.length === 1) {
      const block = toolUseBlocks[0];
      return { kind: "tool_use", id: block.id, name: block.name, input: block.input };
    }

    if (response.stop_reason === "max_tokens") {
      // The response was truncated - treat as no usable output rather than
      // risk acting on a partial/malformed text block.
      throw new AgentDriverError("Anthropic response was truncated (stop_reason: max_tokens) before completion.");
    }

    const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
    return { kind: "final_text", text: textBlock?.text ?? "" };
  }
}
