import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ReceiptsPage } from "../../src/features/receipts/ReceiptsPage";

vi.mock("../../src/lib/api/client", () => ({
  api: {
    receipts: { list: vi.fn(), get: vi.fn(), disclose: vi.fn(), publicKey: vi.fn() },
  },
}));

import { api } from "../../src/lib/api/client";

const METADATA = { receiptId: "33333333-3333-3333-3333-333333333333", orderId: "22222222-2222-2222-2222-222222222222", commitment: "a".repeat(64), createdAt: "2026-11-04T12:00:00.000Z" };

describe("ReceiptsPage", () => {
  it("renders real receipt metadata and never claims a zero-knowledge proof", async () => {
    vi.mocked(api.receipts.list).mockResolvedValue([METADATA]);
    vi.mocked(api.receipts.publicKey).mockResolvedValue({ algorithm: "Ed25519", format: "SPKI-DER-base64", publicKey: "a".repeat(44), persistentKeys: true });
    render(<ReceiptsPage />);

    await waitFor(() => expect(screen.getByText("22222222")).toBeInTheDocument());
    const bodyText = document.body.textContent ?? "";
    expect(bodyText.toLowerCase()).toContain("not a zero-knowledge proof");
  });

  it("shows an honest empty state with no receipts", async () => {
    vi.mocked(api.receipts.list).mockResolvedValue([]);
    vi.mocked(api.receipts.publicKey).mockResolvedValue({ algorithm: "Ed25519", format: "SPKI-DER-base64", publicKey: "a".repeat(44), persistentKeys: true });
    render(<ReceiptsPage />);
    await waitFor(() => expect(screen.getByText(/no receipts yet/i)).toBeInTheDocument());
  });

  it("shows real signature-validity and allows generating a real disclosure artifact", async () => {
    vi.mocked(api.receipts.list).mockResolvedValue([METADATA]);
    vi.mocked(api.receipts.publicKey).mockResolvedValue({ algorithm: "Ed25519", format: "SPKI-DER-base64", publicKey: "a".repeat(44), persistentKeys: true });
    vi.mocked(api.receipts.get).mockResolvedValue({
      receipt: { receiptId: METADATA.receiptId, orderId: METADATA.orderId, commitment: METADATA.commitment, signature: "sig", createdAt: METADATA.createdAt },
      payload: { orderId: METADATA.orderId, priceMinor: 1250, currency: "USD", merchantId: "bitrefill", timestamp: METADATA.createdAt, settlementMode: "simulated", salt: "s" },
      signatureValid: true,
    });
    vi.mocked(api.receipts.disclose).mockResolvedValue({
      commitment: METADATA.commitment,
      signature: "sig",
      disclosedFields: { orderId: METADATA.orderId, priceMinor: 1250, currency: "USD", merchantId: "bitrefill", timestamp: METADATA.createdAt, settlementMode: "simulated", salt: "s" },
    });

    render(<ReceiptsPage />);
    await waitFor(() => expect(screen.getByText("22222222")).toBeInTheDocument());
    fireEvent.click(screen.getByText("22222222").closest("button")!);

    await waitFor(() => expect(screen.getByText(/signature valid/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /create disclosure/i }));
    await waitFor(() => expect(api.receipts.disclose).toHaveBeenCalledWith(METADATA.receiptId));
  });
});
