import { useState, type FormEvent } from "react";
import { Activity, CheckCircle2, Lock, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./PaperExecutionPanel.css";

const OFFLINE_MODE = import.meta.env.VITE_APP_MODE === "android-demo";

function money(value: string | null | undefined) {
  if (value == null) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USDT" : "—";
}
function safeError(error: unknown) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED") return "Требуется авторизованная сессия.";
  if (code === "CONFLICT") return "Состояние PAPER-счёта изменилось. Обновите портфель и повторите действие.";
  if (code === "PRECONDITION_FAILED") return "Проверка риска или условия сигнала не пройдены.";
  if (code === "TOO_MANY_REQUESTS") return "Лимит PAPER-операций достигнут.";
  if (code === "SERVICE_UNAVAILABLE") return "Сервис или публичный источник временно недоступен.";
  return "Операция PAPER не завершена.";
}

function AcceptedSignal({
  signal,
  disabled,
  onOpened,
}: {
  signal: { signalId: string; symbol: string; interval: string; direction: "LONG" | "SHORT"; thesisCodes: string[] };
  disabled: boolean;
  onOpened: () => void;
}) {
  const [stopPrice, setStopPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const open = trpc.paper.open.useMutation({
    onSuccess: () => { setStopPrice(""); setTargetPrice(""); onOpened(); },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    open.mutate({ signalId: signal.signalId, stopPrice, targetPrice });
  };
  return (
    <article className="paper-signal-card">
      <div className="paper-signal-meta">
        <strong>{signal.symbol} · {signal.direction}</strong>
        <span>{signal.interval} · подтверждён вручную</span>
      </div>
      <form className="paper-open-form" onSubmit={submit}>
        <label>Stop Price<input value={stopPrice} onChange={event => setStopPrice(event.target.value)} inputMode="decimal" placeholder="Цена стопа" required /></label>
        <label>Take Profit<input value={targetPrice} onChange={event => setTargetPrice(event.target.value)} inputMode="decimal" placeholder="Цена цели" required /></label>
        <button type="submit" disabled={disabled || open.isPending || !stopPrice || !targetPrice}>
          {open.isPending ? "Проверка риска…" : "Открыть PAPER-позицию"}
        </button>
      </form>
      {open.error && <p className="paper-inline-error">{safeError(open.error)}</p>}
    </article>
  );
}

export default function PaperExecutionPanel() {
  const auth = trpc.auth.me.useQuery(undefined, { enabled: !OFFLINE_MODE, retry: false, staleTime: 30_000 });
  const portfolio = trpc.paper.portfolio.useQuery(undefined, {
    enabled: !OFFLINE_MODE && !!auth.data,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const initialize = trpc.paper.initialize.useMutation({ onSuccess: () => void portfolio.refetch() });
  const sync = trpc.paper.sync.useMutation({ onSuccess: () => void portfolio.refetch() });
  const close = trpc.paper.close.useMutation({ onSuccess: () => void portfolio.refetch() });

  const [startingBalance, setStartingBalance] = useState("");
  const [riskPerTradeBps, setRiskPerTradeBps] = useState("50");
  const [maxDailyLossBps, setMaxDailyLossBps] = useState("200");
  const [maxGrossExposureBps, setMaxGrossExposureBps] = useState("10000");
  const [maxOpenPositions, setMaxOpenPositions] = useState("3");
  const [feeBps, setFeeBps] = useState("5");
  const [slippageBps, setSlippageBps] = useState("5");

  const portfolioData = portfolio.data;
  const account = portfolioData?.account;
  const signals = portfolioData?.signals ?? [];
  const positions = portfolioData?.positions ?? [];
  const openPositions = positions.filter(position => position.status === "open");

  const createAccount = (event: FormEvent) => {
    event.preventDefault();
    initialize.mutate({
      startingBalance,
      riskPerTradeBps: Number(riskPerTradeBps),
      maxDailyLossBps: Number(maxDailyLossBps),
      maxGrossExposureBps: Number(maxGrossExposureBps),
      maxOpenPositions: Number(maxOpenPositions),
      feeBps: Number(feeBps),
      slippageBps: Number(slippageBps),
    });
  };

  if (OFFLINE_MODE) {
    return (
      <section className="panel paper-execution-panel" id="paper-execution">
        <div className="paper-panel-heading"><div><div className="eyebrow">PAPER EXECUTION</div><h2>Виртуальный торговый контур</h2></div><span className="paper-mode-tag">OFFLINE</span></div>
        <p className="paper-panel-note">Серверный PAPER-контур недоступен в автономной Android-сборке. Локальные демо-инструменты работают отдельно.</p>
      </section>
    );
  }

  return (
    <section className="panel paper-execution-panel" id="paper-execution" aria-labelledby="paper-execution-title">
      <div className="paper-panel-heading">
        <div><div className="eyebrow">PAPER EXECUTION</div><h2 id="paper-execution-title">Виртуальный торговый контур</h2><p>Сигнал → ручное подтверждение → Risk Engine → виртуальная позиция.</p></div>
        <span className="paper-mode-tag"><ShieldCheck size={13} /> PAPER ONLY</span>
      </div>

      <div className="paper-safety-banner"><Lock size={15} /><span>Только виртуальные операции. Биржевые ордера не отправляются. LIVE-режим отсутствует.</span></div>

      {auth.isLoading && <p className="paper-panel-note">Проверка сессии…</p>}
      {auth.isError && <p className="paper-inline-error">Не удалось проверить авторизацию.</p>}
      {!auth.isLoading && !auth.isError && !auth.data && <p className="paper-panel-note">Для PAPER-счёта войдите в авторизованную сессию.</p>}
      {portfolio.isLoading && <p className="paper-panel-note">Загрузка PAPER-портфеля…</p>}
      {portfolio.error && <p className="paper-inline-error">{safeError(portfolio.error)}</p>}

      {auth.data && portfolioData && !account && (
        <form className="paper-account-form" onSubmit={createAccount}>
          <div className="paper-section-title"><Wallet size={16} /><strong>Создать виртуальный счёт</strong></div>
          <p>Укажите стартовый учебный капитал. Он не связан с балансом Binance или банковским счётом.</p>
          <label>Стартовый капитал, USDT<input type="number" min="1" max="1000000000" step="0.01" value={startingBalance} onChange={event => setStartingBalance(event.target.value)} placeholder="Введите сумму" required /></label>
          <div className="paper-settings-grid">
            <label>Риск на сделку, bps<input type="number" min="1" max="1000" value={riskPerTradeBps} onChange={event => setRiskPerTradeBps(event.target.value)} /></label>
            <label>Дневной лимит потерь, bps<input type="number" min="1" max="5000" value={maxDailyLossBps} onChange={event => setMaxDailyLossBps(event.target.value)} /></label>
            <label>Макс. экспозиция, bps<input type="number" min="100" max="10000" value={maxGrossExposureBps} onChange={event => setMaxGrossExposureBps(event.target.value)} /></label>
            <label>Макс. открытых позиций<input type="number" min="1" max="20" value={maxOpenPositions} onChange={event => setMaxOpenPositions(event.target.value)} /></label>
            <label>Комиссия, bps<input type="number" min="0" max="100" value={feeBps} onChange={event => setFeeBps(event.target.value)} /></label>
            <label>Проскальзывание, bps<input type="number" min="0" max="100" value={slippageBps} onChange={event => setSlippageBps(event.target.value)} /></label>
          </div>
          <button type="submit" disabled={initialize.isPending || !startingBalance}>{initialize.isPending ? "Создание…" : "Создать PAPER-счёт"}</button>
          {initialize.error && <p className="paper-inline-error">{safeError(initialize.error)}</p>}
        </form>
      )}

      {auth.data && portfolioData && account && (
        <>
          <div className="paper-account-summary">
            <div><span>Виртуальная equity</span><strong>{money(portfolioData.equity)}</strong></div>
            <div><span>Свободные средства</span><strong>{money(account.cashBalance)}</strong></div>
            <div><span>Открытая экспозиция</span><strong>{money(portfolioData.currentOpenNotional)}</strong></div>
            <div><span>Открытые позиции</span><strong>{openPositions.length} / {account.maxOpenPositions}</strong></div>
          </div>
          <div className="paper-toolbar">
            <span>Риск на сделку: {account.riskPerTradeBps} bps · дневной лимит: {account.maxDailyLossBps} bps · плечо: OFF</span>
            <button type="button" onClick={() => void portfolio.refetch()} disabled={portfolio.isFetching}><RefreshCw size={13} /> Обновить</button>
            <button type="button" onClick={() => sync.mutate()} disabled={sync.isPending || openPositions.length === 0}>{sync.isPending ? "Проверка…" : "Проверить Stop/Target"}</button>
          </div>
          {sync.error && <p className="paper-inline-error">{safeError(sync.error)}</p>}
          {sync.data && <p className="paper-panel-note">Проверено позиций: {sync.data.checked}. Закрыто по условиям: {sync.data.closed.length}.</p>}
        </>
      )}

      <div className="paper-section">
        <div className="paper-section-title"><CheckCircle2 size={16} /><strong>Сигналы, прошедшие ручное подтверждение</strong></div>
        {signals.filter(signal => signal.status === "accepted").length === 0
          ? <p className="paper-panel-note">Принятых сигналов пока нет. Запустите Market Intelligence и подтвердите кандидата в его панели.</p>
          : signals.filter(signal => signal.status === "accepted").map(signal => (
            <AcceptedSignal key={signal.signalId} signal={signal} disabled={!account} onOpened={() => void portfolio.refetch()} />
          ))}
      </div>

      <div className="paper-section">
        <div className="paper-section-title"><Activity size={16} /><strong>Позиции</strong><span>{positions.length}</span></div>
        {positions.length === 0 && <p className="paper-panel-note">Виртуальных позиций пока нет.</p>}
        {positions.slice().reverse().slice(0, 20).map(position => (
          <article className="paper-position-row" key={position.id ?? position.signalId}>
            <div><strong>{position.symbol} · {position.side}</strong><span>{position.status === "open" ? "Открыта" : "Закрыта"} · qty {position.quantity}</span></div>
            <div><span>Entry {position.entryPrice}</span><strong className={Number(position.netPnl ?? "0") >= 0 ? "paper-pnl-positive" : "paper-pnl-negative"}>{position.netPnl ? money(position.netPnl) : money(position.notional)}</strong></div>
            {position.status === "open" && <button type="button" onClick={() => position.id && close.mutate({ positionId: position.id })} disabled={close.isPending || !position.id}>Закрыть</button>}
          </article>
        ))}
        {close.error && <p className="paper-inline-error">{safeError(close.error)}</p>}
      </div>

    </section>
  );
}
