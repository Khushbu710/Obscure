import { describe, expect, it } from "vitest";
import { formatMinor, formatMinorCompact } from "../../src/lib/formatters/money";

describe("formatMinor - integer minor-unit formatting", () => {
  it("formats cents as currency correctly", () => {
    expect(formatMinor(1500, "USD")).toBe("$15.00");
    expect(formatMinor(0, "USD")).toBe("$0.00");
    expect(formatMinor(99, "USD")).toBe("$0.99");
  });

  it("formats large amounts without precision loss", () => {
    expect(formatMinor(123456789, "USD")).toBe("$1,234,567.89");
  });

  it("formats negative amounts (e.g. an over-spent/negative remaining display)", () => {
    expect(formatMinor(-500, "USD")).toBe("-$5.00");
  });

  it("respects the given currency code", () => {
    expect(formatMinor(1000, "EUR")).toContain("10.00");
  });

  it("never renders 'NaN' for a non-finite amount - shows a placeholder instead", () => {
    expect(formatMinor(NaN, "USD")).toBe("—");
    expect(formatMinor(Infinity, "USD")).toBe("—");
  });
});

describe("formatMinorCompact", () => {
  it("converts minor units to a plain decimal string", () => {
    expect(formatMinorCompact(1250)).toBe("12.50");
    expect(formatMinorCompact(0)).toBe("0.00");
  });

  it("never renders 'NaN' for a non-finite amount", () => {
    expect(formatMinorCompact(NaN)).toBe("—");
  });
});
