import { z } from "zod";
import { ISODateStringSchema } from "./common.js";

export const AgentEventTypeSchema = z.enum(["search", "compare", "propose", "guardian_result"]);
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

export const AgentEventSchema = z.object({
  eventId: z.string().uuid(),
  requestId: z.string().uuid(),
  type: AgentEventTypeSchema,
  payload: z.record(z.unknown()),
  timestamp: ISODateStringSchema,
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;
