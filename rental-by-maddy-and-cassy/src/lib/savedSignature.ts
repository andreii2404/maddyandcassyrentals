export function canApplySavedSignature(currentPreview: string | null, changedLocally: boolean): boolean {
  return !currentPreview && !changedLocally;
}

/** Match the existing booking signature upload rules. */
export function validateSavedSignatureFile(file: Pick<File, "size" | "type">): string | null {
  if (file.size === 0) return "Choose a file to upload.";
  if (file.size > 4 * 1024 * 1024) return "Each file must be 4MB or smaller.";
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "The selected file type is not supported.";
  }
  return null;
}
