import "@/style/index.css";
import type { ReactNode } from "react";
import AuthShell from "./AuthShell";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
