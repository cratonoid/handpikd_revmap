"use client";

// ---------------------------------------------------------------------------
// <WorkBoardPageClient> — /admin/work-board
// ---------------------------------------------------------------------------
// The team's own stories with tasks under them (lib/work-board.ts). The list
// shows each story's status, owner and task progress; opening one edits the
// story and its tasks in place: a task's status and assignee change straight
// from their dropdowns. ?story=<id> opens one directly, which is where the
// "assigned to you" notification links. Not client Tickets.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/button";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import { XMarkIcon } from "@/components/icons";
import { formatDateTime } from "@/lib/format-date";
import {
  addTask,
  createStory,
  fetchStories,
  fetchTeamMembers,
  updateStory,
  updateTask,
  WORK_STATUS_OPTIONS,
  workStatusLabel,
  type TeamMember,
  type WorkStatus,
  type WorkStory,
} from "@/lib/work-board";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded" | "failed";

const STATUS_COLOR: Record<WorkStatus, string> = {
  new: styles.statusNew,
  active: styles.statusProcessing,
  completed: styles.statusCompleted,
};

// Status tabs; "open" is New + Active.
type Filter = "open" | WorkStatus | "all";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "new", label: "New" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

const UNASSIGNED = "unassigned";

// Backend datetimes are naive UTC.
function utc(value: string): string {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

function AssigneeSelect({
  id,
  label,
  value,
  members,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number | null;
  members: TeamMember[];
  onChange: (value: number | null) => void;
  disabled: boolean;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value === null ? "" : String(value)}
      onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      className={styles.formInput}
      disabled={disabled}
    >
      <option value="">Unassigned</option>
      {members.map((member) => (
        <option key={member.id} value={String(member.id)}>
          {member.name}
        </option>
      ))}
    </select>
  );
}

function StatusSelect({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: WorkStatus;
  onChange: (value: WorkStatus) => void;
  disabled: boolean;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as WorkStatus)}
      className={styles.formInput}
      disabled={disabled}
    >
      {WORK_STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function WorkBoardPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [stories, setStories] = useState<WorkStory[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<Filter>("open");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchStories(), fetchTeamMembers()])
      .then(([storyData, memberData]) => {
        if (cancelled) return;
        setStories(storyData);
        setMembers(memberData);
        setLoadState("loaded");
      })
      .catch(() => {
        if (!cancelled) setLoadState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const linked = searchParams.get("story");
  useEffect(() => {
    const id = Number(linked);
    if (linked && Number.isInteger(id) && id > 0) {
      queueMicrotask(() => setOpenId(id));
    }
  }, [linked]);

  const upsert = useCallback((saved: WorkStory) => {
    setStories((previous) => [saved, ...previous.filter((story) => story.id !== saved.id)]);
  }, []);

  const remove = useCallback((id: number) => {
    setStories((previous) => previous.filter((story) => story.id !== id));
  }, []);

  function closeDetail() {
    setOpenId(null);
    if (linked) router.replace(pathname);
  }

  // A story matches an assignee if it, or any of its tasks, is theirs.
  function matchesAssignee(story: WorkStory): boolean {
    if (assigneeFilter === "") return true;
    if (assigneeFilter === UNASSIGNED) return story.assignedUserId === null;
    const id = Number(assigneeFilter);
    return story.assignedUserId === id || story.tasks.some((task) => task.assignedUserId === id);
  }

  const visible = stories
    .filter((story) =>
      filter === "all" ? true : filter === "open" ? story.status !== "completed" : story.status === filter,
    )
    .filter(matchesAssignee)
    .filter((story) =>
      matchesSearch(search, [story.title, story.description, story.assignedUserName, ...story.tasks.map((t) => t.title)]),
    );

  const openStory = stories.find((story) => story.id === openId) ?? null;

  return (
    <>
      <div className={styles.pageHeaderWithTabs}>
        <h1 className={styles.pageHeading}>Work board</h1>
        <div className={styles.viewToggle} role="tablist" aria-label="Story status">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={`${styles.viewToggleButton} ${filter === option.value ? styles.viewToggleButtonActive : ""}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className={styles.pageHeaderAction}>
          <Button type="button" variant="primary" onClick={() => setCreating(true)} disabled={loadState !== "loaded"}>
            + New story
          </Button>
        </div>
      </div>

      <p className={styles.pageSubtext}>The team&apos;s own stories and the tasks under them. Open a story to manage its tasks.</p>

      <div className={styles.filterToggleRow}>
        <TableSearchInput value={search} onChange={setSearch} label="Search stories" placeholder="Search stories or tasks…" />
        <select
          aria-label="Filter by assignee"
          value={assigneeFilter}
          onChange={(event) => setAssigneeFilter(event.target.value)}
          className={styles.formInput}
        >
          <option value="">Everyone</option>
          {members.map((member) => (
            <option key={member.id} value={String(member.id)}>
              {member.name}
            </option>
          ))}
          <option value={UNASSIGNED}>Unassigned stories</option>
        </select>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>#</th>
              <th className={styles.tableHeadCell}>Story</th>
              <th className={styles.tableHeadCell}>Assigned to</th>
              <th className={styles.tableHeadCell}>Status</th>
              <th className={styles.tableHeadCell}>Tasks done</th>
              <th className={styles.tableHeadCell}>Last update</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((story) => (
              <tr key={story.id} onClick={() => setOpenId(story.id)} className={styles.tableRow}>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>#{story.id}</td>
                <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={story.title}>
                  {story.title}
                </td>
                <td className={styles.tableCell}>{story.assignedUserName || "—"}</td>
                <td className={`${styles.tableCell} ${styles.statusText} ${STATUS_COLOR[story.status]}`}>
                  {workStatusLabel(story.status)}
                </td>
                <td className={styles.tableCell}>
                  {story.tasks.length === 0
                    ? "—"
                    : `${story.tasks.filter((task) => task.status === "completed").length} / ${story.tasks.length}`}
                </td>
                <td className={styles.tableCell}>{formatDateTime(utc(story.updatedAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {loadState === "loading" && <p className={styles.pageSubtext}>Loading the work board…</p>}
        {loadState === "failed" && (
          <p role="alert" className={styles.formError}>
            Couldn&apos;t load the work board. Please refresh the page or try again shortly.
          </p>
        )}
        {loadState === "loaded" && visible.length === 0 && (
          <p className={styles.pageSubtext}>
            {stories.length === 0 ? "No stories yet. Add one with + New story." : "No stories in this view."}
          </p>
        )}
      </div>

      {creating && (
        <NewStoryModal
          members={members}
          onClose={() => setCreating(false)}
          onSaved={(story) => {
            upsert(story);
            setCreating(false);
            setOpenId(story.id);
          }}
        />
      )}

      {openStory && (
        <StoryModal
          key={openStory.id}
          story={openStory}
          members={members}
          onSaved={upsert}
          onDeleted={() => {
            remove(openStory.id);
            closeDetail();
          }}
          onClose={closeDetail}
        />
      )}
    </>
  );
}

function NewStoryModal({
  members,
  onClose,
  onSaved,
}: {
  members: TeamMember[];
  onClose: () => void;
  onSaved: (story: WorkStory) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<WorkStatus>("new");
  const [assignee, setAssignee] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return setError("Enter a title.");
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await createStory({ title: title.trim(), description: description.trim(), status, assignedUserId: assignee }),
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
        aria-labelledby="new-story-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="new-story-title" className={styles.modalTitle}>
            New story
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className={styles.modalForm} noValidate>
          <div className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="storyTitle" className={styles.formLabel}>
                Title<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="storyTitle"
                type="text"
                autoFocus
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={styles.formInput}
                disabled={saving}
              />
            </div>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="storyDescription" className={styles.formLabel}>
                Description
              </label>
              <textarea
                id="storyDescription"
                rows={3}
                maxLength={5000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className={styles.formTextarea}
                disabled={saving}
              />
            </div>
            <div>
              <label htmlFor="storyStatus" className={styles.formLabel}>
                Status
              </label>
              <StatusSelect id="storyStatus" label="Status" value={status} onChange={setStatus} disabled={saving} />
            </div>
            <div>
              <label htmlFor="storyAssignee" className={styles.formLabel}>
                Assign to
              </label>
              <AssigneeSelect
                id="storyAssignee"
                label="Assign to"
                value={assignee}
                members={members}
                onChange={setAssignee}
                disabled={saving}
              />
            </div>
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
                {saving ? "Saving…" : "Create story"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function StoryModal({
  story,
  members,
  onSaved,
  onDeleted,
  onClose,
}: {
  story: WorkStory;
  members: TeamMember[];
  onSaved: (story: WorkStory) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(story.title);
  const [description, setDescription] = useState(story.description);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<WorkStory | null>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      const saved = await action();
      if (saved) onSaved(saved);
      after?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const textChanged = title.trim() !== story.title || description.trim() !== story.description;

  function saveText() {
    if (!title.trim()) return setError("Enter a title.");
    void run(() => updateStory(story.id, { title: title.trim(), description: description.trim() }));
  }

  function handleAddTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTaskTitle.trim()) return setError("Enter a task title.");
    void run(
      () => addTask(story.id, { title: newTaskTitle.trim(), assignedUserId: newTaskAssignee }),
      () => {
        setNewTaskTitle("");
        setNewTaskAssignee(null);
      },
    );
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-title"
        className={styles.modalPanelWide}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="story-title" className={styles.modalTitle}>
            Story #{story.id}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="editStoryTitle" className={styles.formLabel}>
                Title
              </label>
              <input
                id="editStoryTitle"
                type="text"
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={styles.formInput}
                disabled={busy}
              />
            </div>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="editStoryDescription" className={styles.formLabel}>
                Description
              </label>
              <textarea
                id="editStoryDescription"
                rows={3}
                maxLength={5000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className={styles.formTextarea}
                disabled={busy}
              />
            </div>
            <div>
              <label htmlFor="editStoryStatus" className={styles.formLabel}>
                Status
              </label>
              <StatusSelect
                id="editStoryStatus"
                label="Story status"
                value={story.status}
                onChange={(status) => void run(() => updateStory(story.id, { status }))}
                disabled={busy}
              />
            </div>
            <div>
              <label htmlFor="editStoryAssignee" className={styles.formLabel}>
                Assigned to
              </label>
              <AssigneeSelect
                id="editStoryAssignee"
                label="Story assignee"
                value={story.assignedUserId}
                members={members}
                onChange={(assignedUserId) => void run(() => updateStory(story.id, { assignedUserId }))}
                disabled={busy}
              />
            </div>
            {textChanged && (
              <div className={`${styles.formGridFullSpan} ${styles.modalActionsRight}`}>
                <Button type="button" variant="primary" onClick={saveText} disabled={busy}>
                  Save title &amp; description
                </Button>
              </div>
            )}
          </div>

          <h3 className={styles.formLabel}>Tasks</h3>
          {story.tasks.length === 0 ? (
            <p className={styles.formHint}>No tasks yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.tableHeadCell}>Task</th>
                    <th className={styles.tableHeadCell}>Status</th>
                    <th className={styles.tableHeadCell}>Assigned to</th>
                    <th className={styles.tableHeadCell} aria-label="Delete" />
                  </tr>
                </thead>
                <tbody>
                  {story.tasks.map((task) => (
                    <tr key={task.id}>
                      <td className={styles.tableCell}>{task.title}</td>
                      <td className={styles.tableCell}>
                        <StatusSelect
                          id={`task-${task.id}-status`}
                          label={`Status of ${task.title}`}
                          value={task.status}
                          onChange={(status) => void run(() => updateTask(story.id, task.id, { status }))}
                          disabled={busy}
                        />
                      </td>
                      <td className={styles.tableCell}>
                        <AssigneeSelect
                          id={`task-${task.id}-assignee`}
                          label={`Assignee of ${task.title}`}
                          value={task.assignedUserId}
                          members={members}
                          onChange={(assignedUserId) =>
                            void run(() => updateTask(story.id, task.id, { assignedUserId }))
                          }
                          disabled={busy}
                        />
                      </td>
                      <td className={styles.tableCell}>
                        <button
                          type="button"
                          onClick={() => void run(() => updateTask(story.id, task.id, { delete: true }))}
                          disabled={busy}
                          aria-label={`Delete task ${task.title}`}
                          className={styles.modalCloseButton}
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form onSubmit={handleAddTask} noValidate className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="newTaskTitle" className={styles.formLabel}>
                New task
              </label>
              <input
                id="newTaskTitle"
                type="text"
                maxLength={200}
                placeholder="e.g. Get hamper samples photographed"
                value={newTaskTitle}
                onChange={(event) => setNewTaskTitle(event.target.value)}
                className={styles.formInput}
                disabled={busy}
              />
            </div>
            <div>
              <AssigneeSelect
                id="newTaskAssignee"
                label="New task assignee"
                value={newTaskAssignee}
                members={members}
                onChange={setNewTaskAssignee}
                disabled={busy}
              />
            </div>
            <div>
              <Button type="submit" variant="secondary" disabled={busy}>
                + Add task
              </Button>
            </div>
          </form>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsLeft}>
              {confirmingDelete ? (
                <>
                  <span className={styles.formHint}>Delete this story and all its tasks?</span>{" "}
                  <button
                    type="button"
                    onClick={() => void run(() => updateStory(story.id, { delete: true }), onDeleted)}
                    disabled={busy}
                    className={`${styles.triggerButtonBase} ${styles.deleteTriggerButton}`}
                  >
                    Yes, delete
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={busy}
                  className={`${styles.triggerButtonBase} ${styles.deleteTriggerButton}`}
                >
                  Delete story
                </button>
              )}
            </div>
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onClose} disabled={busy}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
