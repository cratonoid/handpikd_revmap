"use client";

// ---------------------------------------------------------------------------
// <EmailsPageClient> — the interactive half of /admin/emails
// ---------------------------------------------------------------------------
// Three tabs: Templates (reusable emails, each for leads or clients), Sent
// (every send made from the app, with each recipient's result) and
// Signature (appended to every email). Emails themselves are written and
// sent from the Leads and Clients tabs of /admin/database, where the
// recipients are picked. Backed by lib/emails.ts.
//
// The banner at the top says whether the Titan mailbox is set up, and can
// check the login without emailing anyone.
import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { EmailTemplateModal } from "@/components/admin/email-template-modal";
import { isHtmlEmpty, RichTextEditor } from "@/components/admin/rich-text-editor";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import {
  AUDIENCE_LABELS,
  checkBounces,
  deleteTemplate,
  fetchEmailStatus,
  fetchSends,
  fetchSignature,
  fetchSignatureLogoUrl,
  fetchTemplates,
  RECIPIENT_STATUS_LABELS,
  resetSignatureLogo,
  saveSignature,
  testEmailConnection,
  uploadSignatureLogo,
  type EmailSend,
  type EmailSignature,
  type EmailStatus,
  type EmailTemplate,
} from "@/lib/emails";
import { formatDate, formatDateTime } from "@/lib/format-date";
import dashboardStyles from "@/styles/dashboard.module.css";
import styles from "@/styles/emails.module.css";

type Tab = "templates" | "sent" | "signature";
type LoadState = "loading" | "loaded" | "error";
type ModalState = { mode: "add" } | { mode: "edit"; template: EmailTemplate } | null;

const TABS: { key: Tab; label: string }[] = [
  { key: "templates", label: "Templates" },
  { key: "sent", label: "Sent" },
  { key: "signature", label: "Signature" },
];

// Backend timestamps are naive UTC; the "Z" makes formatDateTime treat them
// as the instant they are and show it in Indian time.
function utc(value: string): string {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

export function EmailsPageClient() {
  const [tab, setTab] = useState<Tab>("templates");
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchEmailStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult({ ok: true, message: await testEmailConnection() });
    } catch (caught) {
      setTestResult({ ok: false, message: caught instanceof Error ? caught.message : "Couldn't connect." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <div className={dashboardStyles.pageHeaderRow}>
        <div>
          <h1 className={dashboardStyles.pageHeading}>Emails</h1>
        </div>
      </div>

      {status && (
        <div className={status.configured ? styles.noticeInfo : styles.noticeWarning}>
          <div className={styles.noticeRow}>
            <span>
              {status.configured ? (
                <>
                  Sending as <strong>{status.fromName}</strong> &lt;{status.fromAddress}&gt; through Titan. To send, pick
                  leads or clients on the Database page and press <strong>Email</strong>.
                </>
              ) : (
                <>
                  Email isn&apos;t set up yet. Add <code>SMTP_USER</code> and <code>SMTP_PASSWORD</code> (your Titan
                  address and password) to the backend <code>.env</code> and restart it.
                </>
              )}
            </span>
            {status.configured && (
              <button type="button" onClick={() => void handleTest()} disabled={testing} className={styles.smallButton}>
                {testing ? "Checking…" : "Test connection"}
              </button>
            )}
          </div>
          {testResult && (
            <p role="status" className={testResult.ok ? styles.testOk : styles.testFailed}>
              {testResult.message}
            </p>
          )}
        </div>
      )}

      <div className={dashboardStyles.filterToggleRow}>
        <div className={dashboardStyles.viewToggle} role="tablist" aria-label="Emails section">
          {TABS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={tab === option.key}
              onClick={() => setTab(option.key)}
              className={`${dashboardStyles.viewToggleButton} ${tab === option.key ? dashboardStyles.viewToggleButtonActive : ""}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "templates" && <TemplatesTab />}
      {tab === "sent" && <SentTab />}
      {tab === "signature" && <SignatureTab />}
    </>
  );
}

function AudiencePill({ audience }: { audience: EmailTemplate["audience"] }) {
  return (
    <span className={`${styles.audiencePill} ${audience === "lead" ? styles.audiencePillLead : styles.audiencePillClient}`}>
      {AUDIENCE_LABELS[audience].singular}
    </span>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTemplates()
      .then((rows) => {
        if (cancelled) return;
        setTemplates(rows);
        setLoadState("loaded");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(caught instanceof Error ? caught.message : "Failed to load the templates.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = templates.filter((template) => matchesSearch(search, [template.name, template.subject]));

  function handleSaved(saved: EmailTemplate) {
    setTemplates((current) => {
      const index = current.findIndex((row) => row.id === saved.id);
      const next = index === -1 ? [...current, saved] : current.map((row) => (row.id === saved.id ? saved : row));
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
    setModalState(null);
  }

  async function handleDelete(template: EmailTemplate) {
    setRowError(null);
    setDeletingId(template.id);
    try {
      await deleteTemplate(template.id);
      setTemplates((current) => current.filter((row) => row.id !== template.id));
      setConfirmingDeleteId(null);
    } catch (caught) {
      setRowError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className={styles.tabToolbar}>
        <TableSearchInput value={search} onChange={setSearch} label="Search templates" placeholder="Search name or subject…" />
        <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
          + New template
        </Button>
      </div>

      {rowError && (
        <p role="alert" aria-live="polite" className={dashboardStyles.formError}>
          {rowError}
        </p>
      )}

      <div className={dashboardStyles.tableWrap}>
        <table className={dashboardStyles.table}>
          <thead>
            <tr>
              <th className={dashboardStyles.tableHeadCell}>S.No</th>
              <th className={dashboardStyles.tableHeadCell}>Template</th>
              <th className={dashboardStyles.tableHeadCell}>For</th>
              <th className={dashboardStyles.tableHeadCell}>Subject</th>
              <th className={dashboardStyles.tableHeadCell}>Attachments</th>
              <th className={dashboardStyles.tableHeadCell}>Updated</th>
              <th className={dashboardStyles.tableHeadCell}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((template, index) => (
              <tr key={template.id} className={dashboardStyles.tableRow}>
                <td className={dashboardStyles.tableCell}>{index + 1}</td>
                <td className={`${dashboardStyles.tableCell} ${dashboardStyles.tableCellPrimary}`}>{template.name}</td>
                <td className={dashboardStyles.tableCell}>
                  <AudiencePill audience={template.audience} />
                </td>
                <td className={`${dashboardStyles.tableCell} ${dashboardStyles.databaseCellClip}`} title={template.subject}>
                  {template.subject}
                </td>
                <td className={dashboardStyles.tableCell}>
                  {template.attachments.length === 0
                    ? "—"
                    : template.attachments.map((attachment) => attachment.filename).join(", ")}
                </td>
                <td className={dashboardStyles.tableCell}>{formatDate(utc(template.updatedAt))}</td>
                <td className={dashboardStyles.tableCell}>
                  <div className={dashboardStyles.deleteConfirmRow}>
                    {confirmingDeleteId === template.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          disabled={deletingId === template.id}
                          className={dashboardStyles.expenseRowButton}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(template)}
                          disabled={deletingId === template.id}
                          className={`${dashboardStyles.expenseRowButton} ${dashboardStyles.expenseRowButtonDanger}`}
                        >
                          {deletingId === template.id ? "Deleting…" : "Yes, delete"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setModalState({ mode: "edit", template })}
                          className={dashboardStyles.expenseRowButton}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(template.id)}
                          className={`${dashboardStyles.expenseRowButton} ${dashboardStyles.expenseRowButtonDanger}`}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={dashboardStyles.pageSubtext}>Loading…</p>}
        {loadState === "error" && <p className={dashboardStyles.formError}>{loadError}</p>}
        {loadState === "loaded" && visible.length === 0 && (
          <p className={dashboardStyles.pageSubtext}>
            {search ? "No templates match your search." : "No templates yet. Create one for leads and one for clients to get started."}
          </p>
        )}
      </div>

      {modalState && (
        <EmailTemplateModal
          key={modalState.mode === "edit" ? modalState.template.id : "add"}
          initialTemplate={modalState.mode === "edit" ? modalState.template : undefined}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

function SentTab() {
  const [sends, setSends] = useState<EmailSend[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleCheckBounces() {
    setChecking(true);
    setCheckResult(null);
    try {
      const message = await checkBounces();
      setSends(await fetchSends());
      setCheckResult({ ok: true, message });
    } catch (caught) {
      setCheckResult({ ok: false, message: caught instanceof Error ? caught.message : "Couldn't check for bounces." });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchSends()
      .then((rows) => {
        if (cancelled) return;
        setSends(rows);
        setLoadState("loaded");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(caught instanceof Error ? caught.message : "Failed to load the sent emails.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = sends.filter((send) =>
    matchesSearch(search, [
      send.subject,
      send.templateName,
      ...send.recipients.flatMap((recipient) => [recipient.name, recipient.email]),
    ]),
  );

  return (
    <>
      <div className={styles.tabToolbar}>
        <TableSearchInput value={search} onChange={setSearch} label="Search sent emails" placeholder="Search subject, template or recipient…" />
        <button type="button" onClick={() => void handleCheckBounces()} disabled={checking} className={styles.smallButton}>
          {checking ? "Checking inbox…" : "Check for bounces"}
        </button>
      </div>
      <p className={dashboardStyles.formHint}>
        &quot;Sent&quot; means Titan accepted the email. If the recipient&apos;s server later returns it (address
        doesn&apos;t exist, inbox full), it changes to <strong>Bounced</strong>. Your inbox is checked every 10 minutes.
      </p>
      {checkResult && (
        <p role="status" className={checkResult.ok ? styles.testOk : styles.testFailed}>
          {checkResult.message}
        </p>
      )}

      <div className={dashboardStyles.tableWrap}>
        <table className={dashboardStyles.table}>
          <thead>
            <tr>
              <th className={dashboardStyles.tableHeadCell}>Sent on</th>
              <th className={dashboardStyles.tableHeadCell}>For</th>
              <th className={dashboardStyles.tableHeadCell}>Subject</th>
              <th className={dashboardStyles.tableHeadCell}>Template</th>
              <th className={dashboardStyles.tableHeadCell}>Result</th>
              <th className={dashboardStyles.tableHeadCell}>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((send) => (
              <Fragment key={send.id}>
                <tr className={dashboardStyles.tableRow}>
                  <td className={dashboardStyles.tableCell}>{formatDateTime(utc(send.createdAt))}</td>
                  <td className={dashboardStyles.tableCell}>
                    <AudiencePill audience={send.audience} />
                  </td>
                  <td className={`${dashboardStyles.tableCell} ${dashboardStyles.tableCellPrimary} ${dashboardStyles.databaseCellClip}`} title={send.subject}>
                    {send.subject}
                  </td>
                  <td className={dashboardStyles.tableCell}>{send.templateName || "—"}</td>
                  <td className={dashboardStyles.tableCell}>
                    {send.sentCount}/{send.total} sent
                    {send.failedCount > 0 && <span className={styles.failedText}> · {send.failedCount} failed</span>}
                    {send.bouncedCount > 0 && <span className={styles.failedText}> · {send.bouncedCount} bounced</span>}
                    {!send.done && " · sending…"}
                    {send.interrupted && <span className={styles.failedText}> · interrupted</span>}
                  </td>
                  <td className={dashboardStyles.tableCell}>
                    <button
                      type="button"
                      onClick={() => setExpandedId((current) => (current === send.id ? null : send.id))}
                      aria-expanded={expandedId === send.id}
                      className={dashboardStyles.expenseRowButton}
                    >
                      {expandedId === send.id ? "Hide" : "Details"}
                    </button>
                  </td>
                </tr>
                {expandedId === send.id && (
                  <tr>
                    <td colSpan={6} className={styles.sendDetailCell}>
                      {send.attachmentNames.length > 0 && (
                        <p className={styles.previewMeta}>Attachments: {send.attachmentNames.join(", ")}</p>
                      )}
                      <ul className={styles.sendRecipientList}>
                        {send.recipients.map((recipient) => (
                          <li key={recipient.contactId} className={styles.sendRecipientRow}>
                            <span className={`${styles.sendStatusDot} ${styles[`sendStatus_${recipient.status}`]}`} aria-hidden="true" />
                            <span className={styles.sendRecipientText}>
                              <span className={styles.recipientName}>{recipient.name}</span>
                              <span className={styles.recipientEmail}>{recipient.email}</span>
                              {recipient.error && <span className={styles.sendRecipientError}>{recipient.error}</span>}
                              {recipient.status === "sent" && !recipient.savedToSent && (
                                <span className={styles.sendRecipientError}>Not copied to the Titan Sent folder</span>
                              )}
                            </span>
                            <span className={styles.sendStatusLabel}>
                              {recipient.status === "sent" && recipient.sentAt
                                ? formatDateTime(utc(recipient.sentAt))
                                : RECIPIENT_STATUS_LABELS[recipient.status]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={dashboardStyles.pageSubtext}>Loading…</p>}
        {loadState === "error" && <p className={dashboardStyles.formError}>{loadError}</p>}
        {loadState === "loaded" && visible.length === 0 && (
          <p className={dashboardStyles.pageSubtext}>{search ? "Nothing matches your search." : "Nothing sent from the app yet."}</p>
        )}
      </div>
    </>
  );
}

function SignatureTab() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<EmailSignature | null>(null);
  const [html, setHtml] = useState("");
  const [showLogo, setShowLogo] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSignature(), fetchSignatureLogoUrl().catch(() => null)])
      .then(([signature, url]) => {
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        setSaved(signature);
        setHtml(signature.html);
        setShowLogo(signature.showLogo);
        setLogoUrl(url);
        setLoadState("loaded");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(caught instanceof Error ? caught.message : "Failed to load the signature.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Object URLs hold the image in memory until revoked.
  useEffect(() => {
    return () => {
      if (logoUrl) URL.revokeObjectURL(logoUrl);
    };
  }, [logoUrl]);

  async function refreshLogo() {
    const url = await fetchSignatureLogoUrl().catch(() => null);
    setLogoUrl(url);
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const next = await saveSignature(isHtmlEmpty(html) ? "" : html, showLogo);
      setSaved(next);
      setMessage({ ok: true, text: "Signature saved." });
    } catch (caught) {
      setMessage({ ok: false, text: caught instanceof Error ? caught.message : "Couldn't save the signature." });
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoChange(action: () => Promise<EmailSignature>, done: string) {
    setLogoBusy(true);
    setMessage(null);
    try {
      const next = await action();
      // A logo change saves on its own; keep any unsaved text edits.
      setSaved((current) => (current ? { ...current, showLogo: next.showLogo, hasCustomLogo: next.hasCustomLogo } : next));
      setShowLogo(next.showLogo);
      await refreshLogo();
      setMessage({ ok: true, text: done });
    } catch (caught) {
      setMessage({ ok: false, text: caught instanceof Error ? caught.message : "Couldn't change the logo." });
    } finally {
      setLogoBusy(false);
    }
  }

  if (loadState === "loading") return <p className={dashboardStyles.pageSubtext}>Loading…</p>;
  if (loadState === "error" || !saved) return <p className={dashboardStyles.formError}>{loadError}</p>;

  const dirty = html !== saved.html || showLogo !== saved.showLogo;

  return (
    <div className={styles.signatureCard}>
      <p className={dashboardStyles.formHint}>
        Added to the end of every email sent from the app. You can leave it off for a single email when composing.
        Press <strong>Shift+Enter</strong> for a new line without a gap.
      </p>
      <RichTextEditor
        initialHtml={saved.html}
        onChange={(value) => {
          setHtml(value);
          setMessage(null);
        }}
        disabled={saving}
        label="Email signature"
        placeholder="Regards, your name, phone, website…"
        minHeight="8rem"
      />

      <div className={styles.logoPanel}>
        <div className={styles.logoPreviewBox}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a blob: URL, not an optimisable asset
            <img src={logoUrl} alt="Signature logo" className={`${styles.logoPreview} ${showLogo ? "" : styles.logoPreviewOff}`} />
          ) : (
            <span className={dashboardStyles.formHint}>No preview</span>
          )}
        </div>
        <div className={styles.logoControls}>
          <label className={dashboardStyles.formCheckboxField}>
            <input
              type="checkbox"
              checked={showLogo}
              onChange={(event) => {
                setShowLogo(event.target.checked);
                setMessage(null);
              }}
              className={dashboardStyles.selectCheckbox}
              disabled={saving || logoBusy}
            />
            <span className={dashboardStyles.formCheckboxText}>
              <span>Show logo under the signature</span>
              <span className={dashboardStyles.formCheckboxHint}>
                {saved.hasCustomLogo ? "Your uploaded logo." : "The Handpikd logo."} It&apos;s embedded in the email, so it
                shows without the recipient allowing images.
              </span>
            </span>
          </label>
          <div className={styles.logoButtons}>
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={logoBusy || saving}
              className={styles.smallButton}
            >
              {logoBusy ? "Working…" : "Upload a different logo"}
            </button>
            {saved.hasCustomLogo && (
              <button
                type="button"
                onClick={() => void handleLogoChange(resetSignatureLogo, "Back to the Handpikd logo.")}
                disabled={logoBusy || saving}
                className={styles.smallButton}
              >
                Use the Handpikd logo
              </button>
            )}
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleLogoChange(() => uploadSignatureLogo(file), "Logo updated.");
            }}
          />
        </div>
      </div>

      <div className={styles.signatureActions}>
        {message && (
          <span role="status" className={message.ok ? styles.testOk : styles.testFailed}>
            {message.text}
          </span>
        )}
        <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save signature"}
        </Button>
      </div>
    </div>
  );
}
