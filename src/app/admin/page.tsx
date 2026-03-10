import { listUsers } from "./actions";
import { AdminConsole } from "./admin-console";

export default async function AdminPage() {
  const users = await listUsers();
  return <AdminConsole initialUsers={users} />;
}
