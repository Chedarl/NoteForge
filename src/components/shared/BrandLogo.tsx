import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The supplied artwork has a square black canvas around a wide wordmark. This
 * fixed 3:1 viewport crops only that empty canvas and preserves the logo itself.
 */
export default function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative block aspect-[3/1] overflow-hidden rounded-lg bg-black",
        className
      )}
    >
      <Image
        src="/brand/noteforge-logo.jpg"
        alt="NoteForge"
        fill
        priority
        sizes="(max-width: 640px) 180px, 360px"
        className="object-cover object-[center_49.5%]"
      />
    </span>
  );
}
