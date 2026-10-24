// /admin/users — list every weft.zip account for the super-admin to scan.
// Gate: `requireSuperAdminWeft()` throws notFound() for non-admins (a 404
// leaks less than a 403). The page stays a server component; the table and
// its fetching live in UsersTable next door, on the admin kit (components/admin).
import type { Metadata } from "next";
import AdminGate from "../AdminGate";
import UsersTable from "./UsersTable";

export const metadata: Metadata = { title: "Weft admin — Users" };

export default function AdminUsersPage() {
  return (
    <AdminGate>
      <UsersTable />
    </AdminGate>
  );
}
