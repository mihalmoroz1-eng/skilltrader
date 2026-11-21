import { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { installRequestBodyParsers } from "./bodyParser";

const oversizedBodies = [
  {
    name: "JSON",
    contentType: "application/json",
    body: JSON.stringify({ payload: "x".repeat(140 * 1024) }),
  },
  {
    name: "URL-encoded",
    contentType: "application/x-www-form-urlencoded",
    body: `payload=${"x".repeat(140 * 1024)}`,
  },
];

async function withTestServer(run: (url: string, wasRouteReached: () => boolean) => Promise<void>) {
  const app = express();
  installRequestBodyParsers(app);
  let routeReached = false;
  app.post("/api/trpc/test", (_req, res) => {
    routeReached = true;
    res.json({ accepted: true });
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}/api/trpc/test`, () => routeReached);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

describe("Express request-body limits", () => {
  it.each(oversizedBodies)("rejects oversized $name bodies before the route handler", async ({ contentType, body }) => {
    await withTestServer(async (url, wasRouteReached) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });
      await response.text();

      expect(response.status).toBe(413);
      expect(wasRouteReached()).toBe(false);
    });
  });

  it("allows a bounded JSON body to reach the route handler", async () => {
    await withTestServer(async (url, wasRouteReached) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: "synthetic educational input" }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: true });
      expect(wasRouteReached()).toBe(true);
    });
  });
});
