import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "../common/Icon";

const nav: [string, string, IconName][] = [
  ["Overview", "/", "grid"],
  ["Shopping", "/shopping", "bag"],
  ["Mandates", "/mandates", "file"],
  ["Wallet", "/wallet", "wallet"],
  ["Activity", "/activity", "pulse"],
  ["Receipts", "/receipts", "receipt"],
  ["Security", "/security", "shield"],
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand-lockup">
        <NavLink to="/" className="brand" onClick={onClose}>
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <b>OBSCURA</b>
        </NavLink>
        <p>
          Give the agent a budget,
          <br />
          not your keys.
        </p>
      </div>
      <nav>
        {nav.map(([label, to, icon]) => (
          <NavLink key={label} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "active" : "")} onClick={onClose}>
            <Icon name={icon} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        {/*
          Original design showed a fabricated "Block 2,914,882" and a
          connection dot. Real chain-height data has no backend source yet
          (see lib/api/unavailable.ts "walletEnvelope"), so this only shows
          what's actually configured, not a fabricated block height.
        */}
        <div className="network">
          <span>
            <i />
            Zcash Testnet
          </span>
          <small>Block height unavailable</small>
        </div>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")} onClick={onClose}>
          <Icon name="settings" />
          <span>Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}
