"use client";

import { usePathname } from "next/navigation";
import Navbar from "./Navbar";

const ADMIN_PREFIX = "/admin";
const ADMIN_EXCEPTIONS = ["/admin/sign-in"];

export default function NavbarGate() {
  const pathname = usePathname();
  const isHiddenAdminRoute =
    pathname.startsWith(ADMIN_PREFIX) && !ADMIN_EXCEPTIONS.includes(pathname);

  if (isHiddenAdminRoute) return null;

  return <Navbar />;
}
