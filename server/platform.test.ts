import { afterEach, describe, expect, it, vi } from "vitest";
import { publicPlatformConfig, publicPlatformScript } from "./_core/publicConfig";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { invokeLLM, listLLMModels, LlmInvocationError } from "./_core/llm";
import { generateImage } from "./_core/imageGeneration";
import { COOKIE_NAME } from "../shared/const";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("current platform integration", () => {
  it("exposes only named public runtime configuration", () => {
    const env = { MANUS_PROJECT_ID: "project-test", MANUS_API_KEY: "server-only-test", MANUS_JWT_SECRET: "signing-only-test", DATABASE_URL: "db-only-test", MANUS_API_BROWSER_KEY: "public-browser-test", MANUS_ANALYTICS_ENDPOINT: "https://analytics.example", MANUS_ANALYTICS_WEBSITE_ID: "site-test" };
    expect(publicPlatformConfig(env)).toMatchObject({ projectId: "project-test", apiBrowserKey: "public-browser-test" });
    const script = publicPlatformScript(env);
    for (const value of [env.MANUS_API_KEY, env.MANUS_JWT_SECRET, env.DATABASE_URL]) expect(script).not.toContain(value);
    const appended: unknown[] = [];
    const fakeDocument = { createElement: () => ({ setAttribute() {} }), head: { appendChild: (node: unknown) => appended.push(node) } };
    new Function("window", "document", script)({}, fakeDocument);
    expect(appended).toHaveLength(0);
    new Function("window", "document", publicPlatformScript({}))({}, fakeDocument);
    expect(appended).toHaveLength(0);
  });
  it("does not guess a production API when the project environment is absent", async () => {
    vi.stubEnv("MANUS_API_URL", ""); vi.stubEnv("MANUS_API_KEY", "test-only");
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    await expect(listLLMModels()).rejects.toThrow("MANUS_API_URL");
    expect(request).not.toHaveBeenCalled();
  });
  it("forwards GPT completion-token caps and reasoning in the documented payload", async () => {
    vi.stubEnv("MANUS_API_URL", "https://api.example"); vi.stubEnv("MANUS_API_KEY", "test-only");
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "completion-test", created: 1, model: "gpt-6-luna",
      choices: [{ index: 0, message: { role: "assistant", content: "Учебный ответ" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    await invokeLLM({
      model: "gpt-6-luna",
      messages: [{ role: "user", content: "Объясни" }],
      maxCompletionTokens: 700,
      reasoning: { effort: "low" },
    });
    const payload = JSON.parse(request.mock.calls[0][1].body as string);
    expect(payload).toMatchObject({ model: "gpt-6-luna", max_completion_tokens: 700, reasoning: { effort: "low" } });
    expect(payload).not.toHaveProperty("max_tokens");
  });
  it("does not retry permanent upstream 4xx errors and does not expose their body", async () => {
    vi.stubEnv("MANUS_API_URL", "https://api.example"); vi.stubEnv("MANUS_API_KEY", "test-only");
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "unsupported_model", message: "private upstream detail" } }), {
      status: 400, statusText: "Bad Request", headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", request);
    const pending = invokeLLM({ model: "gpt-6-luna", messages: [{ role: "user", content: "test" }] });
    await expect(pending).rejects.toBeInstanceOf(LlmInvocationError);
    await expect(pending).rejects.toMatchObject({ status: 400, upstreamCode: "unsupported_model", retryable: false });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("retries transient upstream 5xx errors", async () => {
    vi.stubEnv("MANUS_API_URL", "https://api.example"); vi.stubEnv("MANUS_API_KEY", "test-only");
    const request = vi.fn()
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "transient-test", created: 1, model: "gpt-6-luna",
        choices: [{ index: 0, message: { role: "assistant", content: "Recovered" }, finish_reason: "stop" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    await expect(invokeLLM({ model: "gpt-6-luna", messages: [{ role: "user", content: "test" }] })).resolves.toMatchObject({ model: "gpt-6-luna" });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("persists URL-only image results through current managed storage", async () => {
    vi.stubEnv("MANUS_API_URL", "https://api.example"); vi.stubEnv("MANUS_API_KEY", "test-only");
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ image: { url: "https://image.example/result.png", mimeType: "image/png" } })))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://upload.example/object" })))
      .mockResolvedValueOnce(new Response(""));
    vi.stubGlobal("fetch", request);
    const image = await generateImage({ prompt: "test", originalImages: [] });
    expect(image.url).toMatch(/^\/manus-storage\/generated\//);
    expect(request).toHaveBeenCalledTimes(4);
    expect(JSON.parse(request.mock.calls[0][1].body)).toHaveProperty("originalImages");
  });
  it("uses a distinct secure app cookie behind the HTTPS Preview proxy", () => {
    expect(COOKIE_NAME).not.toBe("app_session_id");
    expect(getSessionCookieOptions({ protocol: "http", headers: {} } as never)).toMatchObject({ secure: true, httpOnly: true, sameSite: "none" });
  });
  it("binds signed app sessions to this project and accepts an empty display name", async () => {
    vi.stubEnv("MANUS_PROJECT_ID", "project-test");
    vi.stubEnv("MANUS_JWT_SECRET", "unit-test-signing-key-never-deployed");
    const token = await sdk.signSession({ openId: "user-test", appId: "project-test", name: "" });
    expect(await sdk.verifySession(token)).toMatchObject({ openId: "user-test" });
    vi.stubEnv("MANUS_PROJECT_ID", "different-project");
    expect(await sdk.verifySession(token)).toBeNull();
  });
  it("authenticates a valid signed session without a database", async () => {
    vi.stubEnv("MANUS_PROJECT_ID", "project-test");
    vi.stubEnv("MANUS_JWT_SECRET", "unit-test-signing-key-never-deployed");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("OWNER_OPEN_ID", "owner-test");
    const token = await sdk.signSession({ openId: "user-test", appId: "project-test", name: "Demo user" });
    const user = await sdk.authenticateRequest({
      headers: { cookie: `${COOKIE_NAME}=${token}` },
      path: "/api/trpc/traderAssistant.chat",
    } as never);
    expect(user).toMatchObject({ openId: "user-test", name: "Demo user", role: "user", id: -1 });
  });
});
