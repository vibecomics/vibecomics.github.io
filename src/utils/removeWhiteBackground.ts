/**
 * Best-effort transparency: flood-fills near-white pixels connected to the image border into
 * transparency, leaving interior near-white details (a white shoe, a highlight) alone since they
 * aren't connected to the edge. Browser-only (uses canvas) — the CLI has no equivalent, same as
 * thumbnail generation; foreground images generated there just keep their plain white background.
 */
const WHITE_THRESHOLD = 18;

export async function removeWhiteBackground(dataUrl: string): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  const { width, height } = image;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(image, 0, 0);

  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const isNearWhite = (i: number) =>
    255 - data[i] <= WHITE_THRESHOLD &&
    255 - data[i + 1] <= WHITE_THRESHOLD &&
    255 - data[i + 2] <= WHITE_THRESHOLD;

  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p] || !isNearWhite(p * 4)) return;
    visited[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    const x = p % width;
    const y = (p / width) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  for (let p = 0; p < visited.length; p++) {
    if (visited[p]) data[p * 4 + 3] = 0;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
