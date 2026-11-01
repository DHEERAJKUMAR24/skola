import "@/style/index.css";
import type { ReactNode } from "react";
import SiteShell from "./SiteShell";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
