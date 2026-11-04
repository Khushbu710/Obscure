import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CreateMandateModal } from "../../src/features/mandates/CreateMandateModal";

vi.mock("../../src/lib/api/client", () => ({
  api: { mandates: { create: vi.fn() } },
}));

import { api } from "../../src/lib/api/client";

function continueButton() {
  return screen.getByRole("button", { name: /continue/i });
}

describe("CreateMandateModal - step 1 (limits) validation", () => {
  it("blocks continuing with an empty/non-numeric total budget", () => {
    render(<CreateMandateModal onClose={vi.fn()} onCreated={vi.fn()} />);
    const budgetInput = screen.getByLabelText(/total budget/i);
    fireEvent.change(budgetInput, { target: { value: "" } });
    expect(continueButton()).toBeDisabled();
    expect(screen.getByText(/enter a total budget greater than zero/i)).toBeInTheDocument();
  });

  it("blocks continuing when the per-order cap exceeds the total budget", () => {
    render(<CreateMandateModal onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/total budget/i), { target: { value: "10.00" } });
    fireEvent.change(screen.getByLabelText(/per-order cap/i), { target: { value: "50.00" } });
    expect(continueButton()).toBeDisabled();
    expect(screen.getByText(/per-order cap cannot exceed the total budget/i)).toBeInTheDocument();
  });

  it("allows continuing with valid limits", () => {
    render(<CreateMandateModal onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/total budget/i), { target: { value: "200.00" } });
    fireEvent.change(screen.getByLabelText(/per-order cap/i), { target: { value: "30.00" } });
    expect(continueButton()).not.toBeDisabled();
  });
});

describe("CreateMandateModal - step 3 (duration) validation", () => {
  function advanceToStep3() {
    fireEvent.click(continueButton()); // step 1 -> 2
    fireEvent.click(continueButton()); // step 2 -> 3
  }

  it("blocks continuing with an expiration date in the past", () => {
    render(<CreateMandateModal onClose={vi.fn()} onCreated={vi.fn()} />);
    advanceToStep3();
    const expiryInput = screen.getByLabelText(/expires at/i);
    fireEvent.change(expiryInput, { target: { value: "2020-01-01T00:00" } });
    expect(continueButton()).toBeDisabled();
    expect(screen.getByText(/choose an expiration date and time in the future/i)).toBeInTheDocument();
  });
});

describe("CreateMandateModal - submission", () => {
  it("sends only real CreateMandateRequestSchema fields, never a fabricated name/description", async () => {
    const createMock = vi.mocked(api.mandates.create);
    createMock.mockResolvedValue({
      id: "m1",
      userId: "demo-user",
      status: "active",
      allowedCategories: ["esim"],
      allowedMerchants: null,
      allowedProductIds: null,
      totalCapMinor: 20000,
      perOrderCapMinor: 3000,
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

    render(<CreateMandateModal onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/total budget/i), { target: { value: "200.00" } });
    fireEvent.click(continueButton()); // -> step 2
    fireEvent.click(continueButton()); // -> step 3
    fireEvent.click(continueButton()); // -> step 4 (review)
    fireEvent.click(screen.getByRole("button", { name: /create mandate/i }));

    await screen.findByText(/mandate identifier/i);

    const sentBody = createMock.mock.calls[0][0];
    expect(Object.keys(sentBody).sort()).toEqual(
      ["allowedCategories", "allowedMerchants", "currency", "durationHours", "perOrderCapMinor", "totalCapMinor"].sort(),
    );
    expect(sentBody.totalCapMinor).toBe(20000);
  });
});
