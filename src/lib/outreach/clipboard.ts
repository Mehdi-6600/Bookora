export type ClipboardWriter = Pick<Clipboard, "writeText">;

/** Return false instead of reporting a copy success when the browser blocks it. */
export async function writeClipboardText(
  text: string,
  clipboard: ClipboardWriter | null | undefined =
    typeof navigator === "undefined" ? undefined : navigator.clipboard
): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== "function") return false;

  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
