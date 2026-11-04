import type { FastifyInstance } from "fastify";
import { apiError } from "@obscura/contracts";
import type { OrderRepository } from "../../repositories/orderRepository.js";
import type { PaymentService } from "../../payment/paymentService.js";
import { sendError } from "../errors.js";

/**
 * GET /api/orders/:id (api-contracts.md). Each call also advances an
 * in-flight payment by one chain observation, so the frontend can simply poll
 * this endpoint. The nonce is never returned.
 */
export function registerOrderRoutes(app: FastifyInstance, orders: OrderRepository, payments: PaymentService | null): void {
  app.get<{ Params: { id: string } }>("/api/orders/:id", async (request, reply) => {
    try {
      if (payments) await payments.refresh(request.params.id);
      const order = orders.getById(request.params.id);
      if (!order) {
        reply.code(404).send(apiError("ORDER_NOT_FOUND", `Order ${request.params.id} not found`));
        return;
      }
      const { nonce: _nonce, ...safe } = order;
      reply.send({ order: safe, payment: payments?.view(order.orderId) ?? null });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
