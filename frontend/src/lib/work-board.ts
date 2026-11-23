// The Work board (backend/app/api/routes/work_board.py): the team's own
// stories, each with tasks under it. Both have a status and an assignee.
// Not client Tickets (lib/tickets.ts).
import { apiFetch } from "@/lib/api";

export type WorkStatus = "new" | "active" | "completed";

export const WORK_STATUS_OPTIONS: { value: WorkStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

export function workStatusLabel(status: WorkStatus): string {
  return WORK_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

export type WorkTask = {
  id: number;
  title: string;
  status: WorkStatus;
  assignedUserId: number | null;
  assignedUserName: string;
};

export type WorkStory = {
  id: number;
  title: string;
  description: string;
  status: WorkStatus;
  assignedUserId: number | null;
  assignedUserName: string;
  tasks: WorkTask[];
  updatedAt: string;
};

export type TeamMember = { id: number; name: string };

type TaskResponse = {
  task_id: number;
  title: string;
  status: WorkStatus;
  assigned_user_id: number | null;
  assigned_user_name: string | null;
};

type StoryResponse = {
  story_id: number;
  title: string;
  description: string | null;
  status: WorkStatus;
  assigned_user_id: number | null;
  assigned_user_name: string | null;
  tasks: TaskResponse[];
  updated_at: string;
};

function toStory(item: StoryResponse): WorkStory {
  return {
    id: item.story_id,
    title: item.title,
    description: item.description ?? "",
    status: item.status,
    assignedUserId: item.assigned_user_id,
    assignedUserName: item.assigned_user_name ?? "",
    tasks: item.tasks.map((task) => ({
      id: task.task_id,
      title: task.title,
      status: task.status,
      assignedUserId: task.assigned_user_id,
      assignedUserName: task.assigned_user_name ?? "",
    })),
    updatedAt: item.updated_at,
  };
}

async function detailOr(response: Response, fallback: string): Promise<string> {
  const body: { detail?: unknown } = await response.json().catch(() => ({}));
  if (typeof body.detail === "string") {
    return body.detail.charAt(0).toUpperCase() + body.detail.slice(1);
  }
  return fallback;
}

// Returns the saved story, or null when it was deleted.
async function post(path: string, body: unknown): Promise<WorkStory | null> {
  const response = await apiFetch(`/admin/work_board/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await detailOr(response, "Couldn't save. Please try again."));
  }
  const data: { story: StoryResponse | null } = await response.json();
  return data.story ? toStory(data.story) : null;
}

// Most recently updated first.
export async function fetchStories(): Promise<WorkStory[]> {
  const response = await apiFetch("/admin/work_board/get_stories");
  if (!response.ok) throw new Error("Failed to load the work board.");
  const items: StoryResponse[] = await response.json();
  return items.map(toStory);
}

export async function fetchTeamMembers(): Promise<TeamMember[]> {
  const response = await apiFetch("/admin/work_board/get_assignable_users");
  if (!response.ok) throw new Error("Failed to load team members.");
  const items: { user_id: number; name: string }[] = await response.json();
  return items.map((item) => ({ id: item.user_id, name: item.name }));
}

export type StoryFields = { title: string; description: string; status: WorkStatus; assignedUserId: number | null };

export async function createStory(fields: StoryFields): Promise<WorkStory> {
  const story = await post("create_story", {
    title: fields.title,
    description: fields.description,
    status: fields.status,
    assigned_user_id: fields.assignedUserId,
  });
  if (!story) throw new Error("Couldn't save. Please try again.");
  return story;
}

// assigned_user_id is only sent when it's in `fields`; null unassigns.
export function updateStory(
  id: number,
  fields: Partial<StoryFields> & { delete?: boolean },
): Promise<WorkStory | null> {
  return post("update_story", {
    story_id: id,
    title: fields.title,
    description: fields.description,
    status: fields.status,
    ...("assignedUserId" in fields ? { assigned_user_id: fields.assignedUserId } : {}),
    delete: fields.delete ?? false,
  });
}

export async function addTask(
  storyId: number,
  fields: { title: string; assignedUserId: number | null },
): Promise<WorkStory> {
  const story = await post("add_task", {
    story_id: storyId,
    title: fields.title,
    assigned_user_id: fields.assignedUserId,
  });
  if (!story) throw new Error("Couldn't save. Please try again.");
  return story;
}

export async function updateTask(
  storyId: number,
  taskId: number,
  fields: { title?: string; status?: WorkStatus; assignedUserId?: number | null; delete?: boolean },
): Promise<WorkStory> {
  const story = await post("update_task", {
    story_id: storyId,
    task_id: taskId,
    title: fields.title,
    status: fields.status,
    ...("assignedUserId" in fields ? { assigned_user_id: fields.assignedUserId } : {}),
    delete: fields.delete ?? false,
  });
  if (!story) throw new Error("Couldn't save. Please try again.");
  return story;
}
