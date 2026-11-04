import type { DatabaseSync } from "node:sqlite";
import type { Order, OrderStatus, Product } from "@obscura/contracts";

interface OrderRow {
  order_id: string;
  mandate_id: string;
  product_json: string;
  price_minor: number;
  nonce: string;
  status: OrderStatus;
  proposed_at: string;
  agent_reasoning: string | null;
}

function rowToOrder(row: OrderRow): Order {
  const product: Product = JSON.parse(row.product_json);
  return {
    orderId: row.order_id,
    mandateId: row.mandate_id,
    product,
    priceMinor: row.price_minor,
    nonce: row.nonce,
    status: row.status,
    proposedAt: row.proposed_at,
    agentReasoning: row.agent_reasoning ?? undefined,
  };
}

export class OrderRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(order: Order): void {
    this.db
      .prepare(
        `INSERT INTO orders (order_id, mandate_id, product_json, price_minor, nonce, status, proposed_at, agent_reasoning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        order.orderId,
        order.mandateId,
        JSON.stringify(order.product),
        order.priceMinor,
        order.nonce,
        order.status,
        order.proposedAt,
        order.agentReasoning ?? null,
      );
  }

  getById(orderId: string): Order | null {
    const row = this.db.prepare("SELECT * FROM orders WHERE order_id = ?").get(orderId) as OrderRow | undefined;
    return row ? rowToOrder(row) : null;
  }

  setStatus(orderId: string, status: OrderStatus): void {
    this.db.prepare("UPDATE orders SET status = ? WHERE order_id = ?").run(status, orderId);
  }

  listByMandate(mandateId: string): Order[] {
    const rows = this.db
      .prepare("SELECT * FROM orders WHERE mandate_id = ? ORDER BY proposed_at DESC")
      .all(mandateId) as unknown as OrderRow[];
    return rows.map(rowToOrder);
  }
}
