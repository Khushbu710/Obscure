/** Labels any value that is not real backend data. Never let mock and real data render without this. */
export function DemoTag({ children = "Mock" }: { children?: string }) {
  return <span className="demo-tag">{children}</span>;
}
