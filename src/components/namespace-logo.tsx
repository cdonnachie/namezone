import Image from "next/image";
import type { NamespaceConfig } from "@/lib/namespaces";

/**
 * Renders a namespace's logo, swapping to logoPathDark in dark mode when the
 * namespace has one. Both images ship in the page (rather than switching src
 * client-side) so the right one is already there for the CSS to reveal -
 * no flash/layout shift on theme change, and it still works from server
 * components since the swap is pure `dark:` CSS, not JS.
 */
/**
 * Renders a namespace's wordmark (wide logotype) with the same CSS-only
 * dark-mode swap as NamespaceLogo. Returns null when the namespace has no
 * wordmark - callers fall back to the square logomark.
 */
export function NamespaceWordmark({
  namespace,
  height,
  width,
  priority,
  alt = "",
}: {
  namespace: Pick<NamespaceConfig, "wordmarkPath" | "wordmarkPathDark">;
  height: number;
  width: number;
  priority?: boolean;
  alt?: string;
}) {
  if (!namespace.wordmarkPath) return null;

  if (!namespace.wordmarkPathDark) {
    return <Image src={namespace.wordmarkPath} alt={alt} width={width} height={height} priority={priority} />;
  }

  return (
    <>
      <Image
        src={namespace.wordmarkPath}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className="dark:hidden"
      />
      <Image
        src={namespace.wordmarkPathDark}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className="hidden dark:block"
      />
    </>
  );
}

export function NamespaceLogo({
  namespace,
  size,
  priority,
  alt = "",
}: {
  namespace: Pick<NamespaceConfig, "logoPath" | "logoPathDark">;
  size: number;
  priority?: boolean;
  alt?: string;
}) {
  if (!namespace.logoPathDark) {
    return <Image src={namespace.logoPath} alt={alt} width={size} height={size} priority={priority} />;
  }

  return (
    <>
      <Image
        src={namespace.logoPath}
        alt={alt}
        width={size}
        height={size}
        priority={priority}
        className="dark:hidden"
      />
      <Image
        src={namespace.logoPathDark}
        alt={alt}
        width={size}
        height={size}
        priority={priority}
        className="hidden dark:block"
      />
    </>
  );
}
