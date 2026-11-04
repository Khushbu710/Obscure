/**
 * Minimal, Anthropic-tool-use-shaped types for the agent orchestration
 * loop. Kept close to the real Messages API shape (content blocks of type
 * text / tool_use / tool_result) so the production driver
 * (anthropicDriver.ts) is a thin adapter, not a translation layer - see
 * docs/architecture/component-architecture.md module 5.
 */

export interface AgentToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's input, passed to the LLM provider as-is. */
  inputSchema: Record<string, unknown>;
}

export type AgentContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AgentMessage {
  role: "user" | "assistant";
  content: AgentContentBlock[];
}

export type AgentStepResult =
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "final_text"; text: string };

/**
 * Pluggable so tests never need live LLM credentials - see
 * test/agent/fakeDriver.ts for the scripted test double and
 * anthropicDriver.ts for the real (currently live-unverified) production
 * implementation.
 */
export interface AgentLlmDriver {
  nextStep(params: { systemPrompt: string; tools: AgentToolSpec[]; transcript: AgentMessage[] }): Promise<AgentStepResult>;
}
