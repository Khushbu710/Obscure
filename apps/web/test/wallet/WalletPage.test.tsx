import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WalletPage } from "../../src/features/wallet/WalletPage";

describe("WalletPage - honest unavailable state", () => {
  it("never shows a fabricated balance, address, or transaction ID", () => {
    render(<WalletPage />);

    expect(screen.getByText("Zcash wallet integration not connected")).toBeInTheDocument();

    const bodyText = document.body.textContent ?? "";
    // No fake ZEC balance, no fake u1... shielded address, no fake txid pattern anywhere.
    expect(bodyText).not.toMatch(/\d+\.\d{4}\s*ZEC/); // e.g. "12.4821 ZEC" from the original mockup
    expect(bodyText).not.toMatch(/u1[a-z0-9]{6,}/i); // fabricated shielded address pattern
    expect(screen.getByText("Not available")).toBeInTheDocument();
  });

  it("clearly states the adapter is not connected, not merely empty", () => {
    render(<WalletPage />);
    expect(screen.getByText(/no `\/fund` or `\/envelope` backend endpoint exists/i)).toBeInTheDocument();
  });
});
