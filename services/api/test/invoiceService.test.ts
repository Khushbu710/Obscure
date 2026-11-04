import { describe, expect, it, vi } from "vitest";
import { BitrefillClient } from "@obscura/bitrefill-client";
import type { DatabaseSync } from "node:sqlite";
import type { Order } from "@obscura/contracts";
import { InvoiceService, OrderNotAuthorizedForInvoiceError, OrderNotFoundForInvoiceError } from "../src/bitrefill/invoiceService.js";
import { OrderRepository } from "../src/repositories/orderRepository.js";
import { MandateRepository } from "../src/repositories/mandateRepository.js";
import { createTestDb } from "./testDb.js";

/** orders.mandate_id is a real foreign key (schema.sql) - every test order needs a parent mandate row. */
function insertParentMandate(db: DatabaseSync, mandateId: string): void {
  new MandateRepository(db).insert({
    id: mandateId,
    userId: "user-1",
    status: "active",
    allowedCategories: ["esim"],
    allowedMerchants: null,
    allowedProductIds: null,
    totalCapMinor: 10_000,
    perOrderCapMinor: null,
    spentMinor: 0,
    currency: "USD",
    envelopeWalletRef: null,
    receivingAddress: null,
    fundedAt: null,
    fundingTxId: null,
    createdAt: "2026-11-04T10:00:00.000Z",
    expiresAt: "2026-11-05T10:00:00.000Z",
    revokedAt: null,
    schemaVersion: 1,
  });
}

const INVOICE_RESPONSE = {
  data: {
    id: "inv_123",
    status: "not_delivered",
    payment: { method: "balance", currency: "USD", price: 12.5, status: "unpaid" },
    orders: [{ id: "ord_1", status: "created", product: { id: "bitrefill-esim-japan", name: "Japan eSIM", value: "5GB, 30 Days", currency: "USD" } }],
  },
};

function order(overrides: Partial<Order> = {}): Order {
  return {
    orderId: "22222222-2222-2222-2222-222222222222",
    mandateId: "11111111-1111-1111-1111-111111111111",
    product: {
      merchantProductId: "bitrefill-esim-japan::5GB, 30 Days",
      name: "Japan eSIM (5GB, 30 Days)",
      priceMinor: 1250,
      currency: "USD",
      category: "esim",
      merchantId: "bitrefill",
    },
    priceMinor: 1250,
    nonce: "a".repeat(32),
    status: "reserved",
    proposedAt: "2026-11-04T12:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function buildClient(onRequest?: (url: string, body: unknown) => void) {
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    onRequest?.(String(url), init?.body ? JSON.parse(String(init.body)) : undefined);
    return jsonResponse(INVOICE_RESPONSE);
  }) as unknown as typeof fetch;
  return new BitrefillClient({ apiKey: "test-key", fetchImpl });
}

describe("InvoiceService - re-fetches the canonical persisted order, never trusts a caller-supplied object", () => {
  it("creates an invoice using the PERSISTED order's productId/value, looked up only by orderId", async () => {
    let capturedBody: unknown;
    const client = buildClient((_url, body) => (capturedBody = body));
    const db = createTestDb();
    insertParentMandate(db, order().mandateId);
    const orders = new OrderRepository(db);
    orders.insert(order());

    const service = new InvoiceService(client, orders);
    const invoice = await service.createInvoiceForOrder(order().orderId);

    expect(capturedBody).toMatchObject({
      products: [{ product_id: "bitrefill-esim-japan", value: "5GB, 30 Days", quantity: 1 }],
      auto_pay: false,
    });
    expect(invoice.id).toBe("inv_123");
  });

  it("SECURITY: ignores a tampered in-memory Order entirely, since the method only accepts an orderId", async () => {
    // This test documents the fix for the re-audit finding: there is no
    // longer a code path to pass a different product/price than what is
    // actually persisted - createInvoiceForOrder's signature doesn't even
    // accept an Order object anymore, only an id. We prove it by inserting
    // the REAL order, then confirming the invoice created reflects ONLY the
    // persisted product - an attacker-controlled in-memory object (e.g.
    // `order({ product: { merchantProductId: 'attacker-product::1', priceMinor: 1, ... } })`)
    // is simply not representable as an input to this method at all.
    let capturedBody: unknown;
    const client = buildClient((_url, body) => (capturedBody = body));
    const db = createTestDb();
    insertParentMandate(db, order().mandateId);
    const orders = new OrderRepository(db);
    const realOrder = order({ orderId: "33333333-3333-3333-3333-333333333333" });
    orders.insert(realOrder);

    const service = new InvoiceService(client, orders);
    await service.createInvoiceForOrder(realOrder.orderId);

    expect(capturedBody).toMatchObject({ products: [{ product_id: "bitrefill-esim-japan", value: "5GB, 30 Days" }] });
  });

  it("throws OrderNotFoundForInvoiceError for an unknown orderId, without calling Bitrefill", async () => {
    const requestSpy = vi.fn();
    const client = buildClient(requestSpy);
    const orders = new OrderRepository(createTestDb());

    const service = new InvoiceService(client, orders);
    await expect(service.createInvoiceForOrder("00000000-0000-0000-0000-000000000000")).rejects.toThrow(OrderNotFoundForInvoiceError);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("throws OrderNotAuthorizedForInvoiceError for an order that was never authorized (status 'rejected'), without calling Bitrefill", async () => {
    const requestSpy = vi.fn();
    const client = buildClient(requestSpy);
    const db = createTestDb();
    insertParentMandate(db, order().mandateId);
    const orders = new OrderRepository(db);
    orders.insert(order({ status: "rejected" }));

    const service = new InvoiceService(client, orders);
    await expect(service.createInvoiceForOrder(order().orderId)).rejects.toThrow(OrderNotAuthorizedForInvoiceError);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("throws OrderNotAuthorizedForInvoiceError for a merely-'proposed' order (not yet guardian-approved)", async () => {
    const requestSpy = vi.fn();
    const client = buildClient(requestSpy);
    const db = createTestDb();
    insertParentMandate(db, order().mandateId);
    const orders = new OrderRepository(db);
    orders.insert(order({ status: "proposed" }));

    const service = new InvoiceService(client, orders);
    await expect(service.createInvoiceForOrder(order().orderId)).rejects.toThrow(OrderNotAuthorizedForInvoiceError);
    expect(requestSpy).not.toHaveBeenCalled();
  });
});

describe("InvoiceService.reconcileInvoice", () => {
  it("only reads - it never calls invoice creation, and is safe to call repeatedly", async () => {
    const createSpy = vi.fn();
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/esims")) createSpy();
      return jsonResponse(INVOICE_RESPONSE);
    }) as unknown as typeof fetch;
    const client = new BitrefillClient({ apiKey: "test-key", fetchImpl });
    const service = new InvoiceService(client, new OrderRepository(createTestDb()));

    await service.reconcileInvoice("inv_123");
    await service.reconcileInvoice("inv_123");

    expect(createSpy).not.toHaveBeenCalled();
  });
});
