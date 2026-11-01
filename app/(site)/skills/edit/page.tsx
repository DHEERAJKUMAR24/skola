import { currentUserId } from "@/server/auth";
import { redirect } from "next/navigation";
import Editor from "./Editor";

export const dynamic = "force-dynamic";

export default async function EditPage() {
  if (!(await currentUserId())) redirect("/login?callbackUrl=%2Fskills%2Fedit");
  return (
    <>
      <p>
        <a href="/skills">All skills</a>
      </p>
      <h1>Edit skills</h1>
      <Editor />
    </>
  );
}
