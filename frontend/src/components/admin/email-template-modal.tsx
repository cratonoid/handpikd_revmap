"use client";

// ---------------------------------------------------------------------------
// <EmailTemplateModal> — add/edit popup for an email template
// ---------------------------------------------------------------------------
// Opened from the Templates tab of /admin/emails. Every template is written
// for one audience, picked here with no default, so choosing is a
// deliberate act; it can't be changed after saving, since the wording and
// placeholders were written for that kind of recipient. The compose screen
// only ever offers a template to recipients of its audience.
//
// Attachments saved on a template go out with it by default. New files are
// uploaded, and removed ones deleted, only once the template itself has
// saved — so cancelling leaves nothing half-stored.
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import { AttachmentChip, FileDropZone, PlaceholderBar, type PlaceholderTarget } from "@/components/admin/email-fields";
import { isHtmlEmpty, RichTextEditor, type RichTextEditorHandle } from "@/components/admin/rich-text-editor";
import {
  addTemplate,
  addTemplateAttachment,
  AUDIENCE_LABELS,
  removeTemplateAttachment,
  updateTemplate,
  type EmailAudience,
  type EmailTemplate,
} from "@/lib/emails";
import dashboardStyles from "@/styles/dashboard.module.css";
import styles from "@/styles/emails.module.css";

// Stored in the database — the backend refuses anything larger
// (_MAX_TEMPLATE_ATTACHMENT_BYTES in routes/emails.py).
const MAX_TEMPLATE_FILE_BYTES = 10 * 1024 * 1024;

export function EmailTemplateModal({
  initialTemplate,
  onClose,
  onSaved,
}: {
  // Present in edit mode, absent in add mode.
  initialTemplate?: EmailTemplate;
  onClose: () => void;
  onSaved: (template: EmailTemplate) => void;
}) {
  // Once the template row exists (edit mode, or an add whose attachment
  // upload then failed), further saves update it rather than add another.
  const [saved, setSaved] = useState<EmailTemplate | undefined>(initialTemplate);
  const [name, setName] = useState(initialTemplate?.name ?? "");
  const [audience, setAudience] = useState<EmailAudience | null>(initialTemplate?.audience ?? null);
  const [subject, setSubject] = useState(initialTemplate?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(initialTemplate?.bodyHtml ?? "");
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [target, setTarget] = useState<PlaceholderTarget>("body");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);

  // A template that saved before an attachment upload failed still exists,
  // so closing hands it back rather than leaving the list out of date.
  function handleClose() {
    if (saved && saved !== initialTemplate) {
      onSaved(saved);
    } else {
      onClose();
    }
  }

  const keptAttachments = (saved?.attachments ?? []).filter((attachment) => !removedIds.includes(attachment.id));

  function addFiles(files: File[]) {
    const tooBig = files.filter((file) => file.size > MAX_TEMPLATE_FILE_BYTES);
    if (tooBig.length > 0) {
      setError(
        `${tooBig.map((file) => file.name).join(", ")} ${tooBig.length === 1 ? "is" : "are"} over 10MB. ` +
          "Attach large files when sending instead.",
      );
    } else {
      setError(null);
    }
    setPendingFiles((current) => [...current, ...files.filter((file) => file.size <= MAX_TEMPLATE_FILE_BYTES)]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Give the template a name.");
      return;
    }
    if (!audience) {
      setError("Choose who this template is for.");
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

    setSaving(true);
    setError(null);
    try {
      let template = saved
        ? await updateTemplate(saved.id, { name: name.trim(), subject: subject.trim(), bodyHtml })
        : await addTemplate({ name: name.trim(), audience, subject: subject.trim(), bodyHtml });
      setSaved(template);

      for (const attachmentId of removedIds) {
        template = await removeTemplateAttachment(template.id, attachmentId);
        setSaved(template);
        setRemovedIds((current) => current.filter((id) => id !== attachmentId));
      }
      for (const file of pendingFiles) {
        template = await addTemplateAttachment(template.id, file);
        setSaved(template);
        setPendingFiles((current) => current.filter((pending) => pending !== file));
      }
      onSaved(template);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className={dashboardStyles.modalBackdrop} onClick={handleClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-template-modal-title"
        className={`${dashboardStyles.modalPanel} ${styles.wideModalPanel}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={dashboardStyles.modalHeader}>
          <h2 id="email-template-modal-title" className={dashboardStyles.modalTitle}>
            {initialTemplate ? "Edit template" : "New email template"}
          </h2>
          <button type="button" onClick={handleClose} aria-label="Close" className={dashboardStyles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={dashboardStyles.modalForm} noValidate>
          <div className={dashboardStyles.formGrid}>
            <div className={dashboardStyles.formGridFullSpan}>
              <label htmlFor="templateName" className={dashboardStyles.formLabel}>
                Template name<span className={dashboardStyles.requiredMark}>*</span>
              </label>
              <input
                id="templateName"
                type="text"
                autoFocus
                placeholder="e.g. Diwali hamper introduction"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={dashboardStyles.formInput}
                disabled={saving}
              />
            </div>

            <fieldset className={`${dashboardStyles.formGridFullSpan} ${styles.audienceFieldset}`}>
              <legend className={dashboardStyles.formLabel}>
                Who is it for?<span className={dashboardStyles.requiredMark}>*</span>
              </legend>
              <div className={styles.audienceOptions}>
                {(Object.keys(AUDIENCE_LABELS) as EmailAudience[]).map((option) => (
                  <label
                    key={option}
                    className={`${styles.audienceOption} ${audience === option ? styles.audienceOptionActive : ""} ${
                      saved ? styles.audienceOptionLocked : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="templateAudience"
                      value={option}
                      checked={audience === option}
                      onChange={() => setAudience(option)}
                      disabled={saving || saved !== undefined}
                      className={styles.audienceRadio}
                    />
                    <span className={styles.audienceOptionTitle}>{AUDIENCE_LABELS[option].plural}</span>
                    <span className={styles.audienceOptionHint}>
                      {option === "lead" ? "Outreach to prospects on the Leads tab" : "Emails to existing clients"}
                    </span>
                  </label>
                ))}
              </div>
              {saved && (
                <p className={dashboardStyles.formHint}>
                  A template&apos;s audience can&apos;t be changed. Make a new template for the other one.
                </p>
              )}
            </fieldset>

            <div className={dashboardStyles.formGridFullSpan}>
              <label htmlFor="templateSubject" className={dashboardStyles.formLabel}>
                Subject<span className={dashboardStyles.requiredMark}>*</span>
              </label>
              <input
                id="templateSubject"
                ref={subjectRef}
                type="text"
                value={subject}
                onFocus={() => setTarget("subject")}
                onChange={(event) => setSubject(event.target.value)}
                className={dashboardStyles.formInput}
                disabled={saving}
              />
            </div>

            <div className={dashboardStyles.formGridFullSpan}>
              <span className={dashboardStyles.formLabel}>
                Message<span className={dashboardStyles.requiredMark}>*</span>
              </span>
              <div onFocus={() => setTarget("body")}>
                <RichTextEditor
                  ref={editorRef}
                  initialHtml={bodyHtml}
                  onChange={setBodyHtml}
                  disabled={saving}
                  label="Message"
                  placeholder="Write the email. Your signature is added automatically when sending."
                />
              </div>
              {audience ? (
                <PlaceholderBar
                  audience={audience}
                  target={target}
                  subjectRef={subjectRef}
                  subject={subject}
                  setSubject={setSubject}
                  editorRef={editorRef}
                  disabled={saving}
                />
              ) : (
                <p className={dashboardStyles.formHint}>
                  Choose who it&apos;s for to insert personal fields like the contact&apos;s name.
                </p>
              )}
            </div>

            <div className={dashboardStyles.formGridFullSpan}>
              <span className={dashboardStyles.formLabel}>Default attachments</span>
              {(keptAttachments.length > 0 || pendingFiles.length > 0) && (
                <ul className={styles.attachmentList}>
                  {keptAttachments.map((attachment) => (
                    <AttachmentChip
                      key={attachment.id}
                      filename={attachment.filename}
                      size={attachment.size}
                      disabled={saving}
                      onRemove={() => setRemovedIds((current) => [...current, attachment.id])}
                    />
                  ))}
                  {pendingFiles.map((file, index) => (
                    <AttachmentChip
                      key={`${file.name}-${index}`}
                      filename={file.name}
                      size={file.size}
                      note="not saved yet"
                      disabled={saving}
                      onRemove={() => setPendingFiles((current) => current.filter((pending) => pending !== file))}
                    />
                  ))}
                </ul>
              )}
              <FileDropZone
                onFiles={addFiles}
                disabled={saving}
                hint="Up to 10MB each. Sent every time this template is used, and can be removed for a single send."
              />
            </div>
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={dashboardStyles.formError}>
              {error}
            </p>
          )}

          <div className={dashboardStyles.modalActions}>
            <div className={dashboardStyles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={handleClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : initialTemplate ? "Save changes" : "Save template"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
