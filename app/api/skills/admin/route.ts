import { currentUserId } from "@/server/auth";
import { getDb } from "@/server/db";
import { audiences, authenticate, origin } from "@/server/oauth";
import {
  DEFAULT_OWNER,
  SkillError,
  deleteFile,
  deleteSkill,
  fileHistory,
  isSkillAdmin,
  ownerFiles,
  resolveFile,
  restoreVersion,
  saveFile,
} from "@/server/skills";
import { getUserEmail } from "@/server/users";

export const dynamic = "force-dynamic";

/**
 * The skill editor's backend (Settings, Skills in the app). The app sends its own sign-in token;
 * a browser that only has the login cookie still works, but then the request must come from this
 * site. Users manage their own skills here, and admins can switch to the shared defaults.
 */
export async function POST(req: Request) {
  const db = getDb();
  let userId: string | null = null;
  if (req.headers.get("authorization")) {
    userId =
      (await authenticate(db, req, audiences(origin(req)).api))?.userId ?? null;
  } else {
    if (req.headers.get("origin") !== origin(req))
      return Response.json({ error: "Bad origin" }, { status: 403 });
    userId = await currentUserId();
  }
  if (!userId)
    return Response.json({ error: "Sign in first" }, { status: 401 });

  const b = (await req.json().catch(() => null)) ?? {};
  const admin = isSkillAdmin(await getUserEmail(db, userId));
  const scope = b.scope === "default" ? "default" : "mine";
  if (scope === "default" && !admin)
    return Response.json({ error: "Admins only" }, { status: 403 });
  const owner = scope === "default" ? DEFAULT_OWNER : userId;
  const skill = String(b.skill ?? "");
  const path = String(b.path ?? "SKILL.md");

  try {
    switch (b.op) {
      case "list": {
        if (scope === "mine") {
          const [defaults, mine] = await Promise.all([
            ownerFiles(db, DEFAULT_OWNER),
            ownerFiles(db, userId),
          ]);
          const myNames = new Set(mine.map((f) => f.skill));
          const defNames = new Set(defaults.map((f) => f.skill));
          const allNames = [...new Set([...defNames, ...myNames])].sort();
          const skills = allNames.map((name) => {
            const isCustom = myNames.has(name);
            const srcFiles = isCustom ? mine : defaults;
            return {
              name,
              source: isCustom ? "custom" : "default",
              overridesDefault: isCustom && defNames.has(name),
              files: srcFiles
                .filter((f) => f.skill === name)
                .map((f) => ({ path: f.path, updatedAt: f.updatedAt })),
            };
          });
          return Response.json({ admin, scope, skills });
        }
        // Admin: default scope
        const files = await ownerFiles(db, DEFAULT_OWNER);
        const skills = [...new Set(files.map((f) => f.skill))]
          .sort()
          .map((name) => ({
            name,
            source: "default" as const,
            overridesDefault: false,
            files: files
              .filter((f) => f.skill === name)
              .map((f) => ({ path: f.path, updatedAt: f.updatedAt })),
          }));
        return Response.json({ admin, scope, skills });
      }
      case "get": {
        const f =
          scope === "mine"
            ? await resolveFile(db, userId, skill, path)
            : ((await ownerFiles(db, owner, skill)).find(
                (x) => x.path === path
              ) ?? null);
        if (!f) return Response.json({ error: "Not found" }, { status: 404 });
        return Response.json({ content: f.content });
      }
      case "save":
        await saveFile(db, owner, skill, path, String(b.content ?? ""), userId);
        return Response.json({ ok: true });
      case "deleteFile":
        await deleteFile(db, owner, skill, path, userId);
        return Response.json({ ok: true });
      case "deleteSkill":
        await deleteSkill(db, owner, skill, userId);
        return Response.json({ ok: true });
      case "history":
        return Response.json({
          versions: await fileHistory(db, owner, skill, path),
        });
      case "restore":
        await restoreVersion(
          db,
          owner,
          skill,
          path,
          Number(b.versionId),
          userId
        );
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "Unknown op" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof SkillError)
      return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
