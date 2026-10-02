/**
 * Browser-only helper that turns an uploaded signature image (PNG, JPEG or
 * WebP data URL) into a PNG data URL small enough for the business-signature
 * API, which only accepts PNGs of at most 1 MB.
 */

const MAX_OUTPUT_DATA_URL_LENGTH = Math.floor((900_000 * 4) / 3);
const WIDTH_STEPS = [1000, 700, 500, 320];
const MAX_HEIGHT_RATIO = 0.6;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be read."));
    image.src = dataUrl;
  });
}

export async function normalizeSignatureImageToPng(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (sourceWidth < 1 || sourceHeight < 1) {
    throw new Error("The selected image could not be read.");
  }

  for (const maxWidth of WIDTH_STEPS) {
    const maxHeight = Math.round(maxWidth * MAX_HEIGHT_RATIO);
    const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The selected image could not be processed.");

    // JPEGs have no alpha channel; paint white so they never turn black as PNG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const png = canvas.toDataURL("image/png");
    if (png.length <= MAX_OUTPUT_DATA_URL_LENGTH) return png;
  }

  throw new Error("The selected image is too detailed to use as a signature. Choose a simpler image.");
}
