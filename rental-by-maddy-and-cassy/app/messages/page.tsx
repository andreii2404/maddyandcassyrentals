import type { Metadata } from "next";
import MessagesPageClient from "./MessagesPageClient";

export const metadata: Metadata = {
  title: "Messages | Rental by Maddy & Cassy",
  description: "Chat with the Maddy & Cassy rental support team.",
};

export default function MessagesPage() {
  return <MessagesPageClient />;
}
