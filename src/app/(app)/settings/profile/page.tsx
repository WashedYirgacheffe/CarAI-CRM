import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { PasswordForm, ProfileForm } from "./profile-forms";

export const metadata: Metadata = { title: "个人资料" };

export default async function ProfilePage() {
  const user = await requireUser();
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true } });
  return (
    <>
      <PageHeader title="个人资料" description={`${user.email} · ${user.roleName}`} />
      <div className="grid max-w-3xl gap-6 lg:grid-cols-2">
        <ProfileForm name={user.name} phone={row.phone ?? ""} />
        <PasswordForm />
      </div>
    </>
  );
}
