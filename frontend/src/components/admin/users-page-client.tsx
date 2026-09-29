"use client";

// ---------------------------------------------------------------------------
// <UsersPageClient> — the interactive half of /admin/users
// ---------------------------------------------------------------------------
// Two tabs over the same data (lib/users.ts):
//   - Users: team accounts that sign in to /admin, each with one role.
//     Clicking a row opens team-user-form-modal.tsx.
//   - Roles: named sets of sections. Clicking a row opens role-form-modal.tsx.
//     The built-in Administrator role is listed but not clickable — it has
//     every section, always, so there is nothing to edit.
// Both lists are reloaded after any save, since a role rename or delete also
// changes the Users tab, and a user's role change moves a Roles-tab count.
//
// Client logins aren't listed: they belong to a client and are edited with
// it on /admin/clients.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { RoleFormModal } from "@/components/admin/role-form-modal";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import { TeamUserFormModal } from "@/components/admin/team-user-form-modal";
import { ADMIN_SECTIONS, fetchMyAccess } from "@/lib/access";
import { formatDateTime } from "@/lib/format-date";
import { fetchRoles, fetchTeamUsers, type Role, type TeamUser } from "@/lib/users";
import styles from "@/styles/dashboard.module.css";

type Tab = "users" | "roles";
type LoadState = "loading" | "loaded" | "error";
type ModalState =
  | { kind: "user"; user?: TeamUser }
  | { kind: "role"; role?: Role }
  | null;

const SECTION_LABELS = new Map(ADMIN_SECTIONS.map((section) => [section.key, section.label]));

function roleSectionsText(role: Role): string {
  if (role.isSystem) return "All sections";
  if (role.sections.length === 0) return "No sections";
  return role.sections.map((key) => SECTION_LABELS.get(key) ?? key).join(", ");
}

// Also fetches the signed-in user's own id, so their row can be marked and
// the modal can stop them disabling or deleting themselves.
function loadAll() {
  return Promise.all([fetchTeamUsers(), fetchRoles(), fetchMyAccess()]);
}

export function UsersPageClient() {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [myUserId, setMyUserId] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [search, setSearch] = useState("");

  function applyLoaded([nextUsers, nextRoles, access]: Awaited<ReturnType<typeof loadAll>>) {
    setUsers(nextUsers);
    setRoles(nextRoles);
    setMyUserId(access.userId);
    setLoadState("loaded");
  }

  useEffect(() => {
    let cancelled = false;
    loadAll()
      .then((data) => {
        if (!cancelled) applyLoaded(data);
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaved() {
    setModalState(null);
    loadAll()
      .then(applyLoaded)
      .catch(() => setLoadState("error"));
  }

  const visibleUsers = users.filter((user) => matchesSearch(search, [user.name, user.mail, user.roleName]));
  const visibleRoles = roles.filter((role) => matchesSearch(search, [role.name, roleSectionsText(role)]));

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Users &amp; Roles</h1>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={() => setModalState(tab === "users" ? { kind: "user" } : { kind: "role" })}
          disabled={loadState !== "loaded"}
        >
          {tab === "users" ? "+ Add new user" : "+ Add new role"}
        </Button>
      </div>

      <div className={styles.filterToggleRow}>
        <TableSearchInput
          value={search}
          onChange={setSearch}
          label={tab === "users" ? "Search users" : "Search roles"}
          placeholder={tab === "users" ? "Search name, email or role…" : "Search role or section…"}
        />

        <div className={`${styles.viewToggle} ${styles.viewToggleEnd}`} role="tablist" aria-label="Users and roles">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "users"}
            onClick={() => setTab("users")}
            className={`${styles.viewToggleButton} ${tab === "users" ? styles.viewToggleButtonActive : ""}`}
          >
            Users
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "roles"}
            onClick={() => setTab("roles")}
            className={`${styles.viewToggleButton} ${tab === "roles" ? styles.viewToggleButtonActive : ""}`}
          >
            Roles
          </button>
        </div>
      </div>

      {tab === "users" ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>S.No</th>
                <th className={styles.tableHeadCell}>Name</th>
                <th className={styles.tableHeadCell}>Email</th>
                <th className={styles.tableHeadCell}>Role</th>
                <th className={styles.tableHeadCell}>Last login</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user, index) => (
                <tr key={user.id} onClick={() => setModalState({ kind: "user", user })} className={styles.tableRow}>
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                    {user.name || "—"}
                    {user.id === myUserId && <span className={styles.treeNodeNote}>(you)</span>}
                    {!user.isActive && <span className={styles.inactiveBadge}>Disabled</span>}
                  </td>
                  <td className={styles.tableCell}>{user.mail}</td>
                  <td className={styles.tableCell}>{user.roleName || "—"}</td>
                  <td className={styles.tableCell}>{user.lastLogin ? formatDateTime(user.lastLogin) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loadState === "loading" && <p className={styles.pageSubtext}>Loading users…</p>}
          {loadState === "error" && <p className={styles.formError}>Couldn&apos;t load users. Please try again.</p>}
          {loadState === "loaded" && visibleUsers.length === 0 && (
            <p className={styles.pageSubtext}>{search.trim() !== "" ? "No users match your search." : "No users yet."}</p>
          )}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>S.No</th>
                <th className={styles.tableHeadCell}>Role</th>
                <th className={styles.tableHeadCell}>Sections</th>
                <th className={styles.tableHeadCell}>Users</th>
              </tr>
            </thead>
            <tbody>
              {visibleRoles.map((role, index) => (
                <tr
                  key={role.id}
                  onClick={role.isSystem ? undefined : () => setModalState({ kind: "role", role })}
                  className={role.isSystem ? undefined : styles.tableRow}
                  title={role.isSystem ? "Built-in role with every section. It can't be edited." : undefined}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                    {role.name}
                    {role.isSystem && <span className={styles.treeNodeNote}>(built-in)</span>}
                  </td>
                  <td className={`${styles.tableCell} ${styles.roleSectionsCell}`}>{roleSectionsText(role)}</td>
                  <td className={styles.tableCell}>{role.userCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loadState === "loading" && <p className={styles.pageSubtext}>Loading roles…</p>}
          {loadState === "error" && <p className={styles.formError}>Couldn&apos;t load roles. Please try again.</p>}
          {loadState === "loaded" && visibleRoles.length === 0 && (
            <p className={styles.pageSubtext}>{search.trim() !== "" ? "No roles match your search." : "No roles yet."}</p>
          )}
        </div>
      )}

      {modalState?.kind === "user" && (
        <TeamUserFormModal
          initialUser={modalState.user}
          roles={roles}
          isSelf={modalState.user !== undefined && modalState.user.id === myUserId}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}

      {modalState?.kind === "role" && (
        <RoleFormModal initialRole={modalState.role} onClose={() => setModalState(null)} onSaved={handleSaved} />
      )}
    </>
  );
}
