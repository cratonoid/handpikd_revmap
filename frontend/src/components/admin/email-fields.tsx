"use client";

// ---------------------------------------------------------------------------
// Shared pieces of the email template and compose forms
// ---------------------------------------------------------------------------
// <PlaceholderBar> inserts a {{field}} into whichever of subject/body was
// focused last; <FileDropZone> takes files by drag-and-drop or picker; and
// <AttachmentChip> shows one attached file with an optional remove button.
import { useRef, useState, type RefObject } from "react";
import type { RichTextEditorHandle } from "@/components/admin/rich-text-editor";
import { formatFileSize, PLACEHOLDER_FIELDS, type EmailAudience } from "@/lib/emails";
import styles from "@/styles/emails.module.css";

export type PlaceholderTarget = "subject" | "body";

export function insertIntoInput(input: HTMLInputElement, text: string, value: string, setValue: (next: string) => void) {
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  setValue(next);
  // Put the caret after the inserted text once React has re-rendered.
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(start + text.length, start + text.length);
  });
}

export function PlaceholderBar({
  audience,
  target,
  subjectRef,
  subject,
  setSubject,
  editorRef,
  disabled,
}: {
  audience: EmailAudience;
  target: PlaceholderTarget;
  subjectRef: RefObject<HTMLInputElement | null>;
  subject: string;
  setSubject: (next: string) => void;
  editorRef: RefObject<RichTextEditorHandle | null>;
  disabled?: boolean;
}) {
  function insert(key: string) {
    const token = `{{${key}}}`;
    if (target === "subject" && subjectRef.current) {
      insertIntoInput(subjectRef.current, token, subject, setSubject);
    } else {
      editorRef.current?.insertText(token);
    }
  }

  return (
    <div className={styles.placeholderBar}>
      <span className={styles.placeholderBarLabel}>
        Insert into {target === "subject" ? "subject" : "message"}:
      </span>
      {PLACEHOLDER_FIELDS[audience].map((field) => (
        <button
          key={field.key}
          type="button"
          disabled={disabled}
          // mousedown keeps the caret where it was in the subject/editor.
          onMouseDown={(event) => {
            event.preventDefault();
            insert(field.key);
          }}
          className={styles.placeholderChip}
        >
          {field.label}
        </button>
      ))}
    </div>
  );
}

export function FileDropZone({
  onFiles,
  disabled,
  hint,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ""}`}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled && event.dataTransfer.files.length > 0) {
          onFiles(Array.from(event.dataTransfer.files));
        }
      }}
    >
      <span>Drop files here or</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={styles.smallButton}
      >
        Choose files
      </button>
      {hint && <span className={styles.dropZoneHint}>{hint}</span>}
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Reset so picking the same file again still fires onChange.
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}

export function AttachmentChip({
  filename,
  size,
  note,
  onRemove,
  disabled,
}: {
  filename: string;
  size: number;
  note?: string;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <li className={styles.attachmentChip}>
      <span className={styles.attachmentName} title={filename}>
        📎 {filename}
      </span>
      <span className={styles.attachmentMeta}>
        {formatFileSize(size)}
        {note ? ` · ${note}` : ""}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${filename}`}
          className={styles.attachmentRemove}
        >
          ×
        </button>
      )}
    </li>
  );
}
