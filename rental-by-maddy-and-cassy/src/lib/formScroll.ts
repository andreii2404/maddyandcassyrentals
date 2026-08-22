/**
 * Scrolls to and focuses the first field (in the given visual order) that
 * currently has an error, so the user lands on the top-most problem instead
 * of hunting through a multi-section form.
 */
export function scrollToFirstError(
  fieldOrder: readonly string[],
  errors: Record<string, string | undefined>,
): void {
  const firstInvalidId = fieldOrder.find((id) => errors[id]);
  if (!firstInvalidId) return;

  const element = document.getElementById(firstInvalidId);
  if (!element) return;

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => {
    if (typeof (element as HTMLElement).focus === "function") {
      (element as HTMLElement).focus({ preventScroll: true });
    }
  }, 300);
}
