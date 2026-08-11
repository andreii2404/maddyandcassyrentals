export type PaymentReturnStatus = "success" | "cancelled";

export function safePaymentReturnPath(value: unknown, fallback: string): string {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\r") &&
    !value.includes("\n")
  ) {
    return value;
  }
  return fallback;
}

export function paymentReturnOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The payment return address is invalid.");
  }
  return url.origin;
}

export function buildPaymentReturnUrl(
  requestUrl: string,
  returnPath: string,
  status: PaymentReturnStatus,
): string {
  const url = new URL(returnPath, paymentReturnOrigin(requestUrl));
  url.searchParams.set("payment", status);
  return url.toString();
}
