import "server-only";
import { notFound } from "next/navigation";
import { getViewer } from "./data";
import type { AppRole } from "./types";

/** Server-side page guard: hides admin pages from roles that may not open them. */
export async function requireRole(...roles: AppRole[]) {
  const viewer = await getViewer();
  if (!roles.includes(viewer.role)) notFound();
  return viewer;
}
