import { Hono } from "hono";
import { apiError } from "@relay/contracts";
import { log } from "./log.js";
import { runHealthChecks } from "./health.js";
import type { Env } from "./env.js";

export { RelayKernelContainer } from "./kernel.js";

type Variables = { requestId: string };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  const start = Date.now();
  await next();
  log("request", {
    request_id: requestId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    duration_ms: Date.now() - start,
  });
});

app.get("/api/health", async (c) => {
  const report = await runHealthChecks(
    c.env,
    new URL(c.req.url).origin,
    c.get("requestId"),
  );
  return c.json(report, report.all_ok ? 200 : 503);
});

app.notFound((c) =>
  c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404),
);

app.onError((err, c) => {
  log("unhandled_error", {
    request_id: c.get("requestId") ?? "unknown",
    error_name: err.name,
    error_message: err.message,
  });
  // Never a stack trace, env value, or config detail in a response body.
  return c.json(apiError("INTERNAL", "error.generic.internal"), 500);
});

export default app;
