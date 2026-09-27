/** Longest side, in pixels, of a generated thumbnail. */
export const THUMBNAIL_SIZE = 256;

/** The file extension for a mime type, e.g. "image/jpeg" -> "jpg". */
export function extensionForMimeType(mimeType: string): string {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1] || 'png';
}

/** The file name for the thumbnail of `name`, e.g. "hero.png" -> "hero.thumb.png". */
export function thumbnailName(name: string, mimeType: string): string {
  return `${name.replace(/\.[^.]+$/, '')}.thumb.${extensionForMimeType(mimeType)}`;
}

/**
 * A small copy of an image: PNG when it has see-through pixels (so cut-outs stay cut-outs), JPEG
 * otherwise. Null when the browser cannot decode the image.
 */
export async function makeThumbnail(image: Blob, name: string): Promise<File | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let transparent = false;
    for (let i = 3; i < data.length && !transparent; i += 4) transparent = data[i] < 255;
    const type = transparent ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    return blob && new File([blob], thumbnailName(name, type), { type });
  } finally {
    bitmap.close();
  }
}
