import type { ReactNode } from "react";

export type IconName =
  | "grid" | "bag" | "file" | "wallet" | "pulse" | "receipt" | "shield" | "settings"
  | "bell" | "arrow" | "plus" | "search" | "check" | "close" | "chevron" | "copy"
  | "download" | "lock" | "pause" | "alert";

const iconPaths: Record<IconName, ReactNode> = {
  grid: (<><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>),
  bag: (<><path d="M6 8h12l1 13H5L6 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>),
  file: (<><path d="M6 2h9l4 4v16H6Z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></>),
  wallet: (<><path d="M3 6h16a2 2 0 0 1 2 2v11H3V6Z" /><path d="M3 7V5a2 2 0 0 1 2-2h12v3M15 12h6v4h-6a2 2 0 1 1 0-4Z" /></>),
  pulse: (<path d="M3 12h4l2-6 4 12 2-6h6" />),
  receipt: (<><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" /><path d="M9 7h6M9 11h6M9 15h4" /></>),
  shield: (<><path d="M12 2 20 5v6c0 5-3.4 8.8-8 11-4.6-2.2-8-6-8-11V5l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>),
  bell: (<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7M10 20h4" />),
  arrow: (<path d="M5 12h14M14 7l5 5-5 5" />),
  plus: (<path d="M12 5v14M5 12h14" />),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>),
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  copy: (<><rect x="8" y="8" width="11" height="13" /><path d="M16 8V3H5v13h3" /></>),
  download: (<><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></>),
  lock: (<><rect x="5" y="10" width="14" height="11" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>),
  pause: (<path d="M9 5v14M15 5v14" />),
  alert: (<><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>),
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}
