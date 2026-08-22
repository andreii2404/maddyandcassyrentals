"use client";

import { getSharedBrowserClient } from "./browserSingleton";

export function createClient() {
  return getSharedBrowserClient();
}
