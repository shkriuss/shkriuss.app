/**
 * Reads JSON with comments and trailing commas (the format of wrangler.jsonc).
 * Comments inside strings are left alone.
 */
export function parseJsonc(text: string): unknown {
  let output = '';
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (char === '\\') {
        output += next ?? '';
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      output += char;
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      output += '\n';
    } else if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index += 1;
    } else {
      output += char;
    }
  }
  // Remove trailing commas before } or ].
  return JSON.parse(output.replace(/,(\s*[}\]])/g, '$1'));
}
