import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ActivityPage } from "../../src/features/activity/ActivityPage";

vi.mock("../../src/lib/api/client", () => ({
  api: {
    mandates: { list: vi.fn().mockResolvedValue([]) },
    orders: { list: vi.fn(), get: vi.fn() },
  },
}));

import { api } from "../../src/lib/api/client";

const SAFE_ORDER = {
  orderId: "22222222-2222-2222-2222-222222222222",
  mandateId: "11111111-1111-1111-1111-111111111111",
  product: { merchantProductId: "p1", name: "Japan eSIM", priceMinor: 1250, currency: "USD", category: "esim", merchantId: "bitrefill" },
  priceMinor: 1250,
  status: "reserved" as const,
  proposedAt: "2026-11-04T12:00:00.000Z",
};

describe("ActivityPage - order list", () => {
  it("renders real orders from the backend, never fabricated rows", async () => {
    vi.mocked(api.orders.list).mockResolvedValue([{ order: SAFE_ORDER, payment: null }]);
    render(<ActivityPage />);

    await waitFor(() => expect(screen.getByText("Japan eSIM")).toBeInTheDocument());
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.getByText("reserved")).toBeInTheDocument();
  });

  it("shows an honest empty state with no orders, not fabricated activity", async () => {
    vi.mocked(api.orders.list).mockResolvedValue([]);
    render(<ActivityPage />);
    await waitFor(() => expect(screen.getByText(/no orders yet/i)).toBeInTheDocument());
  });

  it("clearly flags payment_uncertain without offering a retry", async () => {
    const uncertainOrder = { ...SAFE_ORDER, status: "payment_uncertain" as const };
    vi.mocked(api.orders.list).mockResolvedValue([
      { order: uncertainOrder, payment: { orderId: uncertainOrder.orderId, status: "payment_uncertain" as const, settlementMode: "simulated" as const, merchantInvoiceRef: "inv1", txId: "abc123", amountZatoshi: 500_000, simulatedDelivery: null } },
    ]);
    vi.mocked(api.orders.get).mockResolvedValue({
      order: uncertainOrder,
      payment: { orderId: uncertainOrder.orderId, status: "payment_uncertain", settlementMode: "simulated", merchantInvoiceRef: "inv1", txId: "abc123", amountZatoshi: 500_000, simulatedDelivery: null },
    });
    render(<ActivityPage />);

    await waitFor(() => expect(screen.getByText("payment_uncertain")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Japan eSIM"));

    await waitFor(() => expect(screen.getByText(/payment outcome uncertain/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getByText(/will not be automatically retried/i)).toBeInTheDocument();
  });
});
