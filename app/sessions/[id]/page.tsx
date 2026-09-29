import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import SessionRoom from "@/components/sessions/SessionRoom";

export const dynamic = "force-dynamic";
export const metadata = { title: "Session room" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser())) redirect("/login");
  const { id } = await params;
  return <SessionRoom id={id} />;
}
