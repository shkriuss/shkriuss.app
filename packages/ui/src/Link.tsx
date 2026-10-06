import { Link as AriaLink, type LinkProps as AriaLinkProps } from "react-aria-components";

export type LinkProps = Omit<AriaLinkProps, "className" | "style">;

/** A link: underlined, in the accent color, as the base styles have it. */
export function Link(props: LinkProps) {
  return <AriaLink {...props} className="rounded-sm" />;
}
