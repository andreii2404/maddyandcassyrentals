export interface SupabaseEmailFunctionConfig {
  supabaseUrl: string;
  functionName: string;
  serviceKey: string;
}

export const DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME = "send-booking-emails";

export interface EmailFunctionMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function buildSupabaseEmailRequest(
  config: SupabaseEmailFunctionConfig,
  message: EmailFunctionMessage,
): { url: string; init: RequestInit } {
  return {
    url: `${config.supabaseUrl.replace(/\/$/, "")}/functions/v1/${config.functionName}`,
    init: {
      method: "POST",
      headers: {
        apikey: config.serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      cache: "no-store",
    },
  };
}
