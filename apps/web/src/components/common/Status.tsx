import type { ReactNode } from "react";

export function Status({ children, tone = "green" }: { children: ReactNode; tone?: "green" | "amber" | "red" | "gray" }) {
  return (
    <span className={`status status-${tone}`}>
      <i />
      {children}
    </span>
  );
}
