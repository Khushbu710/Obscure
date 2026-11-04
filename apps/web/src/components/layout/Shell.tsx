import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { SystemBar } from "./SystemBar";

export function Shell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="app">
      <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      {mobileNavOpen && <button className="mobile-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <main>
        <Header onOpenNav={() => setMobileNavOpen(true)} />
        <SystemBar />
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
