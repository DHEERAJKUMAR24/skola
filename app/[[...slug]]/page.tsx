import ClientOnly from "./ClientOnly";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ slug: [] }];
}

// The whole UI is client-only (IndexedDB, hash router); the server just serves this shell.
export default function Page() {
  return (
    <div id="root">
      <ClientOnly />
    </div>
  );
}
