import type { AgentLlmDriver, AgentMessage, AgentStepResult, AgentToolSpec } from "../../src/agent/types.js";

/**
 * A scripted test double for AgentLlmDriver - no network, no real LLM,
 * fully deterministic. Accepts either a fixed queue of steps, or a
 * function of the current transcript (for tests that need the "agent" to
 * react to a prior tool result, e.g. a prompt-injection scenario).
 */
export class FakeLlmDriver implements AgentLlmDriver {
  private callCount = 0;

  constructor(
    private readonly script:
      | AgentStepResult[]
      | ((params: { transcript: AgentMessage[]; tools: AgentToolSpec[]; callIndex: number }) => AgentStepResult),
  ) {}

  async nextStep(params: { systemPrompt: string; tools: AgentToolSpec[]; transcript: AgentMessage[] }): Promise<AgentStepResult> {
    const callIndex = this.callCount++;
    if (Array.isArray(this.script)) {
      const step = this.script[callIndex];
      if (!step) throw new Error(`FakeLlmDriver script exhausted at call ${callIndex}`);
      return step;
    }
    return this.script({ transcript: params.transcript, tools: params.tools, callIndex });
  }
}

export function toolUseStep(id: string, name: string, input: unknown): AgentStepResult {
  return { kind: "tool_use", id, name, input };
}

export function finalTextStep(text: string): AgentStepResult {
  return { kind: "final_text", text };
}
