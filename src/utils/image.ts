/** Width/height of a PNG straight from its IHDR chunk (no DOM/canvas needed, works in Node too). */
export function pngDimensions(dataUrl: string): { width: number; height: number } | null {
  const match = dataUrl.match(/^data:image\/png;base64,(.*)$/s);
  if (!match) return null;
  const bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
