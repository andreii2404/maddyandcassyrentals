export type FeedbackVariant = "success" | "error" | "warning" | "info";

export const GENERIC_ERROR_MESSAGE = "Something went wrong on our end. Please try again in a moment.";
export const NETWORK_ERROR_MESSAGE =
  "We couldn't reach the server. Please check your internet connection and try again.";

// "Error reference: <id>", "Request ID: <id>" and similar support tags are for
// developers and logs, never for the person reading the popup.
const REFERENCE_TAG =
  /[\s(\[]*\b(?:error\s+(?:reference|ref|id|code)|(?:reference|request|trace|correlation|incident)\s+id)\s*[:#]\s*[\w-]+[)\]]*\.?/gi;

const NETWORK_FAILURE =
  /failed to fetch|networkerror|network request failed|\bload failed\b|fetch failed|ERR_NETWORK|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i;

const TECHNICAL_PATTERNS: RegExp[] = [
  // Database and API internals
  /duplicate key value|violates (?:foreign key|unique|check|not-null|row-level)|row-level security|null value in column/i,
  /relation ".+?" does not exist|column .+? (?:of relation|does not exist)|schema cache|permission denied for|SQLSTATE|\bPGRST\d+|could not find the .+ column/i,
  /\bpublic\.\w+/i,
  // Runtime and parsing errors
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|AbortError|AuthApiError|AuthRetryableFetchError|StorageApiError|FunctionsHttpError|PostgrestError)\b/,
  /Cannot read propert|is not a function|\bundefined\b|\bNaN\b|Unexpected token|not valid JSON|JSON at position|Unexpected end of JSON/i,
  /\bat\s+\S+\s+\(.*:\d+:\d+\)/,
  // Raw codes, ids and HTTP details
  /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\b(?:status(?: code)?|http)\s*:?\s*[1-5]\d\d\b/i,
  /^request failed\b/i,
  /\b[1-5]\d\d\s+(?:bad request|unauthorized|forbidden|not found|internal server error|bad gateway|service unavailable)\b/i,
  /^\s*[{[]/,
  /\bJWT\b/,
  // Hosting and configuration talk meant for developers
  /\bsupabase\b|\bvercel\b|environment variable|\.env\b|\bapi key\b|\bservice role\b|\bwebhook\b/i,
];

// Past participle -> base verb, used to turn "The X could not be saved." into
// "We couldn't save the X."
const PARTICIPLES: Record<string, string> = {
  added: "add",
  approved: "approve",
  cancelled: "cancel",
  canceled: "cancel",
  changed: "change",
  completed: "complete",
  confirmed: "confirm",
  countersigned: "countersign",
  created: "create",
  deleted: "delete",
  disabled: "disable",
  downloaded: "download",
  enabled: "enable",
  found: "find",
  generated: "generate",
  hidden: "hide",
  loaded: "load",
  opened: "open",
  processed: "process",
  published: "publish",
  recorded: "record",
  refreshed: "refresh",
  rejected: "reject",
  reloaded: "reload",
  removed: "remove",
  replaced: "replace",
  restored: "restore",
  reviewed: "review",
  saved: "save",
  sent: "send",
  submitted: "submit",
  updated: "update",
  uploaded: "upload",
  verified: "verify",
};

const COULD_NOT_BE = /^(The|This|That|These|Those|Your) ([^.]+?) could(?: not|n't) be (\w+)([^.]*)\./;

// Wording that already tells the reader what to do next.
const GUIDANCE =
  /\bplease\b|try again|\brefresh\b|\bcontact\b|check your|\bchoose\b|\benter\b|\bselect\b|sign in|make sure|\breload\b/i;

function hasGuidance(text: string): boolean {
  return GUIDANCE.test(text);
}

function isTechnical(text: string): boolean {
  return TECHNICAL_PATTERNS.some((pattern) => pattern.test(text));
}

function rewriteCouldNotBe(text: string): string {
  const match = COULD_NOT_BE.exec(text);
  if (!match) return text;
  const [whole, determiner, noun, participle, rest] = match;
  const verb = PARTICIPLES[participle.toLowerCase()];
  if (!verb) return text;
  const remainder = text.slice(whole.length);
  const rewritten = `We couldn't ${verb} ${determiner.toLowerCase()} ${noun}${rest}.${remainder}`;
  return hasGuidance(remainder) ? rewritten : `${rewritten.trimEnd()} Please try again.`;
}

/**
 * Turns whatever message reached the UI (API text, thrown error text, a
 * hard-coded string) into wording that is safe and friendly to show in a popup:
 * no error references, raw codes or developer-style text.
 */
export function friendlyMessage(raw: string, variant: FeedbackVariant = "info"): string {
  const text = (raw ?? "").replace(REFERENCE_TAG, "").replace(/\s+/g, " ").trim();
  if (!text) return GENERIC_ERROR_MESSAGE;
  if (NETWORK_FAILURE.test(text)) return NETWORK_ERROR_MESSAGE;
  if (isTechnical(text)) return GENERIC_ERROR_MESSAGE;
  return variant === "error" ? rewriteCouldNotBe(text) : text;
}

/** A short "what you can do next" line, or null when the message already says it. */
export function feedbackNextStep(variant: FeedbackVariant, message: string): string | null {
  if (hasGuidance(message)) return null;
  switch (variant) {
    case "error":
      return "You can try again in a moment. If it keeps happening, please contact Maddy & Cassy.";
    case "warning":
      return "Please check the details you entered, then continue.";
    default:
      return "You can close this and keep going.";
  }
}
