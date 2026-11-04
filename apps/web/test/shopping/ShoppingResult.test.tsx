import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ShoppingRequestResponse } from "@obscura/contracts";
import { ShoppingResult } from "../../src/features/shopping/ShoppingResult";

const safeOrder = {
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
  status: "reserved" as const,
  proposedAt: "2026-11-04T12:00:00.000Z",
};

describe("ShoppingResult - authorized", () => {
  it("shows the verified price and guardian decision, and never claims payment/delivery", () => {
    const result: ShoppingRequestResponse = { status: "authorized", order: safeOrder };
    render(<ShoppingResult result={result} />);

    expect(screen.getByText("Authorized")).toBeInTheDocument();
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.getByText(/Authorization is not payment/i)).toBeInTheDocument();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/payment (complete|successful|confirmed)/i);
    expect(bodyText).not.toMatch(/\bdelivered\b/i);
    expect(bodyText).not.toMatch(/\bconfirmed\b/i); // order.status is "reserved", not "confirmed" - must not appear as a claim
  });
});

describe("ShoppingResult - rejected", () => {
  it("shows the real rejection code and reason, and clarifies no budget was reserved", () => {
    const result: ShoppingRequestResponse = {
      status: "rejected",
      order: safeOrder,
      rejection: { code: "BUDGET_EXCEEDED", reason: "Order exceeds remaining budget" },
    };
    render(<ShoppingResult result={result} />);

    expect(screen.getByText("BUDGET_EXCEEDED")).toBeInTheDocument();
    expect(screen.getByText("Order exceeds remaining budget")).toBeInTheDocument();
    expect(screen.getByText(/full remaining budget is still available/i)).toBeInTheDocument();
  });
});

describe("ShoppingResult - malformed_proposal", () => {
  it("shows the real reason and states no budget was touched, without any order fields", () => {
    const result: ShoppingRequestResponse = { status: "malformed_proposal", reason: "merchantProductId is required" };
    render(<ShoppingResult result={result} />);
    expect(screen.getByText("merchantProductId is required")).toBeInTheDocument();
    expect(screen.getByText(/no budget was touched/i)).toBeInTheDocument();
  });
});

describe("ShoppingResult - product_not_verified", () => {
  it("shows the exact merchantProductId that could not be verified", () => {
    const result: ShoppingRequestResponse = { status: "product_not_verified", merchantProductId: "bitrefill-esim-japan::does-not-exist" };
    render(<ShoppingResult result={result} />);
    expect(screen.getByText("bitrefill-esim-japan::does-not-exist")).toBeInTheDocument();
  });
});

describe("ShoppingResult - no_proposal", () => {
  it("shows the agent's real reason for producing nothing", () => {
    const result: ShoppingRequestResponse = { status: "no_proposal", reason: "No suitable product found." };
    render(<ShoppingResult result={result} />);
    expect(screen.getByText("No suitable product found.")).toBeInTheDocument();
  });
});
