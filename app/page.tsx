import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  if (!user.displayName) redirect("/onboarding");
  redirect("/dashboard");
}
