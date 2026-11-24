import { COOKIE_NAME } from "@shared/const";
import { traderAssistantInputSchema } from "@shared/traderAssistant";
import { marketDataRequestSchema } from "@shared/marketData";
import { marketIntelligenceRequestSchema } from "@shared/marketIntelligence";
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
import { MarketIntelligenceOrchestrator, MarketIntelligenceAgentCallError, MarketIntelligenceAgentOutputError, MarketIntelligenceTrustGateError } from "./market-intelligence/core/MarketIntelligenceOrchestrator";
import { marketIntelligenceRateLimiter } from "./market-intelligence/core/MarketIntelligenceRateLimiter";
import { validateSignalCandidate } from "./signal-validation/core/SignalValidationEngine";
import { historicalDataRangeSchema, historicalDataQuerySchema } from "@shared/historicalData";
import { BinanceSpotHistoricalProvider } from "./historical-data/providers/BinanceSpotHistoricalProvider";
import { DrizzleHistoricalCandleStore } from "./historical-data/core/DrizzleHistoricalCandleStore";
import { HistoricalDataIngestionService, HistoricalDataRequestError } from "./historical-data/core/HistoricalDataIngestionService";
import { backtestRequestSchema } from "@shared/backtest";
import { BacktestInputError, runBacktest } from "./backtesting/core/BacktestEngine";


const marketDataService = new MarketDataService(new BinanceSpotProvider());
const historicalDataService = new HistoricalDataIngestionService(
  new BinanceSpotHistoricalProvider(), new DrizzleHistoricalCandleStore(),
);
const marketIntelligenceOrchestrator = new MarketIntelligenceOrchestrator();

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

  backtesting: router({
    run: protectedProcedure
      .input(backtestRequestSchema)
      .mutation(async ({ ctx, input }) => {
        const rate = marketDataRateLimiter.consume(ctx.user.openId);
        if (!rate.allowed) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Достигнут лимит запросов. Повторите через ${rate.retryAfterSeconds} сек.` });
        }
        try {
          const candles = await historicalDataService.query({
            symbol: input.symbol, interval: input.interval,
            startTime: input.startTime, endTime: input.endTime, limit: 50_001,
          });
          if (candles.length > 50_000) {
            throw new BacktestInputError("Backtest is limited to 50,000 historical candles");
          }
          return runBacktest(candles, input);
        } catch (error) {
          if (error instanceof BacktestInputError || error instanceof HistoricalDataRequestError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          console.error("[Backtesting] Run failed", error instanceof Error ? error.name : "unknown");
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Исторические данные для тестирования временно недоступны." });
        }
      }),
  }),

  historicalData: router({
    ingest: protectedProcedure
      .input(historicalDataRangeSchema)
      .mutation(async ({ ctx, input }) => {
        const limit = marketDataRateLimiter.consume(ctx.user.openId);
        if (!limit.allowed) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Достигнут лимит запросов. Повторите через ${limit.retryAfterSeconds} сек.` });
        }
        try {
          return await historicalDataService.ingest(input);
        } catch (error) {
          if (error instanceof HistoricalDataRequestError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          if (error instanceof MarketDataProviderError) {
            if (error.kind === "rate-limit") throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Binance ограничила частоту запросов." });
            throw new TRPCError({ code: "BAD_GATEWAY", message: "Не удалось получить исторические данные от Binance." });
          }
          console.error("[Historical Data] Ingestion failed", error instanceof Error ? error.name : "unknown");
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Историческое хранилище временно недоступно." });
        }
      }),
    candles: protectedProcedure
      .input(historicalDataQuerySchema)
      .query(async ({ input }) => {
        try {
          return await historicalDataService.query(input);
        } catch (error) {
          if (error instanceof HistoricalDataRequestError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          console.error("[Historical Data] Query failed", error instanceof Error ? error.name : "unknown");
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Историческое хранилище временно недоступно." });
        }
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


  marketIntelligence: router({
    analyze: protectedProcedure
      .input(marketIntelligenceRequestSchema)
      .query(async ({ ctx, input }) => {
        try {
          assertLLMConfigured();
        } catch (error) {
          if (error instanceof LlmConfigurationError) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Служебная конфигурация AI требует проверки владельцем проекта." });
          }
          throw error;
        }

        const limit = marketIntelligenceRateLimiter.consume(ctx.user.openId);
        if (!limit.allowed) {
          const retryMessage = limit.scope === "day"
            ? "Дневной лимит мультиагентного анализа достигнут."
            : limit.scope === "capacity"
              ? "Сервис временно ограничил новые пользовательские сессии."
              : "Слишком много запусков мультиагентного анализа.";
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `${retryMessage} Повторите запрос через ${limit.retryAfterSeconds} сек.`,
          });
        }

        try {
          const snapshot = await marketDataService.getCandles(input.symbol, input.interval, input.limit);
          const processed = processMarketData(snapshot);
          const analysis = await marketIntelligenceOrchestrator.analyze(processed);
          const signalValidation = validateSignalCandidate(analysis);
          return { ...analysis, signalValidation };
        } catch (error) {
          if (error instanceof MarketIntelligenceTrustGateError) {
            console.info("[Market Intelligence] Trust gate blocked the run", error.reason);
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Рыночные данные пока не прошли требования качества или свежести. Анализ не запускался.",
            });
          }
          if (error instanceof MarketIntelligenceAgentOutputError) {
            console.warn("[Market Intelligence] Agent output rejected", error.agent);
            throw new TRPCError({
              code: "BAD_GATEWAY",
              message: "Один из AI-агентов вернул неподходящий структурированный результат. Анализ остановлен.",
            });
          }
          if (error instanceof MarketIntelligenceAgentCallError) {
            if (error.cause instanceof LlmConfigurationError) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Служебная конфигурация AI требует проверки владельцем проекта." });
            }
            if (error.cause instanceof LlmInvocationError) {
              const upstream = error.cause;
              if (upstream.status === 429) {
                throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Поставщик AI ограничил частоту запросов. Повторите позже." });
              }
              console.warn("[Market Intelligence] Agent model call failed", error.agent, upstream.status, upstream.upstreamCode ?? "unknown");
              throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Один из AI-агентов временно недоступен. Частичный анализ не показан." });
            }
            console.warn("[Market Intelligence] Agent execution failed", error.agent);
            throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Не удалось завершить все этапы мультиагентного анализа." });
          }
          if (error instanceof MarketDataRequestError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Параметры запроса рыночных данных некорректны." });
          }
          if (error instanceof MarketDataProviderError) {
            if (error.kind === "rate-limit") {
              throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Биржа ограничила частоту запросов. Повторите позже." });
            }
            if (error.kind === "timeout" || error.kind === "network" || (error.status !== undefined && error.status >= 500)) {
              throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Источник рыночных данных временно недоступен." });
            }
            throw new TRPCError({ code: "BAD_GATEWAY", message: "Источник рыночных данных вернул неподходящий ответ." });
          }
          if (error instanceof MarketDataNormalizationError || error instanceof MarketDataValidationError || error instanceof MarketDataProcessingError) {
            throw new TRPCError({ code: "BAD_GATEWAY", message: "Данные не прошли проверку перед AI-анализом." });
          }
          console.error("[Market Intelligence] Run failed", error instanceof Error ? error.name : "unknown error");
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Не удалось завершить мультиагентный анализ." });
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
