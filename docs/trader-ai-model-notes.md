# Skill Trader AI — model reference

Catalog checks were performed on **2026-11-20** before implementation.

- The bound WebDev project’s `GET $MANUS_API_URL/v1/models` returned HTTP 200 and included the exact requested ID `gpt-6-luna`. This is the project-specific availability check; `server/_core/llm.ts` exposes the same catalog through `listLLMModels()`.
- The Manus Sandbox live model catalog at `GET $OPENAI_API_BASE/models` identifies the entry as **GPT-6 Luna** (`owned_by: openai`). Its description rates cost per task as low, instruction following/factual accuracy/writing/coding/tool use as middle, and reasoning as bottom. The catalog lists effort values `none`, `low`, `medium`, `high`, `xhigh`, and `max`, with `medium` as the default.
- The catalog reports support for structured JSON-schema output, vision, tools, and reasoning; streaming is not supported. This chat does not use vision, tools, or structured output.
- The server request uses `reasoning: { effort: "low" }` and the GPT-family `max_completion_tokens` cap. Calls run through the project server helper and consume project credits; no provider credential is sent to the browser.

Sources: live project and Sandbox model catalogs at the endpoints above; `/home/ubuntu/skills/builtin-llm-models/SKILL.md` (especially Steps 1–3 and WebDev sections C1–C2); `/home/ubuntu/skills/webdev/references/llm.md`; `/home/ubuntu/skills/webdev/references/service-api.md`. Credentials and concrete endpoint values are intentionally not recorded.
