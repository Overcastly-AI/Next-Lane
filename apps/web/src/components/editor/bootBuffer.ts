/**
 * Keystrokes typed while the (lazy) editor is still loading land in the
 * skeleton's hidden input and are handed to the editor once it mounts, so
 * "click, start typing" never loses characters.
 */
let pending = '';
export const bootBuffer = {
  push(text: string) {
    pending = text;
  },
  take(): string {
    const t = pending;
    pending = '';
    return t;
  },
};
