import { Route, Routes } from "react-router-dom";
import { Shell } from "./components/layout/Shell";
import { OverviewPage } from "./features/overview/OverviewPage";
import { ShoppingPage } from "./features/shopping/ShoppingPage";
import { MandatesPage } from "./features/mandates/MandatesPage";
import { WalletPage } from "./features/wallet/WalletPage";
import { ActivityPage } from "./features/activity/ActivityPage";
import { ReceiptsPage } from "./features/receipts/ReceiptsPage";
import { SecurityPage } from "./features/security/SecurityPage";
import { SettingsPage } from "./features/settings/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<OverviewPage />} />
        <Route path="shopping" element={<ShoppingPage />} />
        <Route path="mandates" element={<MandatesPage />} />
        <Route path="wallet" element={<WalletPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="receipts" element={<ReceiptsPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
