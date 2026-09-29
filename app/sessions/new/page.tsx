import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import MandateForm from "@/components/sessions/MandateForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "New session" };

export default async function NewSessionPage() {
  if (!(await getSessionUser())) redirect("/login");
  return <MandateForm />;
}
