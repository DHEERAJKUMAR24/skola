import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The skill editor is part of the app now (Settings, Skills); old links land there. */
export default function EditPage() {
  redirect("/#/settings/skills");
}
