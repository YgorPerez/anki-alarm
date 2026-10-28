// The sync service's entry. Sync itself (push, pull, sign-in, media) comes later; for now it
// answers the health check deploys and uptime probes use.
export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") return Response.json({ ok: true });
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
