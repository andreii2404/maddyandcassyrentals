export interface SupabaseEmailFunctionConfig {
  supabaseUrl: string;
  functionName: string;
  serviceKey: string;
}

export const DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME = "send-booking-emails";

export interface EmailFunctionMessage {
  eventKey?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function buildSupabaseEmailRequest(
  config: SupabaseEmailFunctionConfig,
  message: EmailFunctionMessage,
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = {
    apikey: config.serviceKey,
    "Content-Type": "application/json",
  };

  // New Supabase secret keys are opaque values, not JWTs. Sending one as a
  // Bearer token causes the Edge Functions gateway to reject the request as an
  // invalid JWT before the function handler runs. Legacy service_role keys
  // remain compatible with the Authorization header.
  if (!config.serviceKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${config.serviceKey}`;
  }

  return {
    url: `${config.supabaseUrl.replace(/\/$/, "")}/functions/v1/${config.functionName}`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      cache: "no-store",
    },
  };
}
