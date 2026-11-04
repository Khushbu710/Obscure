import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WalletPage } from "../../src/features/wallet/WalletPage";

vi.mock("../../src/lib/api/client", () => ({
  api: {
    mandates: { list: vi.fn() },
    wallet: { fund: vi.fn(), envelope: vi.fn(), sweep: vi.fn() },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import { api } from "../../src/lib/api/client";

const BASE_MANDATE = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "demo-user",
  status: "active" as const,
  allowedCategories: ["esim"],
  allowedMerchants: null,
  allowedProductIds: null,
  totalCapMinor: 1500,
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
};

function renderWallet() {
  return render(
    <MemoryRouter>
      <WalletPage />
    </MemoryRouter>,
  );
}

describe("WalletPage - not yet funded", () => {
  it("never fabricates a balance or address - offers to create an envelope instead", async () => {
    vi.mocked(api.mandates.list).mockResolvedValue([BASE_MANDATE]);
    renderWallet();

    await waitFor(() => expect(screen.getByText(/no envelope wallet yet/i)).toBeInTheDocument());

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/\d+\.\d{4,8}\s*ZEC/);
    expect(bodyText).not.toMatch(/u1[a-z0-9]{6,}/i);
    expect(screen.getByRole("button", { name: /create envelope wallet/i })).toBeInTheDocument();
  });
});

describe("WalletPage - funded", () => {
  it("shows exactly the real balance and address the backend returned, nothing fabricated", async () => {
    vi.mocked(api.mandates.list).mockResolvedValue([{ ...BASE_MANDATE, envelopeWalletRef: "m-11111111", receivingAddress: "utest1realaddress" }]);
    vi.mocked(api.wallet.envelope).mockResolvedValue({
      mandateId: BASE_MANDATE.id,
      receivingAddress: "utest1realaddress",
      spendableZatoshi: 5_000_000,
      totalZatoshi: 5_000_000,
      funded: true,
      fundingTxId: null,
    });
    renderWallet();

    await waitFor(() => expect(screen.getByText("utest1realaddress")).toBeInTheDocument());
    expect(screen.getByText("0.05000000 ZEC")).toBeInTheDocument();
    expect(screen.getByText("Funded")).toBeInTheDocument();
  });

  it("disables sweep unless the mandate is revoked or expired", async () => {
    vi.mocked(api.mandates.list).mockResolvedValue([{ ...BASE_MANDATE, status: "active", envelopeWalletRef: "m-11111111", receivingAddress: "utest1realaddress" }]);
    vi.mocked(api.wallet.envelope).mockResolvedValue({
      mandateId: BASE_MANDATE.id,
      receivingAddress: "utest1realaddress",
      spendableZatoshi: 1000,
      totalZatoshi: 1000,
      funded: true,
      fundingTxId: null,
    });
    renderWallet();

    await waitFor(() => expect(screen.getByRole("button", { name: /sweep remaining balance/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /sweep remaining balance/i })).toBeDisabled();
  });
});
