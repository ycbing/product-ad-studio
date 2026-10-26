export const ownerId = () => process.env.LOCAL_OWNER_ID || "local-owner";
// This milestone intentionally binds Next to loopback; it is not a public multiuser service.
export function checkLocalRequest(request: Request) {
  const expected = new URL(process.env.APP_ORIGIN || "http://127.0.0.1:3100");
  const url = new URL(request.url);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.port !== expected.port
  )
    throw Object.assign(new Error("当前版本仅允许本机访问"), { status: 403 });
  const origin = request.headers.get("origin");
  if (origin) {
    const o = new URL(origin);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(o.hostname) ||
      o.port !== expected.port
    )
      throw Object.assign(new Error("请求来源不受信任"), { status: 403 });
  }
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw Object.assign(new Error("不允许跨站访问本地文件与项目"), {
      status: 403,
    });
}
