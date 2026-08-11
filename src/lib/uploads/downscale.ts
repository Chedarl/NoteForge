"use client";

/**
 * Shrink a photographed page before it leaves the phone.
 *
 * Three problems, one fix: the upload is faster on a clinic's weak wifi, the
 * request to the OCR model is smaller (images go up as base64, which inflates
 * by a third), and vision tokens are billed by pixel count.
 *
 * **2400 pixels on the long edge, and not one pixel less.** This is the number
 * to argue with, so here is the argument: the thing in the photograph is
 * somebody's handwriting, often in biro, often at an angle, and frequently
 * containing a number that matters — a PHQ-9 score, a dose, a date. Every
 * downscale step trades legibility for speed, and a stroke lost here becomes a
 * misread digit in a clinical record. This limit is higher than a generic image
 * pipeline would choose, on purpose. Quality 0.92 for the same reason.
 *
 * Falls back to the original file on any failure. A photo that uploads large is
 * a slow success; a photo that does not upload is a lost session.
 */

const MAX_EDGE = 2400;
const QUALITY = 0.92;

export async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= MAX_EDGE) {
      bitmap.close();
      return file;
    }

    const scale = MAX_EDGE / longEdge;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    // Handwriting is thin high-contrast strokes; the cheap sampler eats them.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY)
    );
    if (!blob) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
