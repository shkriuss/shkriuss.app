/**
 * Draws a QR code (../lib/qr.ts) as an SVG image inside `container`,
 * replacing what's there. Built with DOM methods, never HTML strings, so it
 * works with the strict Content Security Policy. Styles: .qr-code.
 *
 *   renderQrCode(element, 'https://…', 'QR code for adding a device');
 */
import { encodeQr } from '../lib/qr.ts';

const SVG = 'http://www.w3.org/2000/svg';
/** The standard asks for 4 light modules around the code. */
const QUIET_ZONE = 4;

export function renderQrCode(container: Element, text: string, label: string): void {
  const code = encodeQr(text);
  const extent = code.size + QUIET_ZONE * 2;

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `${-QUIET_ZONE} ${-QUIET_ZONE} ${extent} ${extent}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.classList.add('qr-code');

  const light = document.createElementNS(SVG, 'rect');
  for (const [name, value] of Object.entries({
    x: -QUIET_ZONE,
    y: -QUIET_ZONE,
    width: extent,
    height: extent,
  })) {
    light.setAttribute(name, String(value));
  }
  light.classList.add('qr-code__light');

  // One path with a 1×1 square per dark module.
  let squares = '';
  code.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) squares += `M${x} ${y}h1v1h-1z`;
    });
  });
  const dark = document.createElementNS(SVG, 'path');
  dark.setAttribute('d', squares);
  dark.classList.add('qr-code__dark');

  svg.append(light, dark);
  container.replaceChildren(svg);
}
