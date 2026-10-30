import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/ui";
import { PasswordForm } from "@/components/password-form";

export const metadata: Metadata = { title: "Password" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="max-w-xl space-y-8">
      <PageHeader title="Your password" lead={`Signed in as ${user.email}. Changing your password signs you out on every other device.`} />
      <Panel>
        <PasswordForm />
      </Panel>
    </div>
  );
}
