import { COOKIE_NAME } from "@shared/const";
import { traderAssistantInputSchema } from "@shared/traderAssistant";
import { TRPCError } from "@trpc/server";
import { assertLLMConfigured, LlmConfigurationError, LlmInvocationError } from "./_core/llm";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { askTraderAssistant, traderAssistantRateLimiter } from "./traderAssistant";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  traderAssistant: router({
    chat: protectedProcedure
      .input(traderAssistantInputSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          assertLLMConfigured();
        } catch (error) {
          if (error instanceof LlmConfigurationError) {
            console.error("[Skill Trader AI] Missing project model configuration", error.missingSetting);
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Служебная конфигурация AI требует проверки владельцем проекта." });
          }
          throw error;
        }

        const limit = traderAssistantRateLimiter.consume(ctx.user.openId);
        if (!limit.allowed) {
          if (limit.scope === "capacity") {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Чат временно достиг лимита активных сессий. Попробуйте позже." });
          }
          if (limit.scope === "day") {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Дневной лимит Skill Trader AI достигнут. Попробуйте завтра." });
          }
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Слишком много запросов подряд. Повторите через ${limit.retryAfterSeconds} сек.` });
        }

        try {
          return await askTraderAssistant(input);
        } catch (error) {
          if (error instanceof LlmConfigurationError) {
            console.error("[Skill Trader AI] Missing project model configuration", error.missingSetting);
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Служебная конфигурация AI требует проверки владельцем проекта." });
          }
          if (error instanceof LlmInvocationError) {
            const code = error.upstreamCode?.toLowerCase() ?? "";
            console.error("[Skill Trader AI] Upstream error", error.status, code || "unknown");

            if (error.status === 429 || /rate.?limit|too_many_requests/.test(code)) {
              throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Сервис AI ограничил частоту запросов. Подождите и повторите попытку." });
            }
            if (/insufficient.*(credit|quota)|quota.*(exceed|insufficient)/.test(code)) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Временно недоступны project credits для Skill Trader AI. Повторите запрос позже." });
            }
            if (error.status === 400 || error.status === 404 || error.status === 422 || /unsupported[_ -]?model|invalid[_ -]?model/.test(code)) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Модель отклонила запрос. Владелец проекта может проверить модель и параметры." });
            }
            if (error.status >= 400 && error.status < 500) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Служебная конфигурация AI требует проверки владельцем проекта." });
            }
            if (error.retryable) {
              throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Сервис Skill Trader AI временно недоступен. Попробуйте позже." });
            }
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Сервис модели вернул постоянную ошибку; владелец проекта может проверить настройки AI." });
          }
          console.error("[Skill Trader AI] Model request failed", error instanceof Error ? error.name : "unknown error");
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "Сервис Skill Trader AI временно недоступен. Попробуйте позже.",
          });
        }
      }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
