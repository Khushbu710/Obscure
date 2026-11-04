import { useState } from "react";
import type { CreateMandateRequest, Mandate } from "@obscura/contracts";
import { Icon } from "../../components/common/Icon";
import { ErrorState } from "../../components/feedback/ErrorState";
import { api } from "../../lib/api/client";
import { formatMinor } from "../../lib/formatters/money";

const STEPS = ["Limits", "Restrictions", "Duration", "Review"] as const;

/**
 * Only the fields actually defined in CreateMandateRequestSchema
 * (packages/contracts/src/mandate.ts) are collected: allowedCategories,
 * allowedMerchants, totalCapMinor, perOrderCapMinor, currency,
 * durationHours. There is no `name`/`description` field in the real
 * schema, so this form does not pretend to collect or save one (the
 * original design mockup's "Identity" step is dropped for this reason -
 * see the implementation report).
 *
 * The real schema also has no absolute-expiration-date field, only a
 * relative `durationHours` - this form lets the user pick an absolute
 * date/time and computes the duration from "now" at submit time.
 */
export function CreateMandateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (m: Mandate) => void }) {
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState<Mandate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const [totalBudget, setTotalBudget] = useState("200.00");
  const [currency, setCurrency] = useState("USD");
  const [perOrderCap, setPerOrderCap] = useState("30.00");
  const [perOrderCapEnabled, setPerOrderCapEnabled] = useState(true);
  // "esim" is the only category OBSCURA's agent can currently discover
  // products in - see bitrefill-integration.md / normalize.ts, which always
  // assigns category "esim". Offering other categories here would propose
  // a restriction the agent could never actually satisfy.
  const [category, setCategory] = useState("esim");
  const [merchants, setMerchants] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });

  const toMinor = (v: string) => Math.round(parseFloat(v) * 100);
  const totalBudgetMinor = toMinor(totalBudget);
  const perOrderCapMinorValue = toMinor(perOrderCap);

  /**
   * Real client-side validation, previously entirely absent - the form let
   * a user click through to submission with an empty/non-numeric budget
   * (silently became 0 via NaN-to-JSON coercion) or a past expiration date
   * (silently clamped to ~1 second, creating an instantly-dead mandate
   * without telling them). This does not replace or weaken the backend's
   * own Zod validation - it only gives earlier, clearer feedback.
   */
  function stepError(forStep: number): string | null {
    if (forStep === 0) {
      if (!Number.isFinite(totalBudgetMinor) || totalBudgetMinor <= 0) return "Enter a total budget greater than zero.";
      if (perOrderCapEnabled) {
        if (!Number.isFinite(perOrderCapMinorValue) || perOrderCapMinorValue <= 0) return "Enter a per-order cap greater than zero.";
        if (perOrderCapMinorValue > totalBudgetMinor) return "Per-order cap cannot exceed the total budget.";
      }
    }
    if (forStep === 2) {
      const durationMs = new Date(expiresAt).getTime() - Date.now();
      if (!Number.isFinite(durationMs) || durationMs <= 0) return "Choose an expiration date and time in the future.";
    }
    return null;
  }

  const currentStepError = stepError(step);

  const submit = async () => {
    const blockingStep = [0, 1, 2].find((s) => stepError(s) !== null);
    if (blockingStep !== undefined) {
      setStep(blockingStep);
      return;
    }
    const durationHours = (new Date(expiresAt).getTime() - Date.now()) / 3_600_000;
    const body: CreateMandateRequest = {
      allowedCategories: [category],
      allowedMerchants: merchants.trim() ? merchants.split(",").map((m) => m.trim()).filter(Boolean) : null,
      totalCapMinor: totalBudgetMinor,
      perOrderCapMinor: perOrderCapEnabled ? perOrderCapMinorValue : null,
      currency,
      durationHours,
    };
    setSubmitting(true);
    setSubmitError(null);
    try {
      const mandate = await api.mandates.create(body);
      setCreated(mandate);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Create mandate">
        {!created ? (
          <>
            <div className="modal-header">
              <div>
                <p className="eyebrow">New spending authority</p>
                <h2>Create mandate</h2>
              </div>
              <button className="icon-button" onClick={onClose} aria-label="Close">
                <Icon name="close" />
              </button>
            </div>
            <div className="wizard">
              {STEPS.map((s, i) => (
                <div key={s} className={`${step === i ? "active" : ""} ${step > i ? "done" : ""}`}>
                  <span>{step > i ? <Icon name="check" size={12} /> : i + 1}</span>
                  <b>{s}</b>
                </div>
              ))}
            </div>
            <div className="modal-body">
              {step === 0 && (
                <div className="form-page">
                  <p className="step-label">STEP 1 OF {STEPS.length}</p>
                  <h3>Set hard spending limits</h3>
                  <p>These limits are deterministic and enforced server-side by the guardian - the agent cannot exceed them.</p>
                  <div className="field-row">
                    <label>
                      Total budget
                      <div className="money-input">
                        <span>$</span>
                        <input value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} inputMode="decimal" aria-label="Total budget" />
                      </div>
                    </label>
                    <label>
                      Currency
                      <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                        <option>USD</option>
                        <option>EUR</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={perOrderCapEnabled} onChange={(e) => setPerOrderCapEnabled(e.target.checked)} style={{ width: "auto" }} />
                      Maximum per order
                    </span>
                    {perOrderCapEnabled && (
                      <div className="money-input">
                        <span>$</span>
                        <input value={perOrderCap} onChange={(e) => setPerOrderCap(e.target.value)} inputMode="decimal" aria-label="Per-order cap" />
                      </div>
                    )}
                    <small>No single purchase may exceed this value.</small>
                  </label>
                  {currentStepError && <p className="field-error">{currentStepError}</p>}
                </div>
              )}
              {step === 1 && (
                <div className="form-page">
                  <p className="step-label">STEP 2 OF {STEPS.length}</p>
                  <h3>Define purchase boundaries</h3>
                  <p>Only matching proposals can advance to the isolated signer.</p>
                  <label>
                    Allowed category
                    <div className="choice-grid">
                      <button type="button" className={category === "esim" ? "chosen" : ""} onClick={() => setCategory("esim")}>
                        eSIM <Icon name="check" />
                      </button>
                    </div>
                    <small>eSIM is currently the only category the shopping agent can discover products in.</small>
                  </label>
                  <label>
                    Allowed merchants <em>Optional</em>
                    <input value={merchants} onChange={(e) => setMerchants(e.target.value)} placeholder="e.g. bitrefill" />
                    <small>Comma-separated. Leave blank to allow any merchant within the category.</small>
                  </label>
                </div>
              )}
              {step === 2 && (
                <div className="form-page">
                  <p className="step-label">STEP 3 OF {STEPS.length}</p>
                  <h3>Set an expiration</h3>
                  <p>Unused authority is automatically invalidated at this time.</p>
                  <label>
                    Expires at
                    <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                  </label>
                  <div className="info-box">
                    <Icon name="shield" />
                    <p>The mandate will expire automatically. Any open proposals will be rejected after this time.</p>
                  </div>
                  {currentStepError && <p className="field-error">{currentStepError}</p>}
                </div>
              )}
              {step === 3 && (
                <div className="form-page review">
                  <p className="step-label">STEP 4 OF {STEPS.length}</p>
                  <h3>Review mandate</h3>
                  <p>Confirm the exact authority you are granting.</p>
                  <div className="review-total">
                    <span>{category} mandate</span>
                    <strong>
                      {totalBudget} <small>{currency}</small>
                    </strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Agent can</dt>
                      <dd>
                        Purchase verified {category} products {merchants.trim() ? `from ${merchants}` : "from any merchant"}, up to{" "}
                        {perOrderCapEnabled ? `$${perOrderCap}` : "the total budget"} per order.
                      </dd>
                    </div>
                    <div>
                      <dt>Agent cannot</dt>
                      <dd>Exceed the total budget, use another category or merchant, or transact after expiration.</dd>
                    </div>
                    <div>
                      <dt>Expires</dt>
                      <dd>{new Date(expiresAt).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Key access</dt>
                      <dd>None — signing remains isolated</dd>
                    </div>
                  </dl>
                  {submitError ? <ErrorState error={submitError} /> : null}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="secondary" onClick={step === 0 ? onClose : () => setStep((s) => s - 1)} disabled={submitting}>
                {step === 0 ? "Cancel" : "Back"}
              </button>
              <button
                className="primary"
                disabled={submitting || currentStepError !== null}
                onClick={() => (step < STEPS.length - 1 ? setStep((s) => s + 1) : submit())}
              >
                {step < STEPS.length - 1 ? (
                  <>
                    Continue <Icon name="arrow" />
                  </>
                ) : submitting ? (
                  "Creating…"
                ) : (
                  <>
                    Create mandate <Icon name="check" />
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="confirmation">
            <span>
              <Icon name="check" size={30} />
            </span>
            <p className="eyebrow">Mandate created</p>
            <h2>Authority, precisely bounded.</h2>
            <p>
              Your {created.allowedCategories.join(", ")} mandate is now active with a {formatMinor(created.totalCapMinor, created.currency)} budget.
              The agent cannot exceed the rules you defined.
            </p>
            <div>
              <small>MANDATE IDENTIFIER</small>
              <b className="mono">{created.id}</b>
            </div>
            <button
              className="primary"
              onClick={() => {
                onCreated(created);
                onClose();
              }}
            >
              View mandate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
