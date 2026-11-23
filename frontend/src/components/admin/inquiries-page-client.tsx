"use client";

// ---------------------------------------------------------------------------
// <InquiriesPageClient> — /admin/inquiries
// ---------------------------------------------------------------------------
// Inquiries raised by the team against Database leads (lib/inquiries.ts).
// The list shows each one's lead, owner and current status; opening a row
// shows the full details and the status timeline, where a new status (with
// an optional note) is added on top of the last. ?inquiry=<id> opens one
// directly — it's where the "assigned to you" notification links.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/button";
import { SingleSelectDropdown } from "@/components/admin/single-select-dropdown";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import { XMarkIcon } from "@/components/icons";
import { formatDateTime } from "@/lib/format-date";
import {
  addInquiryStep,
  createInquiry,
  fetchAssignableUsers,
  fetchInquiries,
  fetchInquiryLeads,
  INQUIRY_STATUS_OPTIONS,
  updateInquiry,
  type Inquiry,
  type InquiryOption,
  type InquiryStatus,
  type StepFields,
} from "@/lib/inquiries";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded" | "failed";

// Status filter: a preset, "custom" for any custom label, or "none" for an
// inquiry with no status yet. Empty means every inquiry.
type StatusFilter = InquiryStatus | "none" | "";

const UNASSIGNED = "unassigned";

// Backend datetimes are naive UTC.
function utc(value: string): string {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

const EMPTY_STEP: StepFields = { status: "requirements_received", customLabel: "", note: "" };

export function InquiriesPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [users, setUsers] = useState<InquiryOption[]>([]);
  const [leads, setLeads] = useState<InquiryOption[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchInquiries(), fetchAssignableUsers(), fetchInquiryLeads()])
      .then(([inquiryData, userData, leadData]) => {
        if (cancelled) return;
        setInquiries(inquiryData);
        setUsers(userData);
        setLeads(leadData);
        setLoadState("loaded");
      })
      .catch(() => {
        if (!cancelled) setLoadState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const linked = searchParams.get("inquiry");
  useEffect(() => {
    const id = Number(linked);
    if (linked && Number.isInteger(id) && id > 0) {
      queueMicrotask(() => setOpenId(id));
    }
  }, [linked]);

  const upsert = useCallback((saved: Inquiry) => {
    setInquiries((previous) => [saved, ...previous.filter((row) => row.id !== saved.id)]);
  }, []);

  function closeDetail() {
    setOpenId(null);
    if (linked) router.replace(pathname);
  }

  const visible = inquiries
    .filter((row) =>
      statusFilter === "" ? true : statusFilter === "none" ? row.currentStatus === null : row.currentStatus === statusFilter,
    )
    .filter((row) =>
      assigneeFilter === ""
        ? true
        : assigneeFilter === UNASSIGNED
          ? row.assignedUserId === null
          : String(row.assignedUserId) === assigneeFilter,
    )
    .filter((row) => matchesSearch(search, [row.leadName, row.details, row.assignedUserName, row.currentStatusLabel]));

  const openInquiry = inquiries.find((row) => row.id === openId) ?? null;

  return (
    <>
      <div className={styles.pageHeaderWithTabs}>
        <h1 className={styles.pageHeading}>Inquiries</h1>
        <div className={styles.pageHeaderAction}>
          <Button type="button" variant="primary" onClick={() => setCreating(true)} disabled={loadState !== "loaded"}>
            + New inquiry
          </Button>
        </div>
      </div>

      <p className={styles.pageSubtext}>
        What each lead is asking for, who owns it, and how far it has got. Open one to add the next status.
      </p>

      <div className={styles.filterToggleRow}>
        <TableSearchInput
          value={search}
          onChange={setSearch}
          label="Search inquiries"
          placeholder="Search lead, details or assignee…"
        />
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          className={styles.formInput}
        >
          <option value="">All statuses</option>
          {INQUIRY_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === "custom" ? "Custom" : option.label}
            </option>
          ))}
          <option value="none">No status yet</option>
        </select>
        <select
          aria-label="Filter by assignee"
          value={assigneeFilter}
          onChange={(event) => setAssigneeFilter(event.target.value)}
          className={styles.formInput}
        >
          <option value="">Everyone</option>
          {users.map((user) => (
            <option key={user.id} value={String(user.id)}>
              {user.name}
            </option>
          ))}
          <option value={UNASSIGNED}>Unassigned</option>
        </select>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>#</th>
              <th className={styles.tableHeadCell}>Lead</th>
              <th className={styles.tableHeadCell}>Details</th>
              <th className={styles.tableHeadCell}>Assigned to</th>
              <th className={styles.tableHeadCell}>Status</th>
              <th className={styles.tableHeadCell}>Last update</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} onClick={() => setOpenId(row.id)} className={styles.tableRow}>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>#{row.id}</td>
                <td className={styles.tableCell}>{row.leadName}</td>
                <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={row.details}>
                  {row.details}
                </td>
                <td className={styles.tableCell}>{row.assignedUserName || "—"}</td>
                <td className={styles.tableCell}>{row.currentStatusLabel || "—"}</td>
                <td className={styles.tableCell}>{formatDateTime(utc(row.updatedAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {loadState === "loading" && <p className={styles.pageSubtext}>Loading inquiries…</p>}
        {loadState === "failed" && (
          <p role="alert" className={styles.formError}>
            Couldn&apos;t load inquiries. Please refresh the page or try again shortly.
          </p>
        )}
        {loadState === "loaded" && visible.length === 0 && (
          <p className={styles.pageSubtext}>
            {inquiries.length === 0 ? "No inquiries yet. Add one with + New inquiry." : "No inquiries match."}
          </p>
        )}
      </div>

      {creating && (
        <InquiryFormModal
          leads={leads}
          users={users}
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            upsert(saved);
            setCreating(false);
            setOpenId(saved.id);
          }}
        />
      )}

      {openInquiry && (
        <InquiryDetailModal
          key={openInquiry.id}
          inquiry={openInquiry}
          leads={leads}
          users={users}
          onSaved={upsert}
          onClose={closeDetail}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Status step fields, shared by the create form and the timeline.
// ---------------------------------------------------------------------------
function StepInputs({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  value: StepFields;
  onChange: (next: StepFields) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}Status`} className={styles.formLabel}>
          Status
        </label>
        <select
          id={`${idPrefix}Status`}
          value={value.status}
          onChange={(event) => onChange({ ...value, status: event.target.value as InquiryStatus })}
          className={styles.formInput}
          disabled={disabled}
        >
          {INQUIRY_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {value.status === "custom" ? (
        <div>
          <label htmlFor={`${idPrefix}Custom`} className={styles.formLabel}>
            Custom status<span className={styles.requiredMark}>*</span>
          </label>
          <input
            id={`${idPrefix}Custom`}
            type="text"
            maxLength={80}
            placeholder="e.g. Design approved"
            value={value.customLabel}
            onChange={(event) => onChange({ ...value, customLabel: event.target.value })}
            className={styles.formInput}
            disabled={disabled}
          />
        </div>
      ) : (
        <div />
      )}
      <div className={styles.formGridFullSpan}>
        <label htmlFor={`${idPrefix}Note`} className={styles.formLabel}>
          Note
        </label>
        <textarea
          id={`${idPrefix}Note`}
          rows={2}
          maxLength={2000}
          value={value.note}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
          className={styles.formTextarea}
          disabled={disabled}
        />
      </div>
    </>
  );
}

function stepError(step: StepFields): string | null {
  return step.status === "custom" && !step.customLabel.trim() ? "Enter a name for the custom status." : null;
}

function toLeadOptions(leads: InquiryOption[]) {
  return leads.map((lead) => ({ value: String(lead.id), label: lead.name, isDeleted: false }));
}

// ---------------------------------------------------------------------------
// New inquiry
// ---------------------------------------------------------------------------
function InquiryFormModal({
  leads,
  users,
  onClose,
  onSaved,
}: {
  leads: InquiryOption[];
  users: InquiryOption[];
  onClose: () => void;
  onSaved: (inquiry: Inquiry) => void;
}) {
  const [leadId, setLeadId] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [assignee, setAssignee] = useState("");
  const [withStatus, setWithStatus] = useState(true);
  const [step, setStep] = useState<StepFields>(EMPTY_STEP);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!leadId) return setError("Pick a lead.");
    if (!details.trim()) return setError("Describe what the inquiry is about.");
    const problem = withStatus ? stepError(step) : null;
    if (problem) return setError(problem);

    setSaving(true);
    setError(null);
    try {
      onSaved(
        await createInquiry({
          contactId: Number(leadId),
          details: details.trim(),
          assignedUserId: assignee ? Number(assignee) : null,
          firstStep: withStatus ? { ...step, customLabel: step.customLabel.trim(), note: step.note.trim() } : null,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="inquiry-form-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="inquiry-form-title" className={styles.modalTitle}>
            New inquiry
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm} noValidate>
          <div className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <SingleSelectDropdown
                label="Lead"
                placeholder="Select a lead"
                entityLabel="leads"
                required
                showStatusFilter={false}
                options={toLeadOptions(leads)}
                selectedValue={leadId}
                onChange={setLeadId}
              />
            </div>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="inquiryDetails" className={styles.formLabel}>
                What is the inquiry about?<span className={styles.requiredMark}>*</span>
              </label>
              <textarea
                id="inquiryDetails"
                rows={4}
                maxLength={5000}
                placeholder="e.g. 50 Diwali hampers for employees, budget ₹2,000 each, delivery by 20 Oct"
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                className={styles.formTextarea}
                disabled={saving}
              />
            </div>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="inquiryAssignee" className={styles.formLabel}>
                Assign to
              </label>
              <select
                id="inquiryAssignee"
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
                className={styles.formInput}
                disabled={saving}
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={String(user.id)}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <label className={`${styles.formGridFullSpan} ${styles.formHint}`}>
              <input
                type="checkbox"
                checked={withStatus}
                onChange={(event) => setWithStatus(event.target.checked)}
                disabled={saving}
              />{" "}
              Start with a status
            </label>
            {withStatus && <StepInputs idPrefix="newInquiry" value={step} onChange={setStep} disabled={saving} />}
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : "Create inquiry"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One inquiry: details, owner, and the status timeline.
// ---------------------------------------------------------------------------
function InquiryDetailModal({
  inquiry,
  leads,
  users,
  onSaved,
  onClose,
}: {
  inquiry: Inquiry;
  leads: InquiryOption[];
  users: InquiryOption[];
  onSaved: (inquiry: Inquiry) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(String(inquiry.contactId));
  const [details, setDetails] = useState(inquiry.details);
  const [assignee, setAssignee] = useState(inquiry.assignedUserId === null ? "" : String(inquiry.assignedUserId));
  const [step, setStep] = useState<StepFields>(EMPTY_STEP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<Inquiry>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await action());
      after?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function saveEdits() {
    if (!leadId) return setError("Pick a lead.");
    if (!details.trim()) return setError("Describe what the inquiry is about.");
    void run(
      () =>
        updateInquiry(inquiry.id, {
          contactId: Number(leadId),
          details: details.trim(),
          assignedUserId: assignee ? Number(assignee) : null,
        }),
      () => setEditing(false),
    );
  }

  function addStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = stepError(step);
    if (problem) return setError(problem);
    void run(
      () => addInquiryStep(inquiry.id, { ...step, customLabel: step.customLabel.trim(), note: step.note.trim() }),
      () => setStep(EMPTY_STEP),
    );
  }

  // Newest first reads better as a log; the backend keeps them oldest first.
  const timeline = [...inquiry.steps].reverse();

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="inquiry-detail-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="inquiry-detail-title" className={styles.modalTitle}>
            Inquiry #{inquiry.id} · {inquiry.leadName}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.modalForm}>
          {editing ? (
            <div className={styles.formGrid}>
              <div className={styles.formGridFullSpan}>
                <SingleSelectDropdown
                  label="Lead"
                  entityLabel="leads"
                  required
                  showStatusFilter={false}
                  options={toLeadOptions(leads)}
                  selectedValue={leadId}
                  onChange={setLeadId}
                />
              </div>
              <div className={styles.formGridFullSpan}>
                <label htmlFor="editInquiryDetails" className={styles.formLabel}>
                  Details<span className={styles.requiredMark}>*</span>
                </label>
                <textarea
                  id="editInquiryDetails"
                  rows={4}
                  maxLength={5000}
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  className={styles.formTextarea}
                  disabled={busy}
                />
              </div>
              <div className={styles.formGridFullSpan}>
                <label htmlFor="editInquiryAssignee" className={styles.formLabel}>
                  Assign to
                </label>
                <select
                  id="editInquiryAssignee"
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                  className={styles.formInput}
                  disabled={busy}
                >
                  <option value="">Unassigned</option>
                  {users.map((user) => (
                    <option key={user.id} value={String(user.id)}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${styles.formGridFullSpan} ${styles.modalActionsRight}`}>
                <Button type="button" variant="tertiary" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="button" variant="primary" onClick={saveEdits} disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <p className={styles.formLabel}>Details</p>
              <p style={{ whiteSpace: "pre-wrap" }}>{inquiry.details}</p>
              <p className={styles.formHint}>
                Assigned to {inquiry.assignedUserName || "nobody"} · Raised {formatDateTime(utc(inquiry.createdAt))}
              </p>
              <Button type="button" variant="tertiary" onClick={() => setEditing(true)}>
                Edit details / assignee
              </Button>
            </div>
          )}

          <form onSubmit={addStep} noValidate>
            <h3 className={styles.formLabel}>Add the next status</h3>
            <div className={styles.formGrid}>
              <StepInputs idPrefix="nextStep" value={step} onChange={setStep} disabled={busy} />
            </div>
            <div className={styles.modalActionsRight}>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Add status"}
              </Button>
            </div>
          </form>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div>
            <h3 className={styles.formLabel}>Timeline</h3>
            {timeline.length === 0 ? (
              <p className={styles.formHint}>No status yet.</p>
            ) : (
              <ol>
                {timeline.map((entry, index) => (
                  <li key={`${entry.createdAt}-${index}`} style={{ marginBottom: "0.75rem" }}>
                    <strong>{entry.label}</strong>
                    {index === 0 && <span className={styles.formHint}> · current</span>}
                    <div className={styles.formHint}>
                      {formatDateTime(utc(entry.createdAt))}
                      {entry.createdByName && ` · ${entry.createdByName}`}
                    </div>
                    {entry.note && <p style={{ whiteSpace: "pre-wrap" }}>{entry.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
