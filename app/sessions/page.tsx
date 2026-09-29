import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import SessionsScreen from "@/components/sessions/SessionsScreen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent sessions" };

export default async function SessionsPage() {
  if (!(await getSessionUser())) redirect("/login");
  return <SessionsScreen />;
}
