// ---------------------------------------------------------------------------
// Information section data (/admin/information)
// ---------------------------------------------------------------------------
// Backed by backend/app/api/routes/information.py. For now the section holds
// one thing: the holiday / gifting calendar, a month-by-month list the team
// edits by hand. "when" is free text ("14th-15th", "3rd Sunday", "varies")
// because many festivals move every year.
import { apiFetch } from "@/lib/api";
import { errorDetail, postJson } from "@/lib/tickets";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type HolidayEvent = {
  id: number;
  month: number; // 1-12
  name: string;
  when: string;
  note: string;
  sortOrder: number;
};

export type HolidayEventInput = Pick<HolidayEvent, "month" | "name" | "when" | "note">;

// Shape returned by the backend's HolidayEventItem schema.
type HolidayEventItem = {
  id: number;
  month: number;
  name: string;
  when: string;
  note: string;
  sort_order: number;
};

function toHolidayEvent(item: HolidayEventItem): HolidayEvent {
  return {
    id: item.id,
    month: item.month,
    name: item.name,
    when: item.when,
    note: item.note,
    sortOrder: item.sort_order,
  };
}

export async function fetchHolidayEvents(): Promise<HolidayEvent[]> {
  const response = await apiFetch("/admin/information/get_holiday_events");
  if (!response.ok) throw new Error("Failed to load the holiday calendar");
  const data: HolidayEventItem[] = await response.json();
  return data.map(toHolidayEvent);
}

export async function addHolidayEvent(input: HolidayEventInput): Promise<HolidayEvent> {
  const response = await postJson("/admin/information/add_holiday_event", input);
  if (!response.ok) throw new Error(await errorDetail(response, "Failed to add the entry"));
  return toHolidayEvent(await response.json());
}

export async function updateHolidayEvent(id: number, input: HolidayEventInput): Promise<HolidayEvent> {
  const response = await postJson("/admin/information/update_holiday_event", { id, ...input });
  if (!response.ok) throw new Error(await errorDetail(response, "Failed to save the entry"));
  return toHolidayEvent(await response.json());
}

export async function deleteHolidayEvent(id: number): Promise<void> {
  const response = await postJson("/admin/information/delete_holiday_event", { id });
  if (!response.ok) throw new Error(await errorDetail(response, "Failed to delete the entry"));
}
