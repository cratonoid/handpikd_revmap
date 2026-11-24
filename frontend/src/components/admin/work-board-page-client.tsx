"use client";

// ---------------------------------------------------------------------------
// <WorkBoardPageClient> — /admin/work-board
// ---------------------------------------------------------------------------
// The team's own stories with tasks under them (lib/work-board.ts). The list
// shows each story's status, owner and task progress; opening one edits the
// story and its tasks in place: a task's status and assignee change straight
// from their dropdowns. ?story=<id> opens one directly, which is where the
// "assigned to you" notification links. Not client Tickets.
//
// Tasks can have a deadline (overdue ones are flagged red), and Active tasks
// remind their assignee by phone every few hours once they've turned on
// phone alerts (<PhoneAlertsButton>).
//
// Stories belong to groups. People see their own groups' stories and can
// only assign a group's members; the Administrator sees every group and
// manages them (<ManageGroupsModal>).
//
// Two views of the same data: Stories (one row per story) and Tasks (every
// task of every visible story in one table, overdue first, then by deadline).
// The status tabs, group, assignee and search filters apply to whichever is
// showing: in the Tasks view they look at the task itself. A task's status
// and assignee change straight from the table; its story opens from the
// Story column.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/button";
import { PhoneAlertsButton } from "@/components/admin/phone-alerts-button";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import { XMarkIcon } from "@/components/icons";
import { fetchMyAccess } from "@/lib/access";
import { formatDateTime } from "@/lib/format-date";
import {
  addTask,
  createGroup,
  createStory,
  deadlineToInputValue,
  fetchGroups,
  fetchStories,
  fetchTeamMembers,
  inputValueToDeadline,
  isOverdue,
  updateGroup,
  updateStory,
  updateTask,
  utc,
  WORK_STATUS_OPTIONS,
  workStatusLabel,
  type TeamMember,
  type WorkGroup,
  type WorkStatus,
  type WorkStory,
  type WorkTask,
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

type View = "stories" | "tasks";
const VIEWS: { value: View; label: string }[] = [
  { value: "stories", label: "Stories" },
  { value: "tasks", label: "Tasks" },
];

type TaskRow = { task: WorkTask; story: WorkStory };

// Task ids are numbered per story (every story has a task 1), so a task is
// only unique across the board together with its story's id.
function taskKey(row: TaskRow): string {
  return `${row.story.id}-${row.task.id}`;
}

// Overdue first, then the nearest deadline, then tasks with no deadline;
// ties by story, then task, so the order is stable.
function byUrgency(a: TaskRow, b: TaskRow, now: number): number {
  const overdue = Number(isOverdue(b.task, now)) - Number(isOverdue(a.task, now));
  if (overdue !== 0) return overdue;
  const aTime = a.task.deadline ? new Date(a.task.deadline).getTime() : Infinity;
  const bTime = b.task.deadline ? new Date(b.task.deadline).getTime() : Infinity;
  if (aTime !== bTime) return aTime - bTime;
  return a.story.id - b.story.id || a.task.id - b.task.id;
}

// Who can be assigned on a story in `groupId`: its members, or anyone for a
// story with no group yet (only the Administrator sees those).
function membersOf(groups: WorkGroup[], groupId: number | null, everyone: TeamMember[]): TeamMember[] {
  if (groupId === null) return everyone;
  return groups.find((group) => group.id === groupId)?.members ?? [];
}

// A task's deadline, saved when the field loses focus (typing a date on a
// computer passes through half-typed values that mustn't be saved).
function DeadlineInput({
  id,
  label,
  value,
  onCommit,
  disabled,
  className,
}: {
  id: string;
  label: string;
  value: string | null;
  onCommit: (deadline: string | null) => void;
  disabled: boolean;
  className?: string;
}) {
  const saved = deadlineToInputValue(value);
  const [draft, setDraft] = useState(saved);
  useEffect(() => {
    queueMicrotask(() => setDraft(saved));
  }, [saved]);

  return (
    <input
      id={id}
      type="datetime-local"
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== saved) onCommit(inputValueToDeadline(draft));
      }}
      className={`${styles.formInput} ${className ?? ""}`}
      disabled={disabled}
    />
  );
}

function AssigneeSelect({
  id,
  label,
  value,
  members,
  onChange,
  disabled,
  className,
}: {
  id: string;
  label: string;
  value: number | null;
  members: TeamMember[];
  onChange: (value: number | null) => void;
  disabled: boolean;
  // Extra class, e.g. a minimum width inside a table cell.
  className?: string;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value === null ? "" : String(value)}
      onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      className={`${styles.formInput} ${className ?? ""}`}
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
  className,
}: {
  id: string;
  label: string;
  value: WorkStatus;
  onChange: (value: WorkStatus) => void;
  disabled: boolean;
  className?: string;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as WorkStatus)}
      className={`${styles.formInput} ${className ?? ""}`}
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
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState("");
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [managingGroups, setManagingGroups] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<Filter>("open");
  const [view, setView] = useState<View>("stories");
  // The task whose status/assignee is being saved from the Tasks table, and
  // why the last such save failed.
  const [savingTaskKey, setSavingTaskKey] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  // "Now" for the Tasks view's overdue flags and ordering, refreshed every
  // minute so a deadline passing while the page is open shows up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchStories(), fetchTeamMembers(), fetchGroups()])
      .then(([storyData, memberData, groupData]) => {
        if (cancelled) return;
        setStories(storyData);
        setMembers(memberData);
        setGroups(groupData);
        setLoadState("loaded");
      })
      .catch(() => {
        if (!cancelled) setLoadState("failed");
      });
    fetchMyAccess()
      .then((access) => {
        if (!cancelled) setIsAdministrator(access.sections === null);
      })
      .catch(() => {});
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

  // Taking someone out of a group unassigns them from its stories, so the
  // board is reloaded after groups change.
  async function reloadAfterGroupChange() {
    const [storyData, groupData] = await Promise.all([fetchStories(), fetchGroups()]);
    setStories(storyData);
    setGroups(groupData);
  }

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
    .filter((story) => groupFilter === "" || String(story.groupId) === groupFilter)
    .filter((story) =>
      matchesSearch(search, [story.title, story.description, story.assignedUserName, ...story.tasks.map((t) => t.title)]),
    );

  const openStory = stories.find((story) => story.id === openId) ?? null;

  function matchesStatus(status: WorkStatus): boolean {
    return filter === "all" ? true : filter === "open" ? status !== "completed" : status === filter;
  }

  function taskMatchesAssignee(task: WorkTask): boolean {
    if (assigneeFilter === "") return true;
    if (assigneeFilter === UNASSIGNED) return task.assignedUserId === null;
    return task.assignedUserId === Number(assigneeFilter);
  }

  const visibleTasks: TaskRow[] = stories
    .filter((story) => groupFilter === "" || String(story.groupId) === groupFilter)
    .flatMap((story) => story.tasks.map((task) => ({ task, story })))
    .filter(({ task }) => matchesStatus(task.status) && taskMatchesAssignee(task))
    .filter(({ task, story }) => matchesSearch(search, [task.title, task.assignedUserName, story.title]))
    .sort((a, b) => byUrgency(a, b, now));

  async function saveTask(row: TaskRow, fields: { status?: WorkStatus; assignedUserId?: number | null }) {
    setSavingTaskKey(taskKey(row));
    setTaskError(null);
    try {
      upsert(await updateTask(row.story.id, row.task.id, fields));
    } catch (caught) {
      setTaskError(caught instanceof Error ? caught.message : "Couldn't save the task. Please try again.");
    } finally {
      setSavingTaskKey(null);
    }
  }

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
        <div className={styles.pageHeaderActions}>
          <PhoneAlertsButton />
          {isAdministrator && (
            <Button type="button" variant="secondary" onClick={() => setManagingGroups(true)} disabled={loadState !== "loaded"}>
              Manage groups
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            onClick={() => setCreating(true)}
            disabled={loadState !== "loaded" || groups.length === 0}
            title={groups.length === 0 ? "Stories go into a group: there isn't one yet" : undefined}
          >
            + New story
          </Button>
        </div>
      </div>

      <p className={styles.pageSubtext}>The team&apos;s own stories and the tasks under them. Open a story to manage its tasks.</p>

      <div className={styles.filterToggleRow}>
        <div className={styles.viewToggle} role="tablist" aria-label="View">
          {VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={view === option.value}
              onClick={() => setView(option.value)}
              className={`${styles.viewToggleButton} ${view === option.value ? styles.viewToggleButtonActive : ""}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <TableSearchInput
          value={search}
          onChange={setSearch}
          label={view === "tasks" ? "Search tasks" : "Search stories"}
          placeholder={view === "tasks" ? "Search tasks or stories…" : "Search stories or tasks…"}
        />
        {groups.length > 1 && (
          <select
            aria-label="Filter by group"
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.target.value)}
            className={`${styles.formInput} ${styles.workFilterSelect}`}
          >
            <option value="">All groups</option>
            {groups.map((group) => (
              <option key={group.id} value={String(group.id)}>
                {group.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Filter by assignee"
          value={assigneeFilter}
          onChange={(event) => setAssigneeFilter(event.target.value)}
          className={`${styles.formInput} ${styles.workFilterSelect}`}
        >
          <option value="">Everyone</option>
          {members.map((member) => (
            <option key={member.id} value={String(member.id)}>
              {member.name}
            </option>
          ))}
          <option value={UNASSIGNED}>{view === "tasks" ? "Unassigned tasks" : "Unassigned stories"}</option>
        </select>
      </div>

      {view === "tasks" && taskError && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {taskError}
        </p>
      )}

      {view === "tasks" && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>Task</th>
                <th className={styles.tableHeadCell}>Story</th>
                {groups.length > 1 && <th className={styles.tableHeadCell}>Group</th>}
                <th className={styles.tableHeadCell}>Assigned to</th>
                <th className={styles.tableHeadCell}>Status</th>
                <th className={styles.tableHeadCell}>Deadline</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((row) => (
                <tr key={taskKey(row)} className={styles.tableRow}>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary} ${styles.databaseCellClip}`} title={row.task.title}>
                    {row.task.title}
                  </td>
                  <td className={styles.tableCell}>
                    <button
                      type="button"
                      onClick={() => setOpenId(row.story.id)}
                      className={styles.workStoryLink}
                      title={`Open story #${row.story.id}`}
                    >
                      #{row.story.id} · {row.story.title}
                    </button>
                  </td>
                  {groups.length > 1 && <td className={styles.tableCell}>{row.story.groupName || "—"}</td>}
                  <td className={styles.tableCell}>
                    <AssigneeSelect
                      id={`board-task-${taskKey(row)}-assignee`}
                      className={styles.workCellControl}
                      label={`Assignee of ${row.task.title}`}
                      value={row.task.assignedUserId}
                      members={membersOf(groups, row.story.groupId, members)}
                      onChange={(assignedUserId) => void saveTask(row, { assignedUserId })}
                      disabled={savingTaskKey === taskKey(row)}
                    />
                  </td>
                  <td className={`${styles.tableCell} ${styles.statusText} ${STATUS_COLOR[row.task.status]}`}>
                    <StatusSelect
                      id={`board-task-${taskKey(row)}-status`}
                      className={styles.workCellControl}
                      label={`Status of ${row.task.title}`}
                      value={row.task.status}
                      onChange={(status) => void saveTask(row, { status })}
                      disabled={savingTaskKey === taskKey(row)}
                    />
                  </td>
                  <td className={`${styles.tableCell} ${styles.workNoWrap}`}>
                    {row.task.deadline ? formatDateTime(utc(row.task.deadline)) : "—"}
                    {isOverdue(row.task, now) && (
                      <span className={`${styles.statusText} ${styles.statusCancelled} ${styles.workOverdueNote}`}>
                        Overdue
                      </span>
                    )}
                  </td>
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
          {loadState === "loaded" && visibleTasks.length === 0 && (
            <p className={styles.pageSubtext}>
              {stories.some((story) => story.tasks.length > 0)
                ? "No tasks in this view."
                : "No tasks yet. Open a story to add its tasks."}
            </p>
          )}
        </div>
      )}

      {view === "stories" && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>#</th>
                <th className={styles.tableHeadCell}>Story</th>
                <th className={styles.tableHeadCell}>Group</th>
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
                  <td className={styles.tableCell}>{story.groupName || "—"}</td>
                  <td className={styles.tableCell}>{story.assignedUserName || "—"}</td>
                  <td className={`${styles.tableCell} ${styles.statusText} ${STATUS_COLOR[story.status]}`}>
                    {workStatusLabel(story.status)}
                  </td>
                  <td className={styles.tableCell}>
                    {story.tasks.length === 0
                      ? "—"
                      : `${story.tasks.filter((task) => task.status === "completed").length} / ${story.tasks.length}`}
                    {story.tasks.some((task) => isOverdue(task)) && (
                      <span className={`${styles.statusText} ${styles.statusCancelled}`}>
                        {" "}
                        · {story.tasks.filter((task) => isOverdue(task)).length} overdue
                      </span>
                    )}
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
              {groups.length === 0
                ? isAdministrator
                  ? "Stories go into groups. Start with Manage groups → New group."
                  : "You're not in any group yet. Ask the Administrator to add you to one."
                : stories.length === 0
                  ? "No stories yet. Add one with + New story."
                  : "No stories in this view."}
            </p>
          )}
        </div>
      )}

      {creating && (
        <NewStoryModal
          groups={groups}
          defaultGroupId={groupFilter ? Number(groupFilter) : (groups[0]?.id ?? null)}
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
          groups={groups}
          members={membersOf(groups, openStory.groupId, members)}
          onSaved={upsert}
          onDeleted={() => {
            remove(openStory.id);
            closeDetail();
          }}
          onClose={closeDetail}
        />
      )}

      {managingGroups && (
        <ManageGroupsModal
          groups={groups}
          members={members}
          onChanged={() => void reloadAfterGroupChange().catch(() => setLoadState("failed"))}
          onClose={() => setManagingGroups(false)}
        />
      )}
    </>
  );
}

function NewStoryModal({
  groups,
  defaultGroupId,
  members,
  onClose,
  onSaved,
}: {
  groups: WorkGroup[];
  defaultGroupId: number | null;
  members: TeamMember[];
  onClose: () => void;
  onSaved: (story: WorkStory) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<WorkStatus>("new");
  const [assignee, setAssignee] = useState<number | null>(null);
  const [groupId, setGroupId] = useState<number | null>(defaultGroupId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupMembers = membersOf(groups, groupId, members);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (groupId === null) return setError("Pick a group.");
    if (!title.trim()) return setError("Enter a title.");
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await createStory({
          groupId,
          title: title.trim(),
          description: description.trim(),
          status,
          assignedUserId: assignee,
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
              <label htmlFor="storyGroup" className={styles.formLabel}>
                Group<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="storyGroup"
                value={groupId === null ? "" : String(groupId)}
                onChange={(event) => {
                  setGroupId(event.target.value ? Number(event.target.value) : null);
                  setAssignee(null);
                }}
                className={styles.formInput}
                disabled={saving}
              >
                {groups.map((group) => (
                  <option key={group.id} value={String(group.id)}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
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
                members={groupMembers}
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
  groups,
  members,
  onSaved,
  onDeleted,
  onClose,
}: {
  story: WorkStory;
  groups: WorkGroup[];
  members: TeamMember[];
  onSaved: (story: WorkStory) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(story.title);
  const [description, setDescription] = useState(story.description);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState<number | null>(null);
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
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
      () =>
        addTask(story.id, {
          title: newTaskTitle.trim(),
          assignedUserId: newTaskAssignee,
          deadline: inputValueToDeadline(newTaskDeadline),
        }),
      () => {
        setNewTaskTitle("");
        setNewTaskAssignee(null);
        setNewTaskDeadline("");
      },
    );
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-title"
        className={`${styles.modalPanel} ${styles.workStoryModalPanel}`}
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
            {groups.length > 1 && (
              <div className={styles.formGridFullSpan}>
                <label htmlFor="editStoryGroup" className={styles.formLabel}>
                  Group
                </label>
                <select
                  id="editStoryGroup"
                  value={story.groupId === null ? "" : String(story.groupId)}
                  onChange={(event) =>
                    event.target.value && void run(() => updateStory(story.id, { groupId: Number(event.target.value) }))
                  }
                  className={styles.formInput}
                  disabled={busy}
                >
                  {story.groupId === null && <option value="">No group</option>}
                  {groups.map((group) => (
                    <option key={group.id} value={String(group.id)}>
                      {group.name}
                    </option>
                  ))}
                </select>
                <p className={styles.formHint}>Moving it unassigns anyone who isn&apos;t in the new group.</p>
              </div>
            )}
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

          <div className={styles.workSectionHeading}>
            <h3 className={styles.workSectionTitle}>Tasks</h3>
            {story.tasks.length > 0 && (
              <span className={styles.formHint}>
                {story.tasks.filter((task) => task.status === "completed").length} of {story.tasks.length} done
              </span>
            )}
          </div>
          {story.tasks.length === 0 ? (
            <p className={styles.formHint}>No tasks yet. Add the first one below.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.tableHeadCell}>Task</th>
                    <th className={styles.tableHeadCell}>Status</th>
                    <th className={styles.tableHeadCell}>Assigned to</th>
                    <th className={styles.tableHeadCell}>Deadline</th>
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
                          className={styles.workCellControl}
                          label={`Status of ${task.title}`}
                          value={task.status}
                          onChange={(status) => void run(() => updateTask(story.id, task.id, { status }))}
                          disabled={busy}
                        />
                      </td>
                      <td className={styles.tableCell}>
                        <AssigneeSelect
                          id={`task-${task.id}-assignee`}
                          className={styles.workCellControl}
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
                        <DeadlineInput
                          id={`task-${task.id}-deadline`}
                          className={styles.workCellControl}
                          label={`Deadline of ${task.title}`}
                          value={task.deadline}
                          onCommit={(deadline) => void run(() => updateTask(story.id, task.id, { deadline }))}
                          disabled={busy}
                        />
                        {isOverdue(task) && (
                          <span className={`${styles.statusText} ${styles.statusCancelled} ${styles.workOverdueNote}`}>
                            Overdue
                          </span>
                        )}
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

          <form onSubmit={handleAddTask} noValidate className={`${styles.formGrid} ${styles.workNewTaskBox}`}>
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
              <label htmlFor="newTaskAssignee" className={styles.formLabel}>
                Assign to
              </label>
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
              <label htmlFor="newTaskDeadline" className={styles.formLabel}>
                Deadline (optional)
              </label>
              <input
                id="newTaskDeadline"
                type="datetime-local"
                value={newTaskDeadline}
                onChange={(event) => setNewTaskDeadline(event.target.value)}
                className={styles.formInput}
                disabled={busy}
              />
            </div>
            <div className={`${styles.formGridFullSpan} ${styles.modalActionsRight}`}>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Save task"}
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

// Administrator only: create groups, rename them, add and remove people,
// delete an empty one. Pick a group on the left to edit it, or "New group".
function ManageGroupsModal({
  groups,
  members,
  onChanged,
  onClose,
}: {
  groups: WorkGroup[];
  members: TeamMember[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(groups[0]?.id ?? null);
  const selected = groups.find((group) => group.id === selectedId) ?? null;
  const [name, setName] = useState(selected?.name ?? "");
  const [memberIds, setMemberIds] = useState<number[]>(selected?.members.map((member) => member.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function select(group: WorkGroup | null) {
    setSelectedId(group?.id ?? null);
    setName(group?.name ?? "");
    setMemberIds(group?.members.map((member) => member.id) ?? []);
    setError(null);
    setConfirmingDelete(false);
  }

  function toggleMember(id: number) {
    setMemberIds((previous) => (previous.includes(id) ? previous.filter((other) => other !== id) : [...previous, id]));
  }

  async function run(action: () => Promise<WorkGroup | null>) {
    setBusy(true);
    setError(null);
    try {
      const saved = await action();
      onChanged();
      if (saved) setSelectedId(saved.id);
      else select(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return setError("Enter a group name.");
    void run(() =>
      selected ? updateGroup(selected.id, { name: name.trim(), memberIds }) : createGroup(name.trim(), memberIds),
    );
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="groups-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="groups-title" className={styles.modalTitle}>
            Groups
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.modalForm}>
          <div className={styles.viewToggle} role="tablist" aria-label="Groups">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={selectedId === group.id}
                onClick={() => select(group)}
                className={`${styles.viewToggleButton} ${selectedId === group.id ? styles.viewToggleButtonActive : ""}`}
              >
                {group.name} ({group.members.length})
              </button>
            ))}
            <button
              type="button"
              role="tab"
              aria-selected={selectedId === null}
              onClick={() => select(null)}
              className={`${styles.viewToggleButton} ${selectedId === null ? styles.viewToggleButtonActive : ""}`}
            >
              + New group
            </button>
          </div>

          <form onSubmit={handleSave} noValidate className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="groupName" className={styles.formLabel}>
                Group name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="groupName"
                type="text"
                maxLength={80}
                placeholder="e.g. Marketing"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={styles.formInput}
                disabled={busy}
              />
            </div>
            <fieldset className={`${styles.formGridFullSpan} ${styles.workFieldset}`} disabled={busy}>
              <legend className={styles.formLabel}>Members</legend>
              <div className={styles.sectionChecklist}>
                {members.map((member) => (
                  <label key={member.id} className={styles.sectionChecklistItem}>
                    <input
                      type="checkbox"
                      checked={memberIds.includes(member.id)}
                      onChange={() => toggleMember(member.id)}
                    />
                    {member.name}
                  </label>
                ))}
              </div>
              {selected && (
                <p className={styles.formHint}>Taking someone out unassigns them from this group&apos;s stories and tasks.</p>
              )}
            </fieldset>

            {error && (
              <p role="alert" aria-live="polite" className={`${styles.formGridFullSpan} ${styles.formError}`}>
                {error}
              </p>
            )}

            <div className={`${styles.formGridFullSpan} ${styles.modalActions}`}>
              <div className={styles.modalActionsLeft}>
                {selected &&
                  (confirmingDelete ? (
                    <>
                      <span className={styles.formHint}>Delete {selected.name}?</span>{" "}
                      <button
                        type="button"
                        onClick={() => void run(() => updateGroup(selected.id, { delete: true }))}
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
                      Delete group
                    </button>
                  ))}
              </div>
              <div className={styles.modalActionsRight}>
                <Button type="button" variant="tertiary" onClick={onClose} disabled={busy}>
                  Close
                </Button>
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? "Saving…" : selected ? "Save group" : "Create group"}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
