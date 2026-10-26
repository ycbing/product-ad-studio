import { handle } from "@/lib/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
async function route(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return handle(req, (await context.params).path);
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
