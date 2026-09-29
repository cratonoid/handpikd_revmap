// ---------------------------------------------------------------------------
// Team users and roles for /admin/users
// ---------------------------------------------------------------------------
// Backed by backend/app/api/routes/users.py. Team users are the accounts
// that sign in to /admin. Client logins (the /customer portal) are listed
// too, but only their enabled/disabled state is changed from here — the
// rest is edited with the client on /admin/clients, and they never get a
// role. A role is a named set of sections (lib/access.ts) —
// the built-in Administrator role (isSystem) has every section and can't
// be edited or deleted.
import { apiFetch } from "@/lib/api";
import type { SectionKey } from "@/lib/access";

export type Role = {
  id: number;
  name: string;
  sections: SectionKey[];
  isSystem: boolean;
  userCount: number;
};

export type TeamUser = {
  id: number;
  name: string;
  mail: string;
  roleId: number | null;
  roleName: string;
  isActive: boolean;
  lastLogin: string | null;
};

type RoleItem = {
  role_id: number;
  name: string;
  sections: SectionKey[];
  is_system: boolean;
  user_count: number;
};

type TeamUserItem = {
  user_id: number;
  name: string;
  mail: string;
  role_id: number | null;
  role_name: string;
  is_active: boolean;
  last_login: string | null;
};

export async function fetchRoles(): Promise<Role[]> {
  const response = await apiFetch("/admin/users/get_roles");
  if (!response.ok) {
    throw new Error("Failed to load roles");
  }

  const items: RoleItem[] = await response.json();
  return items.map((item) => ({
    id: item.role_id,
    name: item.name,
    sections: item.sections,
    isSystem: item.is_system,
    userCount: item.user_count,
  }));
}

export async function fetchTeamUsers(): Promise<TeamUser[]> {
  const response = await apiFetch("/admin/users/get_users");
  if (!response.ok) {
    throw new Error("Failed to load users");
  }

  const items: TeamUserItem[] = await response.json();
  return items.map((item) => ({
    id: item.user_id,
    name: item.name,
    mail: item.mail,
    roleId: item.role_id,
    roleName: item.role_name,
    isActive: item.is_active,
    lastLogin: item.last_login,
  }));
}

// Every write returns { message } on success and { detail } on failure. The
// backend's detail strings are already written for people (e.g. "this role
// is still assigned to users"), so they're shown as-is, capitalised.
export class UsersApiError extends Error {}

async function post(path: string, body: unknown): Promise<void> {
  let response: Response;
  try {
    response = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new UsersApiError("Couldn't reach the server. Please try again.");
  }

  if (!response.ok) {
    const detail: unknown = await response
      .json()
      .then((data: { detail?: unknown }) => data.detail)
      .catch(() => undefined);
    const message =
      typeof detail === "string" && detail
        ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`
        : "Something went wrong. Please try again.";
    throw new UsersApiError(message);
  }
}

export type RolePayload = { name: string; sections: SectionKey[] };

export function addRole(payload: RolePayload) {
  return post("/admin/users/add_role", payload);
}

export function updateRole(roleId: number, payload: RolePayload) {
  return post("/admin/users/update_role", { role_id: roleId, ...payload });
}

export function deleteRole(roleId: number) {
  return post("/admin/users/delete_role", { role_id: roleId });
}

export type TeamUserPayload = {
  name: string;
  mail: string;
  // Required when adding; "" when editing keeps the current password.
  password: string;
  roleId: number;
  isActive: boolean;
};

function toUserBody(payload: TeamUserPayload) {
  return {
    name: payload.name,
    mail: payload.mail,
    password: payload.password,
    role_id: payload.roleId,
    is_active: payload.isActive,
  };
}

export function addTeamUser(payload: TeamUserPayload) {
  return post("/admin/users/add_user", toUserBody(payload));
}

export function updateTeamUser(userId: number, payload: TeamUserPayload) {
  return post("/admin/users/update_user", { user_id: userId, ...toUserBody(payload) });
}

export function deleteTeamUser(userId: number) {
  return post("/admin/users/delete_user", { user_id: userId });
}

export type ClientLogin = {
  userId: number;
  mail: string;
  registeredName: string;
  companyOrDepartment: string;
  isActive: boolean;
  // Deleted on /admin/clients: the portal refuses it whatever isActive says.
  clientDeleted: boolean;
  lastLogin: string | null;
};

type ClientLoginItem = {
  user_id: number;
  mail: string;
  registered_name: string;
  company_or_department: string;
  is_active: boolean;
  client_deleted: boolean;
  last_login: string | null;
};

export async function fetchClientLogins(): Promise<ClientLogin[]> {
  const response = await apiFetch("/admin/users/get_client_logins");
  if (!response.ok) {
    throw new Error("Failed to load client logins");
  }

  const items: ClientLoginItem[] = await response.json();
  return items.map((item) => ({
    userId: item.user_id,
    mail: item.mail,
    registeredName: item.registered_name,
    companyOrDepartment: item.company_or_department,
    isActive: item.is_active,
    clientDeleted: item.client_deleted,
    lastLogin: item.last_login,
  }));
}

export function setClientLoginActive(userId: number, isActive: boolean) {
  return post("/admin/users/set_client_login_active", { user_id: userId, is_active: isActive });
}
