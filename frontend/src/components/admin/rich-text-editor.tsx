"use client";

// ---------------------------------------------------------------------------
// <RichTextEditor> — the formatted-text box for email bodies and signatures
// ---------------------------------------------------------------------------
// A contentEditable div with a small toolbar (bold, italic, underline,
// bullet/numbered lists, links, clear formatting) — deliberately no more
// than mail clients render reliably, and no editor library to ship.
//
// Uncontrolled: the parent passes `initialHtml` once and hears every change
// through `onChange`. To load different content (another template picked),
// remount it with a new `key`.
//
// Everything that leaves the editor goes through sanitizeEmailHtml, so a
// paste from Word or a web page arrives as clean tags without the styles,
// classes and fonts that would otherwise ride along into the email.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import styles from "@/styles/emails.module.css";

export type RichTextEditorHandle = {
  // Inserts plain text at the caret (or at the end if the editor was never
  // focused) — used for the {{placeholder}} buttons.
  insertText: (text: string) => void;
};

const KEEP_TAGS = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "A"]);
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "HEAD", "META", "TITLE", "LINK", "IFRAME", "OBJECT", "svg"]);
const BLOCK_TAGS = new Set(["P", "DIV", "UL", "OL", "LI", "TABLE", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]);
const SAFE_HREF = /^(https?:|mailto:|tel:)/i;

function cleanChildren(source: Node, target: Node, doc: Document) {
  source.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ""));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const element = child as Element;
    const tag = element.tagName.toUpperCase();
    if (DROP_TAGS.has(tag) || DROP_TAGS.has(element.tagName)) return;

    if (KEEP_TAGS.has(tag)) {
      const copy = doc.createElement(tag.toLowerCase());
      if (tag === "A") {
        const href = element.getAttribute("href")?.trim() ?? "";
        if (!SAFE_HREF.test(href)) {
          cleanChildren(element, target, doc);
          return;
        }
        copy.setAttribute("href", href);
      }
      cleanChildren(element, copy, doc);
      target.appendChild(copy);
      return;
    }

    // Headings and plain divs become paragraphs — unless they wrap other
    // blocks, where a <p> would be invalid and only their contents count.
    const wrapsBlocks = Array.from(element.children).some((inner) => BLOCK_TAGS.has(inner.tagName.toUpperCase()));
    if (BLOCK_TAGS.has(tag) && tag !== "UL" && tag !== "OL" && tag !== "LI" && !wrapsBlocks && target.nodeName !== "P") {
      const paragraph = doc.createElement("p");
      cleanChildren(element, paragraph, doc);
      target.appendChild(paragraph);
      return;
    }
    // Anything else (span, font, table cells…) is unwrapped: its text stays,
    // the element and its styling go.
    cleanChildren(element, target, doc);
  });
}

export function sanitizeEmailHtml(html: string): string {
  if (typeof window === "undefined") return html;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const output = document.implementation.createHTMLDocument("");
  const container = output.createElement("div");
  cleanChildren(parsed.body, container, output);
  return container.innerHTML;
}

export function isHtmlEmpty(html: string): boolean {
  return html.replace(/<br\s*\/?>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

type Command = { command: string; label: string; title: string; className?: string };

const COMMANDS: Command[] = [
  { command: "bold", label: "B", title: "Bold (Ctrl+B)", className: styles.toolbarBold },
  { command: "italic", label: "I", title: "Italic (Ctrl+I)", className: styles.toolbarItalic },
  { command: "underline", label: "U", title: "Underline (Ctrl+U)", className: styles.toolbarUnderline },
  { command: "insertUnorderedList", label: "• List", title: "Bulleted list" },
  { command: "insertOrderedList", label: "1. List", title: "Numbered list" },
];

export function RichTextEditor({
  initialHtml,
  onChange,
  disabled = false,
  label,
  placeholder,
  minHeight = "12rem",
  ref,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  // Accessible name for the editing area.
  label: string;
  placeholder?: string;
  minHeight?: string;
  ref?: Ref<RichTextEditorHandle>;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [empty, setEmpty] = useState(() => isHtmlEmpty(initialHtml));

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = initialHtml;
    }
    // initialHtml is read once on mount by design — see the header comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emitChange() {
    const html = editorRef.current?.innerHTML ?? "";
    setEmpty(isHtmlEmpty(html));
    onChange(sanitizeEmailHtml(html));
  }

  function rememberSelection() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.anchorNode)) {
      savedRange.current = selection.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    if (savedRange.current) {
      selection.addRange(savedRange.current);
    } else {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.addRange(range);
    }
  }

  function run(command: string, value?: string) {
    if (disabled) return;
    restoreSelection();
    // execCommand is formally deprecated but remains the only way to edit
    // a contentEditable with native undo; every browser still supports it.
    document.execCommand("defaultParagraphSeparator", false, "p");
    document.execCommand(command, false, value);
    rememberSelection();
    emitChange();
  }

  useImperativeHandle(ref, () => ({
    insertText(text: string) {
      run("insertText", text);
    },
  }));

  function applyLink() {
    const url = linkUrl.trim();
    setLinkOpen(false);
    if (!SAFE_HREF.test(url) || url === "https://") return;
    const selection = savedRange.current;
    if (selection && !selection.collapsed) {
      run("createLink", url);
    } else {
      // Nothing selected: insert the address itself as the link text.
      const escaped = url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      run("insertHTML", `<a href="${escaped}">${escaped}</a>`);
    }
  }

  return (
    <div className={`${styles.editor} ${disabled ? styles.editorDisabled : ""}`}>
      <div className={styles.editorToolbar} role="toolbar" aria-label={`${label} formatting`}>
        {COMMANDS.map((item) => (
          <button
            key={item.command}
            type="button"
            title={item.title}
            aria-label={item.title}
            disabled={disabled}
            // mousedown, not click: a click would move focus off the editor
            // and lose the selection the command applies to.
            onMouseDown={(event) => {
              event.preventDefault();
              run(item.command);
            }}
            className={`${styles.toolbarButton} ${item.className ?? ""}`}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          title="Add link"
          aria-label="Add link"
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            rememberSelection();
            setLinkUrl("https://");
            setLinkOpen((open) => !open);
          }}
          className={styles.toolbarButton}
        >
          Link
        </button>
        <button
          type="button"
          title="Clear formatting"
          aria-label="Clear formatting"
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            run("removeFormat");
            run("unlink");
          }}
          className={styles.toolbarButton}
        >
          Clear
        </button>
      </div>

      {linkOpen && (
        <div className={styles.editorLinkRow}>
          <input
            type="url"
            autoFocus
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              } else if (event.key === "Escape") {
                setLinkOpen(false);
              }
            }}
            aria-label="Link address"
            className={styles.editorLinkInput}
          />
          <button type="button" onClick={applyLink} className={styles.smallButton}>
            Add
          </button>
          <button type="button" onClick={() => setLinkOpen(false)} className={styles.smallButton}>
            Cancel
          </button>
        </div>
      )}

      <div className={styles.editorAreaWrap}>
        {empty && placeholder && (
          <div className={styles.editorPlaceholder} aria-hidden="true">
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={emitChange}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
          onBlur={rememberSelection}
          onPaste={(event) => {
            event.preventDefault();
            const html = event.clipboardData.getData("text/html");
            if (html) {
              run("insertHTML", sanitizeEmailHtml(html));
            } else {
              run("insertText", event.clipboardData.getData("text/plain"));
            }
          }}
          className={styles.editorArea}
          style={{ minHeight }}
        />
      </div>
    </div>
  );
}
