import { PageHead } from "../../components/common/PageHead";
import { UnavailableState } from "../../components/feedback/UnavailableState";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

/**
 * There is no user account, auth, or preferences system implemented in the
 * backend at all (no `/api/users`, no session/profile endpoints). Per the
 * task's explicit instruction, this page does not invent a profile form,
 * notification toggles, or network settings that don't exist - it shows
 * only the one thing that's actually real and relevant: the configured API
 * base URL, read-only.
 */
export function SettingsPage() {
  return (
    <>
      <PageHead title="Settings" eyebrow="Account and preferences" />
      <div className="settings-layout">
        <nav>
          <button className="active">Connection</button>
        </nav>
        <section className="settings-form">
          <h2>Backend connection</h2>
          <p>Configured via VITE_API_BASE_URL at build time.</p>
          <label>
            API base URL
            <input value={API_BASE_URL} readOnly />
          </label>
          <hr />
          <h2>Account</h2>
          <UnavailableState title="No account system implemented" reason="OBSCURA is currently a single-user backend with no authentication, profile, or preferences endpoints - there is nothing real to show here yet." />
        </section>
      </div>
    </>
  );
}
