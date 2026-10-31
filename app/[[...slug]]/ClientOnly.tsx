"use client";

import dynamic from "next/dynamic";

const ClientRoot = dynamic(() => import("@/ClientRoot"), { ssr: false });

export default function ClientOnly() {
  return <ClientRoot />;
}
