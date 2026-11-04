import { useLocation } from "react-router-dom";
import { Icon } from "../common/Icon";

const titleByPath: Record<string, string> = {
  "/": "Overview",
  "/shopping": "Shopping",
  "/mandates": "Mandates",
  "/wallet": "Wallet",
  "/activity": "Activity",
  "/receipts": "Receipts",
  "/security": "Security",
  "/settings": "Settings",
};

export function Header({ onOpenNav }: { onOpenNav: () => void }) {
  const location = useLocation();
  const page = titleByPath[location.pathname] ?? "";

  return (
    <header>
      <button className="mobile-menu" onClick={onOpenNav} aria-label="Open navigation">
        <span />
        <span />
        <span />
      </button>
      <div>
        <span className="header-page">{page}</span>
        <span className="header-network">
          <i />
          Zcash Testnet
        </span>
      </div>
      <div>
        {/*
          "Agent key access: None" is an architectural fact that holds by
          construction (see security-architecture.md) - it is not read from
          an API because it isn't a runtime value, it's a structural
          guarantee of the system design.
        */}
        <span className="key-boundary">
          <Icon name="lock" size={13} />
          <span>
            Agent key access
            <b>None</b>
          </span>
        </span>
      </div>
    </header>
  );
}
