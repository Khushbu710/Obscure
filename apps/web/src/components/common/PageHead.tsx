import type { ReactNode } from "react";

const pageCode: Record<string, string> = {
  Overview: "01",
  Shopping: "02",
  "Spending mandates": "03",
  "Shielded wallet": "04",
  Activity: "05",
  "Private receipts": "06",
  Security: "07",
  Settings: "08",
};

export function PageHead({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      <div className="page-head-actions">
        <span className="page-coordinate">
          <small>OB /</small> {pageCode[title] ?? "00"}
        </span>
        {action}
      </div>
    </div>
  );
}
