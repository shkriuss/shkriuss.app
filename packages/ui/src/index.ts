/**
 * React Aria adds a stylesheet to the page for its buttons, links and other pressable elements:
 * `touch-action` that spares them the delay of double-tap zooming. The Content-Security-Policy
 * refuses stylesheets in the page (`style-src 'self'`), so styles.css has the same rule, and
 * this marks it present, before any component renders: React Aria adds its stylesheet only when
 * no element has its id.
 */
const PRESSABLE_STYLE_ID = "react-aria-pressable-style";

if (typeof document !== "undefined" && document.getElementById(PRESSABLE_STYLE_ID) === null) {
  const marker = document.createElement("meta");
  marker.id = PRESSABLE_STYLE_ID;
  document.head.append(marker);
}

export { Banner, type BannerProps } from "./Banner.tsx";
export { Button, type ButtonProps } from "./Button.tsx";
export { contrastRatio, isHexColor, relativeLuminance } from "./contrast.ts";
export { Dialog, type DialogProps } from "./Dialog.tsx";
export { FileButton, type FileButtonProps } from "./FileButton.tsx";
export { Link, type LinkProps } from "./Link.tsx";
export { Switch, type SwitchProps } from "./Switch.tsx";
export { TextField, type TextFieldProps } from "./TextField.tsx";
