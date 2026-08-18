"use client";

// ---------------------------------------------------------------------------
// GST state picker, shared by the client, vendor and company-profile forms
// ---------------------------------------------------------------------------
// The state a party belongs to is what decides whether their invoices carry
// SGST + CGST or IGST (see backend/app/services/gst.py). It's normally
// implied by the first two digits of their GSTIN, so `useGstState` keeps the
// dropdown in step with a GSTIN field as it's typed — but only until the
// admin picks a state themselves, after which their choice stands. That
// matters for the two cases the GSTIN can't cover: a party who isn't
// GST-registered at all (a same-state supply to them is still SGST + CGST,
// not IGST) and one whose GSTIN on file is wrong.
import { useCallback, useRef, useState } from "react";

import { GST_STATE_OPTIONS, stateCodeFromGstin } from "@/lib/gst";
import styles from "@/styles/dashboard.module.css";

export function useGstState(initialStateCode: string, initialGstin: string) {
  const [stateCode, setStateCodeRaw] = useState(initialStateCode || stateCodeFromGstin(initialGstin));
  // Once the admin has chosen a state by hand, later GSTIN edits leave it
  // alone. A ref rather than state: nothing renders differently because of
  // it, and it must not schedule a re-render mid-typing.
  const chosenByHand = useRef(false);

  const setStateCode = useCallback((code: string) => {
    chosenByHand.current = true;
    setStateCodeRaw(code);
  }, []);

  // Call from the GSTIN field's onChange, with the new GSTIN.
  const syncFromGstin = useCallback((gstin: string) => {
    if (chosenByHand.current) return;
    const derived = stateCodeFromGstin(gstin);
    // A half-typed GSTIN derives nothing; keep whatever is showing rather
    // than blanking the field on every keystroke.
    if (derived) setStateCodeRaw(derived);
  }, []);

  // For forms that load their initial values asynchronously (the profile
  // page fetches them): re-seed the field and forget any earlier manual
  // choice, since the form is showing a different record's values now.
  const reset = useCallback((code: string, gstin: string) => {
    chosenByHand.current = false;
    setStateCodeRaw(code || stateCodeFromGstin(gstin));
  }, []);

  return { stateCode, setStateCode, syncFromGstin, reset };
}

export function GstStateSelect({
  id,
  value,
  onChange,
  label = "State",
}: {
  id: string;
  value: string;
  onChange: (stateCode: string) => void;
  label?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className={styles.formLabel}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={styles.formInput}>
        <option value="">—</option>
        {GST_STATE_OPTIONS.map((state) => (
          <option key={state.code} value={state.code}>
            {state.name} ({state.code})
          </option>
        ))}
      </select>
    </div>
  );
}
