import type { ProductDiscoveryService } from "../bitrefill/productDiscoveryService.js";
import type { AgentToolSpec } from "./types.js";

/**
 * The COMPLETE, fixed set of tools the AI agent may ever call. This is the
 * only function in the codebase that is allowed to decide what the agent
 * can do - nothing else constructs an agent tool list. It takes a
 * ProductDiscoveryService (read-only Bitrefill discovery) and NOTHING else:
 * it has no way to reach InvoiceService, OrderAuthorizationService's
 * internals, the signer, or any wallet/network primitive, because those
 * are simply never passed in. See security-architecture.md principle 2 and
 * bitrefill-integration.md §2.
 *
 * `propose_purchase` is the loop-terminating tool: calling it ends the
 * agent's turn and hands a structured proposal to orchestrator.ts for
 * independent verification and guardian/authorization - it does not itself
 * perform any purchase.
 */
export const AGENT_TOOL_NAMES = ["search_esims", "list_esims", "get_product_details", "propose_purchase"] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export function buildAgentTools(discovery: ProductDiscoveryService): {
  specs: AgentToolSpec[];
  /** Dispatch for the three read-only discovery tools only - propose_purchase is handled by the orchestrator itself. */
  invokeDiscoveryTool(name: string, input: unknown): Promise<unknown>;
} {
  const specs: AgentToolSpec[] = [
    {
      name: "search_esims",
      description: "Search Bitrefill's eSIM catalog by keyword (e.g. a country or region name).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          country: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
    {
      name: "list_esims",
      description: "List available Bitrefill eSIM products, optionally filtered by country.",
      inputSchema: {
        type: "object",
        properties: {
          country: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "get_product_details",
      description: "Get full package/denomination and pricing details for a specific Bitrefill eSIM product.",
      inputSchema: {
        type: "object",
        properties: { productId: { type: "string" } },
        required: ["productId"],
      },
    },
    {
      name: "propose_purchase",
      description:
        "Propose exactly one eSIM package for purchase, identified only by merchantProductId from a prior search/detail result. Do not state a price - it is independently verified by the backend.",
      inputSchema: {
        type: "object",
        properties: {
          merchantProductId: { type: "string" },
          agentReasoning: { type: "string" },
        },
        required: ["merchantProductId"],
      },
    },
  ];

  async function invokeDiscoveryTool(name: string, input: unknown): Promise<unknown> {
    const args = (input ?? {}) as Record<string, unknown>;
    switch (name) {
      case "search_esims":
        return discovery.searchEsims(String(args.query ?? ""), {
          country: typeof args.country === "string" ? args.country : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });
      case "list_esims":
        return discovery.listEsims({
          country: typeof args.country === "string" ? args.country : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });
      case "get_product_details":
        return discovery.getProductDetails(String(args.productId ?? ""));
      default:
        // Defense in depth: this function is only ever called by the
        // orchestrator for names it has already checked against
        // AGENT_TOOL_NAMES, but never silently no-op on an unexpected name.
        throw new Error(`invokeDiscoveryTool called with an unregistered tool name: ${name}`);
    }
  }

  return { specs, invokeDiscoveryTool };
}
