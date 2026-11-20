import { COOKIE_NAME } from "@shared/const";
import { traderAssistantInputSchema } from "@shared/traderAssistant";
import { TRPCError } from "@trpc/server";
import { assertLLMConfigured, LlmConfigurationError, LlmInvocationError } from "./_core/llm";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { askTraderAssistant, TraderAssistantPipelineOutputError, traderAssistantRateLimiter } from "./traderAssistant";

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
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Чат временно ограничил новые сессии. Подождите и отправьте вопрос вручную позже; немедленный повтор недоступен." });
          }
          if (limit.scope === "day") {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Дневной лимит Skill Trader AI достигнут. Отправьте вопрос вручную после сброса лимита в 00:00 UTC; немедленный повтор недоступен." });
          }
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Слишком много запросов подряд. Отправьте вопрос вручную через ${limit.retryAfterSeconds} сек.; автоматического или немедленного повтора нет.` });
        }

        try {
          return await askTraderAssistant(input);
        } catch (error) {
          if (error instanceof LlmConfigurationError) {
            console.error("[Skill Trader AI] Missing project model configuration", error.missingSetting);
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Служебная конфигурация AI требует проверки владельцем проекта." });
          }
          if (error instanceof TraderAssistantPipelineOutputError) {
            console.error("[Skill Trader AI] Invalid structured output", error.stage);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Один из внутренних AI-этапов вернул неподходящий формат. Ответ не показан; автоматического повтора нет.",
            });
          }
          if (error instanceof LlmInvocationError) {
            const code = error.upstreamCode?.toLowerCase() ?? "";
            console.error("[Skill Trader AI] Upstream error", error.status, code || "unknown");

            if (error.status === 429 || /rate.?limit|too_many_requests/.test(code)) {
              throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Сервис AI ограничил частоту запросов. Подождите и отправьте вопрос вручную позже; автоматического повтора нет." });
            }
            if (/insufficient.*(credit|quota)|quota.*(exceed|insufficient)/.test(code)) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Недостаточно project credits для Skill Trader AI. Пополните проектный лимит и отправьте вопрос вручную; завершённые этапы могли расходовать credits. Автоматического повтора нет." });
            }
            if (error.status === 400 || error.status === 404 || error.status === 422 || /unsupported[_ -]?model|invalid[_ -]?model/.test(code)) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Модель отклонила запрос. Владелец проекта может проверить модель и параметры." });
            }
            if (error.status >= 400 && error.status < 500) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Служебная конфигурация AI требует проверки владельцем проекта." });
            }
            if (error.retryable) {
              throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Сервис Skill Trader AI временно недоступен. Кнопка запускает цепочку заново с первого этапа и может выполнить до трёх модельных вызовов." });
            }
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Сервис модели вернул постоянную ошибку; владелец проекта может проверить настройки AI." });
          }
          console.error("[Skill Trader AI] Model request failed", error instanceof Error ? error.name : "unknown error");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Непредвиденная внутренняя ошибка Skill Trader AI. Автоматический повтор недоступен; внутренние подробности скрыты.",
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
