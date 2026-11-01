import { useMediaSrc } from "./useMedia";

/** An <img> for a `media:` reference (or any other source), shown once the picture is ready. */
export function MediaImg({ src, alt }: { src: string; alt?: string }) {
  return <img src={useMediaSrc(src)} alt={alt ?? ""} />;
}
