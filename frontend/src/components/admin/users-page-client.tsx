"use client";

// ---------------------------------------------------------------------------
// <UsersPageClient> — the interactive half of /admin/users
// ---------------------------------------------------------------------------
// Three tabs over lib/users.ts:
//   - Users: team accounts that sign in to /admin, each with one role.
//     Clicking a row opens team-user-form-modal.tsx.
//   - Roles: named sets of sections. Clicking a row opens role-form-modal.tsx.
//     The built-in Administrator role is listed but not clickable — it has
//     every section, always, so there is nothing to edit.
//   - Client logins: every client's /customer portal login. Deliberately not
//     mixed into Users: roles are for the admin panel, and a role picker on a
//     client row would invite handing a client the admin panel. The row's
//     Enable/Disable button is the one thing changed from here; clicking the
//     row opens the client's own edit form (customer-form-modal.tsx), for
//     anyone whose role also has Clients.
// Everything is reloaded after any save, since a role rename or delete also
// changes the Users tab, and a user's role change moves a Roles-tab count.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { CustomerFormModal } from "@/components/admin/customer-form-modal";
import { RoleFormModal } from "@/components/admin/role-form-modal";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import { TeamUserFormModal } from "@/components/admin/team-user-form-modal";
import { ADMIN_SECTIONS, canAccess, fetchMyAccess, type MyAccess } from "@/lib/access";
import { fetchCustomerDetail, type Customer } from "@/lib/customers";
import { formatDateTime } from "@/lib/format-date";
import {
  fetchClientLogins,
  fetchRoles,
  fetchTeamUsers,
  setClientLoginActive,
  UsersApiError,
  type ClientLogin,
  type Role,
  type TeamUser,
} from "@/lib/users";
import styles from "@/styles/dashboard.module.css";

type Tab = "users" | "roles" | "clients";
type LoadState = "loading" | "loaded" | "error";
type ModalState =
  | { kind: "user"; user?: TeamUser }
  | { kind: "role"; role?: Role }
  | { kind: "client"; customer: Customer }
  | null;

const TABS: { key: Tab; label: string; search: string; placeholder: string }[] = [
  { key: "users", label: "Users", search: "Search users", placeholder: "Search name, email or role…" },
  { key: "roles", label: "Roles", search: "Search roles", placeholder: "Search role or section…" },
  { key: "clients", label: "Client logins", search: "Search client logins", placeholder: "Search client or email…" },
];

const SECTION_LABELS = new Map(ADMIN_SECTIONS.map((section) => [section.key, section.label]));

function roleSectionsText(role: Role): string {
  if (role.isSystem) return "All sections";
  if (role.sections.length === 0) return "No sections";
  return role.sections.map((key) => SECTION_LABELS.get(key) ?? key).join(", ");
}

// Also fetches the signed-in user's own access: their id marks their row
// and stops them disabling or deleting themselves, and their sections decide
// whether a client login row can open the client's edit form.
function loadAll() {
  return Promise.all([fetchTeamUsers(), fetchRoles(), fetchClientLogins(), fetchMyAccess()]);
}

export function UsersPageClient() {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [clientLogins, setClientLogins] = useState<ClientLogin[]>([]);
  const [access, setAccess] = useState<MyAccess | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [search, setSearch] = useState("");
  // Client logins tab: the row whose Enable/Disable is in flight, the row
  // whose client form is being fetched, and the last error from either.
  const [togglingUserId, setTogglingUserId] = useState<number | null>(null);
  const [openingUserId, setOpeningUserId] = useState<number | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const myUserId = access?.userId ?? null;
  const canEditClients = access !== null && canAccess(access, "clients");
  const currentTab = TABS.find((t) => t.key === tab) ?? TABS[0];

  function applyLoaded([nextUsers, nextRoles, nextClientLogins, nextAccess]: Awaited<ReturnType<typeof loadAll>>) {
    setUsers(nextUsers);
    setRoles(nextRoles);
    setClientLogins(nextClientLogins);
    setAccess(nextAccess);
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

  function reload() {
    loadAll()
      .then(applyLoaded)
      .catch(() => setLoadState("error"));
  }

  function handleSaved() {
    setModalState(null);
    reload();
  }

  async function toggleClientLogin(login: ClientLogin) {
    setTogglingUserId(login.userId);
    setClientError(null);
    try {
      await setClientLoginActive(login.userId, !login.isActive);
      setClientLogins((prev) =>
        prev.map((item) => (item.userId === login.userId ? { ...item, isActive: !login.isActive } : item)),
      );
    } catch (caught) {
      setClientError(caught instanceof UsersApiError ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setTogglingUserId(null);
    }
  }

  async function openClient(login: ClientLogin) {
    setOpeningUserId(login.userId);
    setClientError(null);
    try {
      const customer = await fetchCustomerDetail(login.mail);
      setModalState({ kind: "client", customer });
    } catch {
      setClientError("Couldn't open this client. Please try again.");
    } finally {
      setOpeningUserId(null);
    }
  }

  const visibleUsers = users.filter((user) => matchesSearch(search, [user.name, user.mail, user.roleName]));
  const visibleRoles = roles.filter((role) => matchesSearch(search, [role.name, roleSectionsText(role)]));
  const visibleClientLogins = clientLogins.filter((login) =>
    matchesSearch(search, [login.registeredName, login.companyOrDepartment, login.mail]),
  );

  function statusMessages(noun: string, count: number) {
    return (
      <>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading {noun}…</p>}
        {loadState === "error" && <p className={styles.formError}>Couldn&apos;t load {noun}. Please try again.</p>}
        {loadState === "loaded" && count === 0 && (
          <p className={styles.pageSubtext}>{search.trim() !== "" ? `No ${noun} match your search.` : `No ${noun} yet.`}</p>
        )}
      </>
    );
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Users &amp; Roles</h1>
        </div>
        {/* Client logins are created with their client, so that tab has
            no "add" of its own. */}
        {tab !== "clients" && (
          <Button
            type="button"
            variant="primary"
            onClick={() => setModalState(tab === "users" ? { kind: "user" } : { kind: "role" })}
            disabled={loadState !== "loaded"}
          >
            {tab === "users" ? "+ Add new user" : "+ Add new role"}
          </Button>
        )}
      </div>

      <div className={styles.filterToggleRow}>
        <TableSearchInput
          value={search}
          onChange={setSearch}
          label={currentTab.search}
          placeholder={currentTab.placeholder}
        />

        <div className={`${styles.viewToggle} ${styles.viewToggleEnd}`} role="tablist" aria-label="Users and roles">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`${styles.viewToggleButton} ${tab === t.key ? styles.viewToggleButtonActive : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "users" && (
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
          {statusMessages("users", visibleUsers.length)}
        </div>
      )}

      {tab === "roles" && (
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
          {statusMessages("roles", visibleRoles.length)}
        </div>
      )}

      {tab === "clients" && (
        <div className={styles.tableWrap}>
          <p className={styles.pageSubtext}>
            Logins to the client portal, where clients see their own invoices. They&apos;re created when a client is
            added on Clients{canEditClients ? " — click a row to edit that client" : ""}.
          </p>
          {clientError && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {clientError}
            </p>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>S.No</th>
                <th className={styles.tableHeadCell}>Client</th>
                <th className={styles.tableHeadCell}>Department</th>
                <th className={styles.tableHeadCell}>Email</th>
                <th className={styles.tableHeadCell}>Last login</th>
                <th className={styles.tableHeadCell}>Login</th>
              </tr>
            </thead>
            <tbody>
              {visibleClientLogins.map((login, index) => (
                <tr
                  key={login.userId}
                  onClick={canEditClients && openingUserId === null ? () => void openClient(login) : undefined}
                  className={canEditClients ? styles.tableRow : undefined}
                  aria-busy={openingUserId === login.userId}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                    {login.registeredName || "—"}
                    {login.clientDeleted ? (
                      <span className={styles.inactiveBadge}>Client deleted</span>
                    ) : (
                      !login.isActive && <span className={styles.inactiveBadge}>Disabled</span>
                    )}
                  </td>
                  <td className={styles.tableCell}>{login.companyOrDepartment || "—"}</td>
                  <td className={styles.tableCell}>{login.mail}</td>
                  <td className={styles.tableCell}>{login.lastLogin ? formatDateTime(login.lastLogin) : "Never"}</td>
                  <td className={styles.tableCell}>
                    {/* A deleted client is already locked out of the portal,
                        so there is nothing for this button to change. */}
                    {login.clientDeleted ? (
                      "—"
                    ) : (
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={togglingUserId !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleClientLogin(login);
                        }}
                      >
                        {togglingUserId === login.userId ? "Saving…" : login.isActive ? "Disable" : "Enable"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {statusMessages("client logins", visibleClientLogins.length)}
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

      {modalState?.kind === "client" && (
        <CustomerFormModal
          mode="edit"
          initialCustomer={modalState.customer}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
