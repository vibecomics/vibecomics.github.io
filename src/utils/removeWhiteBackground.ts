/**
 * Best-effort transparency: flood-fills near-white pixels connected to the image border into
 * transparency, leaving interior near-white details (a white shoe, a highlight) alone since they
 * aren't connected to the edge. Browser-only (uses canvas) — the CLI has no equivalent, same as
 * thumbnail generation; foreground images generated there just keep their plain white background.
 *
 * A hard 0/255 alpha cutoff leaves a halo on anti-aliased edges: pixels that are a soft blend of
 * white background and subject color (thin gaps between legs, hair strands, tentacles) are too
 * gray to pass WHITE_THRESHOLD, so they stay fully opaque with white baked into their RGB. To fix
 * that, pixels near the flood-filled region get a soft alpha instead (FEATHER_THRESHOLD) and are
 * "decontaminated" — the white contribution is unmixed out of their RGB — rather than left as-is.
 *
 * Some providers (e.g. a ComfyUI workflow with a background-removal node wired in) already return
 * a real cutout. Re-running this heuristic on top of that would be redundant at best and, since it
 * reads RGB rather than trusting existing alpha, could clip a legitimate near-white detail that
 * touches the image border. So an image that already has a meaningful share of non-opaque pixels
 * is returned unchanged.
 */
const WHITE_THRESHOLD = 18;
const FEATHER_THRESHOLD = 90;
const FEATHER_RADIUS = 3;
const ALREADY_TRANSPARENT_FRACTION = 0.005;

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

  let alreadyTransparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) alreadyTransparent++;
  if (alreadyTransparent / (data.length / 4) > ALREADY_TRANSPARENT_FRACTION) return dataUrl;

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
  // Multi-source BFS from the background mask to find fringe pixels within FEATHER_RADIUS of it.
  const distance = new Uint8Array(width * height).fill(255);
  let frontier: number[] = [];
  for (let p = 0; p < visited.length; p++) {
    if (visited[p]) {
      distance[p] = 0;
      frontier.push(p);
    }
  }
  for (let d = 1; d <= FEATHER_RADIUS && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % width;
      const y = (p / width) | 0;
      const neighbors: Array<[number, number]> = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const np = ny * width + nx;
        if (!visited[np] && distance[np] === 255) {
          distance[np] = d;
          next.push(np);
        }
      }
    }
    frontier = next;
  }

  for (let p = 0; p < visited.length; p++) {
    const i = p * 4;
    if (visited[p]) {
      data[i + 3] = 0;
      continue;
    }
    if (distance[p] > FEATHER_RADIUS) continue;
    const maxDiff = Math.max(255 - data[i], 255 - data[i + 1], 255 - data[i + 2]);
    if (maxDiff >= FEATHER_THRESHOLD) continue;
    const whiteness = Math.min(
      1,
      Math.max(0, 1 - (maxDiff - WHITE_THRESHOLD) / (FEATHER_THRESHOLD - WHITE_THRESHOLD))
    );
    data[i + 3] = Math.round(255 * (1 - whiteness));
    if (whiteness < 1) {
      for (let c = 0; c < 3; c++) {
        const decontaminated = (data[i + c] - whiteness * 255) / (1 - whiteness);
        data[i + c] = Math.min(255, Math.max(0, Math.round(decontaminated)));
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
