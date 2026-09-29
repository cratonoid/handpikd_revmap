"use client";

// ---------------------------------------------------------------------------
// <EmailComposeModal> — write and send an email to one or more contacts
// ---------------------------------------------------------------------------
// Opened from the Leads or Clients tab of /admin/database with the chosen
// rows. Only templates written for that audience are offered, so a client
// can't be sent a lead template. Picking one fills in the subject, message
// and default attachments, all of which can then be changed for this send
// only — the template itself is untouched. Files can also be added on the
// spot.
//
// With several recipients, each gets their own copy with their own details
// filled in (never a shared To/CC line). The server sends them one at a
// time in the background; this modal polls the send and shows each
// recipient's result. Closing mid-way doesn't stop it — the full record is
// on the Sent tab of /admin/emails.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import { AttachmentChip, FileDropZone, PlaceholderBar, type PlaceholderTarget } from "@/components/admin/email-fields";
import { isHtmlEmpty, RichTextEditor, type RichTextEditorHandle } from "@/components/admin/rich-text-editor";
import type { Contact } from "@/lib/database-contacts";
import {
  AUDIENCE_LABELS,
  fetchEmailStatus,
  fetchSend,
  fetchSignature,
  fetchTemplates,
  fillPlaceholders,
  formatFileSize,
  placeholderValues,
  sendEmail,
  type EmailAudience,
  type EmailSend,
  type EmailStatus,
  type EmailTemplate,
} from "@/lib/emails";
import dashboardStyles from "@/styles/dashboard.module.css";
import styles from "@/styles/emails.module.css";

// Matches _MAX_SEND_ATTACHMENT_BYTES in backend/app/api/routes/emails.py.
const MAX_SEND_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const POLL_INTERVAL_MS = 2000;

type LoadState = "loading" | "loaded" | "error";

export function EmailComposeModal({
  audience,
  recipients: initialRecipients,
  onClose,
}: {
  audience: EmailAudience;
  // Only contacts with an email address; the Database page filters.
  recipients: Contact[];
  // `sent` is true once at least one email went out, so the caller can
  // refresh the rows it changed (a lead flips to "sent" with Mail ticked).
  onClose: (sent: boolean) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [signature, setSignature] = useState("");

  const [recipients, setRecipients] = useState<Contact[]>(initialRecipients);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  // Bumped to remount the editor when a template replaces its content.
  const [editorKey, setEditorKey] = useState(0);
  const [templateAttachmentIds, setTemplateAttachmentIds] = useState<number[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [target, setTarget] = useState<PlaceholderTarget>("body");
  const [confirmingBulk, setConfirmingBulk] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [send, setSend] = useState<EmailSend | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);

  const labels = AUDIENCE_LABELS[audience];
  const audienceTemplates = templates.filter((template) => template.audience === audience);
  const template = audienceTemplates.find((option) => option.id === templateId) ?? null;
  const chosenTemplateAttachments = (template?.attachments ?? []).filter((attachment) =>
    templateAttachmentIds.includes(attachment.id),
  );
  const attachmentBytes =
    chosenTemplateAttachments.reduce((total, attachment) => total + attachment.size, 0) +
    files.reduce((total, file) => total + file.size, 0);
  const overBulkLimit = status !== null && recipients.length > status.bulkLimit;

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchEmailStatus(), fetchTemplates(), fetchSignature()])
      .then(([nextStatus, nextTemplates, nextSignature]) => {
        if (cancelled) return;
        setStatus(nextStatus);
        setTemplates(nextTemplates);
        setSignature(nextSignature);
        setLoadState("loaded");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(caught instanceof Error ? caught.message : "Couldn't load the email settings.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Polls the running send until the server marks it done.
  const sendId = send?.id;
  const sendDone = send?.done ?? false;
  useEffect(() => {
    if (sendId === undefined || sendDone) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchSend(sendId)
        .then((next) => {
          if (!cancelled) setSend(next);
        })
        .catch(() => {
          // A missed poll is harmless; bump state so the effect re-arms.
          if (!cancelled) setSend((current) => (current ? { ...current } : current));
        });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sendId, sendDone, send]);

  function chooseTemplate(nextId: number | null) {
    setTemplateId(nextId);
    const next = audienceTemplates.find((option) => option.id === nextId);
    setSubject(next?.subject ?? "");
    setBodyHtml(next?.bodyHtml ?? "");
    setTemplateAttachmentIds(next?.attachments.map((attachment) => attachment.id) ?? []);
    setEditorKey((key) => key + 1);
    setConfirmingBulk(false);
    setError(null);
  }

  function handleClose() {
    onClose((send?.sentCount ?? 0) > 0 || (send !== null && !send.done));
  }

  async function handleSend() {
    if (recipients.length === 0) {
      setError("Add at least one recipient.");
      return;
    }
    if (!subject.trim()) {
      setError("Enter a subject.");
      return;
    }
    if (isHtmlEmpty(bodyHtml)) {
      setError("Write the message.");
      return;
    }
    if (attachmentBytes > MAX_SEND_ATTACHMENT_BYTES) {
      setError("Attachments add up to more than 20MB. Remove some, or send a link to large files instead.");
      return;
    }
    if (recipients.length > 1 && !confirmingBulk) {
      setConfirmingBulk(true);
      setError(null);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const started = await sendEmail({
        audience,
        contactIds: recipients.map((recipient) => recipient.id),
        templateId,
        subject: subject.trim(),
        bodyHtml,
        templateAttachmentIds,
        includeSignature,
        files,
      });
      setSend(started);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't send the email. Please try again.");
      setConfirmingBulk(false);
    } finally {
      setSubmitting(false);
    }
  }

  const previewRecipient = recipients[0];
  const previewValues = previewRecipient
    ? placeholderValues(previewRecipient.name, previewRecipient.contactPerson)
    : placeholderValues("", "");

  const title =
    recipients.length === 1
      ? `Email ${recipients[0].contactPerson || recipients[0].name}`
      : `Email ${recipients.length} ${labels.plural.toLowerCase()}`;

  return (
    <div className={dashboardStyles.modalBackdrop} onClick={send && !send.done ? undefined : handleClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-compose-title"
        className={`${dashboardStyles.modalPanel} ${styles.wideModalPanel}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={dashboardStyles.modalHeader}>
          <h2 id="email-compose-title" className={dashboardStyles.modalTitle}>
            {send ? (send.done ? "Sending finished" : "Sending…") : title}
          </h2>
          <button type="button" onClick={handleClose} aria-label="Close" className={dashboardStyles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {send ? (
          <SendProgress send={send} onClose={handleClose} />
        ) : loadState === "loading" ? (
          <p className={`${dashboardStyles.pageSubtext} ${styles.modalBodyPad}`}>Loading…</p>
        ) : loadState === "error" ? (
          <p className={`${dashboardStyles.formError} ${styles.modalBodyPad}`}>{loadError}</p>
        ) : (
          <div className={dashboardStyles.modalForm}>
            {status && !status.configured && (
              <p className={styles.noticeWarning}>
                Email isn&apos;t set up yet. Add <code>SMTP_USER</code> and <code>SMTP_PASSWORD</code> (your Titan
                address and password) to the backend <code>.env</code>, then restart it.
              </p>
            )}

            <div className={dashboardStyles.formGrid}>
              <div className={dashboardStyles.formGridFullSpan}>
                <span className={dashboardStyles.formLabel}>
                  To · {recipients.length} {recipients.length === 1 ? labels.singular.toLowerCase() : labels.plural.toLowerCase()}
                </span>
                <ul className={styles.recipientList}>
                  {recipients.map((recipient) => (
                    <li key={recipient.id} className={styles.recipientChip} title={recipient.email}>
                      <span className={styles.recipientName}>{recipient.contactPerson || recipient.name}</span>
                      <span className={styles.recipientEmail}>{recipient.email}</span>
                      {recipients.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setRecipients((current) => current.filter((row) => row.id !== recipient.id));
                            setConfirmingBulk(false);
                          }}
                          disabled={submitting}
                          aria-label={`Remove ${recipient.name}`}
                          className={styles.attachmentRemove}
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {recipients.length > 1 && (
                  <p className={dashboardStyles.formHint}>
                    Each {labels.singular.toLowerCase()} gets their own email with their details filled in. They
                    won&apos;t see each other.
                  </p>
                )}
                {overBulkLimit && status && (
                  <p className={dashboardStyles.formError}>
                    At most {status.bulkLimit} emails can go out in one send. Remove {recipients.length - status.bulkLimit}{" "}
                    or send in batches.
                  </p>
                )}
              </div>

              <div className={dashboardStyles.formGridFullSpan}>
                <label htmlFor="composeTemplate" className={dashboardStyles.formLabel}>
                  Template
                </label>
                <select
                  id="composeTemplate"
                  value={templateId ?? ""}
                  onChange={(event) => chooseTemplate(event.target.value ? Number(event.target.value) : null)}
                  className={dashboardStyles.formInput}
                  disabled={submitting}
                >
                  <option value="">Start from scratch</option>
                  {audienceTemplates.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                {audienceTemplates.length === 0 && (
                  <p className={dashboardStyles.formHint}>
                    No {labels.singular.toLowerCase()} templates yet. Create them on the Emails page.
                  </p>
                )}
              </div>

              <div className={dashboardStyles.formGridFullSpan}>
                <label htmlFor="composeSubject" className={dashboardStyles.formLabel}>
                  Subject<span className={dashboardStyles.requiredMark}>*</span>
                </label>
                <input
                  id="composeSubject"
                  ref={subjectRef}
                  type="text"
                  value={subject}
                  onFocus={() => setTarget("subject")}
                  onChange={(event) => setSubject(event.target.value)}
                  className={dashboardStyles.formInput}
                  disabled={submitting}
                />
              </div>

              <div className={dashboardStyles.formGridFullSpan}>
                <div className={styles.labelRow}>
                  <span className={dashboardStyles.formLabel}>
                    Message<span className={dashboardStyles.requiredMark}>*</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreviewing((open) => !open)}
                    className={styles.smallButton}
                    disabled={!previewRecipient}
                  >
                    {previewing ? "Back to editing" : "Preview"}
                  </button>
                </div>

                {previewing && previewRecipient ? (
                  <div className={styles.preview}>
                    <p className={styles.previewMeta}>
                      As {previewRecipient.contactPerson || previewRecipient.name} will see it
                      {recipients.length > 1 ? ` (and ${recipients.length - 1} more, each with their own details)` : ""}
                    </p>
                    <p className={styles.previewSubject}>{fillPlaceholders(subject, previewValues, false) || "(no subject)"}</p>
                    <div
                      className={styles.previewBody}
                      // The body and signature have already been through
                      // sanitizeEmailHtml in the editor.
                      dangerouslySetInnerHTML={{
                        __html:
                          fillPlaceholders(bodyHtml, previewValues, true) +
                          (includeSignature && !isHtmlEmpty(signature)
                            ? `<div class="${styles.previewSignature}">${signature}</div>`
                            : ""),
                      }}
                    />
                  </div>
                ) : (
                  <>
                    <div onFocus={() => setTarget("body")}>
                      <RichTextEditor
                        key={editorKey}
                        ref={editorRef}
                        initialHtml={bodyHtml}
                        onChange={setBodyHtml}
                        disabled={submitting}
                        label="Message"
                      />
                    </div>
                    <PlaceholderBar
                      audience={audience}
                      target={target}
                      subjectRef={subjectRef}
                      subject={subject}
                      setSubject={setSubject}
                      editorRef={editorRef}
                      disabled={submitting}
                    />
                  </>
                )}
              </div>

              <div className={dashboardStyles.formGridFullSpan}>
                <label className={dashboardStyles.formCheckboxField}>
                  <input
                    type="checkbox"
                    checked={includeSignature}
                    onChange={(event) => setIncludeSignature(event.target.checked)}
                    className={dashboardStyles.selectCheckbox}
                    disabled={submitting}
                  />
                  <span className={dashboardStyles.formCheckboxText}>
                    <span>Add my signature</span>
                    {isHtmlEmpty(signature) && (
                      <span className={dashboardStyles.formCheckboxHint}>
                        No signature saved yet. Set one on the Emails page.
                      </span>
                    )}
                  </span>
                </label>
              </div>

              <div className={dashboardStyles.formGridFullSpan}>
                <span className={dashboardStyles.formLabel}>Attachments</span>
                {(chosenTemplateAttachments.length > 0 || files.length > 0) && (
                  <ul className={styles.attachmentList}>
                    {chosenTemplateAttachments.map((attachment) => (
                      <AttachmentChip
                        key={`t-${attachment.id}`}
                        filename={attachment.filename}
                        size={attachment.size}
                        note="from template"
                        disabled={submitting}
                        onRemove={() =>
                          setTemplateAttachmentIds((current) => current.filter((id) => id !== attachment.id))
                        }
                      />
                    ))}
                    {files.map((file, index) => (
                      <AttachmentChip
                        key={`f-${file.name}-${index}`}
                        filename={file.name}
                        size={file.size}
                        disabled={submitting}
                        onRemove={() => setFiles((current) => current.filter((pending) => pending !== file))}
                      />
                    ))}
                  </ul>
                )}
                <FileDropZone
                  onFiles={(added) => setFiles((current) => [...current, ...added])}
                  disabled={submitting}
                  hint={`${formatFileSize(attachmentBytes)} of 20 MB used`}
                />
              </div>
            </div>

            {error && (
              <p role="alert" aria-live="polite" className={dashboardStyles.formError}>
                {error}
              </p>
            )}

            <div className={dashboardStyles.modalActions}>
              {confirmingBulk ? (
                <div className={styles.confirmBar}>
                  <span>
                    Send {recipients.length} separate emails from {status?.fromAddress || "your mailbox"}?
                  </span>
                  <div className={dashboardStyles.modalActionsRight}>
                    <Button type="button" variant="tertiary" onClick={() => setConfirmingBulk(false)} disabled={submitting}>
                      Back
                    </Button>
                    <Button type="button" variant="primary" onClick={() => void handleSend()} disabled={submitting}>
                      {submitting ? "Starting…" : `Yes, send ${recipients.length}`}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={dashboardStyles.modalActionsRight}>
                  <Button type="button" variant="tertiary" onClick={handleClose} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void handleSend()}
                    disabled={submitting || !status?.configured || overBulkLimit || recipients.length === 0}
                  >
                    {submitting
                      ? "Sending…"
                      : recipients.length === 1
                        ? "Send email"
                        : `Send to ${recipients.length} ${labels.plural.toLowerCase()}`}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SendProgress({ send, onClose }: { send: EmailSend; onClose: () => void }) {
  const finished = send.sentCount + send.failedCount;
  const notFiled = send.recipients.filter((recipient) => recipient.status === "sent" && !recipient.savedToSent).length;

  return (
    <div className={dashboardStyles.modalForm}>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={send.total}
        aria-valuenow={finished}
      >
        <div className={styles.progressFill} style={{ width: `${send.total ? (finished / send.total) * 100 : 0}%` }} />
      </div>
      <p className={styles.progressSummary}>
        {send.sentCount} of {send.total} sent
        {send.failedCount > 0 ? ` · ${send.failedCount} failed` : ""}
        {!send.done ? " · sending one at a time…" : ""}
      </p>
      {!send.done && (
        <p className={dashboardStyles.formHint}>
          You can close this. Sending carries on, and the results are on the Sent tab of the Emails page.
        </p>
      )}
      {send.done && notFiled > 0 && (
        <p className={styles.noticeWarning}>
          {notFiled} {notFiled === 1 ? "email was" : "emails were"} delivered but couldn&apos;t be copied to your Titan
          Sent folder.
        </p>
      )}

      <ul className={styles.sendRecipientList}>
        {send.recipients.map((recipient) => (
          <li key={recipient.contactId} className={styles.sendRecipientRow}>
            <span className={`${styles.sendStatusDot} ${styles[`sendStatus_${recipient.status}`]}`} aria-hidden="true" />
            <span className={styles.sendRecipientText}>
              <span className={styles.recipientName}>{recipient.name}</span>
              <span className={styles.recipientEmail}>{recipient.email}</span>
              {recipient.error && <span className={styles.sendRecipientError}>{recipient.error}</span>}
            </span>
            <span className={styles.sendStatusLabel}>
              {recipient.status === "sent" ? "Sent" : recipient.status === "failed" ? "Failed" : "Waiting"}
            </span>
          </li>
        ))}
      </ul>

      <div className={dashboardStyles.modalActions}>
        <div className={dashboardStyles.modalActionsRight}>
          <Button type="button" variant={send.done ? "primary" : "tertiary"} onClick={onClose}>
            {send.done ? "Done" : "Close"}
          </Button>
        </div>
      </div>
    </div>
  );
}
