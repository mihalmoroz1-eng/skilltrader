import { COOKIE_NAME } from "@shared/const";
import { traderAssistantInputSchema } from "@shared/traderAssistant";
import { marketDataRequestSchema } from "@shared/marketData";
import { TRPCError } from "@trpc/server";
import { assertLLMConfigured, LlmConfigurationError, LlmInvocationError } from "./_core/llm";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { askTraderAssistant, TraderAssistantPipelineOutputError, traderAssistantRateLimiter } from "./traderAssistant";
import { BinanceSpotProvider, MarketDataProviderError } from "./market-data/providers/BinanceSpotProvider";
import { MarketDataNormalizationError } from "./market-data/core/MarketDataNormalizer";
import { MarketDataValidationError } from "./market-data/core/MarketDataValidator";
import { MarketDataProcessingError, processMarketData } from "./market-data/core/MarketDataProcessor";
import { MarketDataRequestError, MarketDataService } from "./market-data/services/MarketDataService";
import { marketDataRateLimiter } from "./market-data/services/MarketDataRateLimiter";

const marketDataService = new MarketDataService(new BinanceSpotProvider());

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

  marketData: router({
    candles: protectedProcedure
      .input(marketDataRequestSchema)
      .query(async ({ ctx, input }) => {
        const limit = marketDataRateLimiter.consume(ctx.user.openId);
        if (!limit.allowed) {
          const scopeText = limit.scope === "capacity"
            ? "Сервис временно ограничил новые пользовательские сессии."
            : "Достигнут лимит запросов рыночных данных.";
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `${scopeText} Повторите запрос через ${limit.retryAfterSeconds} сек.`,
          });
        }

        try {
          return await marketDataService.getCandles(input.symbol, input.interval, input.limit);
        } catch (error) {
          if (error instanceof MarketDataRequestError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Параметры запроса рыночных данных некорректны." });
          }
          if (error instanceof MarketDataProviderError) {
            if (error.kind === "rate-limit") {
              throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Биржа ограничила частоту запросов. Повторите позже." });
            }
            if (error.kind === "invalid-request" || error.status === 400 || error.status === 404 || error.status === 422) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Биржа не приняла запрошенный торговый символ или интервал." });
            }
            if (error.kind === "timeout" || error.kind === "network" || (error.status !== undefined && error.status >= 500)) {
              console.warn("[Market Data] Provider temporarily unavailable", error.kind, error.status ?? "no-status");
              throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Источник рыночных данных временно недоступен." });
            }
            console.error("[Market Data] Provider response rejected", error.kind, error.status ?? "no-status");
            throw new TRPCError({ code: "BAD_GATEWAY", message: "Источник рыночных данных вернул неподходящий ответ." });
          }
          if (error instanceof MarketDataNormalizationError || error instanceof MarketDataValidationError) {
            console.error("[Market Data] Invalid provider payload", error.name);
            throw new TRPCError({ code: "BAD_GATEWAY", message: "Источник рыночных данных вернул некорректные данные." });
          }
          console.error("[Market Data] Request failed", error instanceof Error ? error.name : "unknown error");
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Не удалось получить рыночные данные." });
        }
      }),
    analysis: protectedProcedure
      .input(marketDataRequestSchema)
      .query(async ({ ctx, input }) => {
        const limit = marketDataRateLimiter.consume(ctx.user.openId);
        if (!limit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Достигнут лимит запросов рыночных данных. Повторите запрос через ${limit.retryAfterSeconds} сек.`,
          });
        }

        try {
          const snapshot = await marketDataService.getCandles(input.symbol, input.interval, input.limit);
          return processMarketData(snapshot);
        } catch (error) {
          if (error instanceof MarketDataProviderError && error.kind === "rate-limit") {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Биржа ограничила частоту запросов. Повторите позже." });
          }
          if (error instanceof MarketDataProviderError && (error.kind === "timeout" || error.kind === "network" || (error.status !== undefined && error.status >= 500))) {
            console.warn("[Market Data] Analysis provider temporarily unavailable", error.kind, error.status ?? "no-status");
            throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Источник рыночных данных временно недоступен." });
          }
          if (
            error instanceof MarketDataRequestError ||
            error instanceof MarketDataProviderError ||
            error instanceof MarketDataNormalizationError ||
            error instanceof MarketDataValidationError ||
            error instanceof MarketDataProcessingError
          ) {
            console.error("[Market Data] Analysis rejected", error.name);
            throw new TRPCError({ code: "BAD_GATEWAY", message: "Данные не прошли проверку для расчёта технических индикаторов." });
          }
          console.error("[Market Data] Analysis failed", error instanceof Error ? error.name : "unknown error");
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Не удалось рассчитать технические индикаторы." });
        }
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
