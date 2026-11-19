import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  ClipboardList,
  ChevronDown,
  CircleHelp,
  Clock3,
  Gauge,
  LayoutDashboard,
  Menu,
  Newspaper,
  Play,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Wallet,
  X,
} from "lucide-react";
import PriceChart from "@/components/trader/PriceChart";
import ScenarioChart from "@/components/trader/ScenarioChart";
import OutcomeDistribution from "@/components/trader/OutcomeDistribution";
import DemoJournal from "@/components/trader/DemoJournal";
import RiskPanel from "@/components/trader/RiskPanel";
import CandleTimer from "@/components/trader/CandleTimer";
import AccountSettingsModal from "@/components/trader/AccountSettingsModal";
import type { CandleTimeframe } from "@/lib/candleTimer";
import { readDemoAccountSettings, writeDemoAccountSettings, type DemoAccountSettings } from "@/lib/demoAccountSettings";
import { canAccessDemoJournalStorage, createDemoJournalRecord, MAX_DEMO_JOURNAL_RECORDS, readDemoJournal, writeDemoJournal, type DemoJournalRecord } from "@/lib/demoJournal";
import { buildCandles, simulateScenarios, type Side } from "@/lib/simulation";

type Market = { symbol: string; name: string; price: number; change: number; changePct: number; decimals: number };

const MARKETS: Market[] = [
  { symbol: "XAUUSD", name: "Золото / Доллар США", price: 2354.2, change: 9.84, changePct: 0.42, decimals: 2 },
  { symbol: "EURUSD", name: "Евро / Доллар США", price: 1.0842, change: -0.0014, changePct: -0.13, decimals: 4 },
  { symbol: "BTCUSD", name: "Bitcoin / Доллар США", price: 67420.5, change: 836.2, changePct: 1.26, decimals: 1 },
];

const NAV_ITEMS = [
  { label: "Рабочий стол", icon: LayoutDashboard, anchor: "top" },
  { label: "График цены", icon: BarChart3, anchor: "price-chart" },
  { label: "Машина времени", icon: Sparkles, anchor: "time-machine" },
  { label: "Риск и бюджет", icon: ShieldCheck, anchor: "risk-manager" },
  { label: "Журнал", icon: ClipboardList, anchor: "demo-journal" },
];

const FUTURE_MODULES = [
  { label: "Монитор новостей", icon: Newspaper },
  { label: "Таймер входа", icon: Clock3 },
];

function formatPriceFor(market: Market, value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: market.decimals, maximumFractionDigits: market.decimals });
}

export default function Home() {
  const [market, setMarket] = useState(MARKETS[0]);
  const [timeframe, setTimeframe] = useState<CandleTimeframe>("15м");
  const [accountSettings, setAccountSettings] = useState<DemoAccountSettings>(() => readDemoAccountSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [side, setSide] = useState<Side>("long");
  const [entry, setEntry] = useState(MARKETS[0].price);
  const [stop, setStop] = useState(MARKETS[0].price - 8.2);
  const [target, setTarget] = useState(MARKETS[0].price + 16.3);
  const [size, setSize] = useState(1);
  const [simSeed, setSimSeed] = useState(31);
  const [simulation, setSimulation] = useState(() => simulateScenarios(entry, stop, target, side, 10_000, 31));
  const [isRunning, setIsRunning] = useState(false);
  const [demoTrades, setDemoTrades] = useState<DemoJournalRecord[]>(() => readDemoJournal());
  const [journalStorageAvailable, setJournalStorageAvailable] = useState(() => canAccessDemoJournalStorage());
  const [savedMessage, setSavedMessage] = useState("");
  const [activeNav, setActiveNav] = useState("Рабочий стол");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [marketMenuOpen, setMarketMenuOpen] = useState(false);

  const validLevels = side === "long" ? stop < entry && target > entry : stop > entry && target < entry;
  const priceFormatter = (value: number) => formatPriceFor(market, value);
  const moneyFormatter = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
  const candles = useMemo(() => buildCandles(market.price, 64, MARKETS.indexOf(market) + 17), [market]);
  const quote = market.price;

  useEffect(() => {
    if (!validLevels) return;
    const timer = window.setTimeout(() => {
      setSimulation(simulateScenarios(entry, stop, target, side, 10_000, simSeed));
      setIsRunning(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [entry, stop, target, side, simSeed, validLevels]);

  const setDirection = (nextSide: Side) => {
    setSide(nextSide);
    const unit = Math.max(Math.abs(entry) * 0.0035, market.decimals === 2 ? 1 : 0.001);
    setStop(nextSide === "long" ? entry - unit : entry + unit);
    setTarget(nextSide === "long" ? entry + unit * 2 : entry - unit * 2);
  };

  const selectMarket = (nextMarket: Market) => {
    setMarket(nextMarket);
    setEntry(nextMarket.price);
    const unit = Math.max(Math.abs(nextMarket.price) * 0.0035, nextMarket.decimals === 2 ? 1 : 0.001);
    setStop(side === "long" ? nextMarket.price - unit : nextMarket.price + unit);
    setTarget(side === "long" ? nextMarket.price + unit * 2 : nextMarket.price - unit * 2);
    setMarketMenuOpen(false);
  };

  const runSimulation = () => {
    if (!validLevels) return;
    setIsRunning(true);
    setSimSeed((seed) => seed + 1);
  };

  const saveDemoTrade = () => {
    if (!validLevels) return;
    const record = createDemoJournalRecord({ symbol: market.symbol, side, entry, stop, target, size });
    const nextTrades = [record, ...demoTrades].slice(0, MAX_DEMO_JOURNAL_RECORDS);
    const stored = writeDemoJournal(nextTrades);
    setDemoTrades(nextTrades);
    setJournalStorageAvailable(stored);
    setSavedMessage(stored ? "Демо-сценарий сохранён в этом браузере" : "Хранилище недоступно: запись останется только до закрытия вкладки");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  const deleteDemoTrade = (id: string) => {
    const nextTrades = demoTrades.filter((record) => record.id !== id);
    const stored = writeDemoJournal(nextTrades);
    setDemoTrades(nextTrades);
    setJournalStorageAvailable(stored);
    setSavedMessage(stored ? "Демо-запись удалена" : "Не удалось изменить локальное хранилище");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  const saveAccountSettings = (settings: DemoAccountSettings) => {
    const stored = writeDemoAccountSettings(settings);
    setAccountSettings(settings);
    setSettingsOpen(false);
    setSavedMessage(stored ? "Настройки демо-счёта сохранены в браузере" : "Хранилище недоступно: настройки действуют до закрытия вкладки");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  const goTo = (label: string, anchor: string) => {
    setActiveNav(label);
    setMobileNavOpen(false);
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const formatDirection = side === "long" ? "Покупка" : "Продажа";

  return (
    <div className="app-shell" id="top">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><span>S</span><i /></div>
          <div className="brand-name">SKILL<span>TRADER</span><small>TRADING LAB · v2</small></div>
          <button className="icon-button sidebar-close" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace-card">
          <div className="workspace-icon"><Activity size={16} /></div>
          <div><strong>Trading Lab</strong><span>Локальная симуляция</span></div>
          <ChevronDown size={14} className="workspace-chevron" />
        </div>
        <div className="nav-caption">РАБОЧАЯ ОБЛАСТЬ</div>
        <nav className="side-nav" aria-label="Основная навигация">
          {NAV_ITEMS.map(({ label, icon: Icon, anchor }) => (
            <button key={label} className={`nav-item ${activeNav === label ? "active" : ""}`} onClick={() => goTo(label, anchor)}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{label === "Машина времени" && <span className="nav-tag">AI</span>}
            </button>
          ))}
        </nav>
        <div className="nav-caption modules-caption">ИНСТРУМЕНТЫ</div>
        <div className="side-nav">
          {FUTURE_MODULES.map(({ label, icon: Icon }) => (
            <button key={label} className="nav-item future" title="Демо-макет: источник данных не подключён" onClick={() => setSavedMessage(`${label}: модуль предусмотрен, источник пока не подключён`)}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span><span className="soon-dot" />
            </button>
          ))}
          <button className="nav-item future" title="Брокерское исполнение не подключено"><Wallet size={17} strokeWidth={1.8} /><span>Исполнитель ордеров</span><span className="lock-tag">OFF</span></button>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-help"><CircleHelp size={16} /><span>Справка по симуляции</span><ArrowUpRight size={13} /></div>
          <div className="profile-row"><div className="profile-avatar">ST</div><div><strong>Демо-профиль</strong><small>Локальная сессия</small></div><Settings2 size={17} className="profile-settings" /></div>
        </div>
      </aside>

      {mobileNavOpen && <button className="mobile-backdrop" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Открыть меню" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button>
            <div className="breadcrumb"><span>Trading Lab</span><span className="breadcrumb-sep">/</span><strong>Рабочий стол</strong></div>
          </div>
          <div className="topbar-right">
            <div className="top-live"><span className="live-pulse" />СИМУЛЯЦИЯ АКТИВНА</div>
            <button className="icon-button notification-button" aria-label="Уведомления"><Bell size={17} /><i /></button>
            <div className="top-avatar">M</div>
          </div>
        </header>

        <div className="page-content">
          <div className="demo-banner"><span className="demo-banner-icon"><ShieldCheck size={15} /></span><span><strong>ДЕМО-РЕЖИМ</strong><em>Синтетические данные · брокер не подключён · реальные ордера отключены</em></span><span className="demo-banner-end">ТОЛЬКО ДЛЯ ОБУЧЕНИЯ</span></div>

          <section className="welcome-row">
            <div>
              <div className="eyebrow page-eyebrow">СРЕДА АНАЛИЗА <span className="date-stamp">· СЕССИЯ 01</span></div>
              <h1>Панель <span>трейдера</span></h1>
              <p>Изучайте сценарии и риск сделки на учебных рыночных данных.</p>
            </div>
            <div className="welcome-actions">
              <button className="outline-button" onClick={() => setSavedMessage("Данные примера обновлены локально")}><RefreshCw size={15} /> Обновить пример</button>
              <button className="icon-button help-button" aria-label="Информация"><CircleHelp size={17} /></button>
            </div>
          </section>

          <section className="summary-strip" aria-label="Демо-статистика">
            <div className="summary-card balance-card">
              <div className="summary-icon balance-icon"><Wallet size={17} /></div>
              <div className="summary-copy"><span>Демо-баланс</span><strong>{moneyFormatter(accountSettings.balanceUsd)}</strong><small><span className="summary-positive">ДЕМО</span> · риск до {accountSettings.riskLimitPercent.toFixed(1)}%</small></div>
              <div className="mini-sparkline"><svg viewBox="0 0 100 36" aria-hidden="true"><path d="M2 29 C12 26 14 18 24 21 S38 30 46 18 S59 17 68 22 S81 9 98 7" /></svg></div>
            </div>
            <div className="summary-card"><div className="summary-icon trades-icon"><BarChart3 size={17} /></div><div className="summary-copy"><span>Демо-записи</span><strong>{demoTrades.length.toString().padStart(2, "0")}</strong><small>сохранено локально</small></div></div>
            <div className="summary-card"><div className="summary-icon sim-icon"><Sparkles size={17} /></div><div className="summary-copy"><span>Сценарии</span><strong>{simulation.trials.toLocaleString("ru-RU")}</strong><small>учебных испытаний</small></div></div>
            <div className="summary-card market-summary">
              <div className="summary-icon market-icon"><Activity size={17} /></div><div className="summary-copy"><span>Активный инструмент</span><strong>{market.symbol}</strong><small><span className={market.changePct >= 0 ? "summary-positive" : "summary-negative"}>{market.changePct >= 0 ? "+" : ""}{market.changePct.toFixed(2)}%</span> · условное изменение</small></div>
            </div>
          </section>

          <div className="market-and-form">
            <section className="panel quote-panel">
              <div className="quote-top"><div className="eyebrow">ДЕМО-КОТИРОВКА</div><span className="quote-refresh"><span className="live-pulse" />локально</span></div>
              <div className="quote-main">
                <div className="quote-symbol-wrap"><strong>{market.symbol}</strong><button className="market-select-button" aria-label="Выбрать инструмент" onClick={() => setMarketMenuOpen((open) => !open)}><ChevronDown size={15} /></button>
                  {marketMenuOpen && <div className="market-menu">{MARKETS.map((item) => <button key={item.symbol} onClick={() => selectMarket(item)}><span><strong>{item.symbol}</strong><small>{item.name}</small></span>{item.symbol === market.symbol && <Check size={15} />}</button>)}</div>}
                </div>
                <div className="quote-price">{formatPriceFor(market, quote)}</div>
              </div>
              <div className="quote-bottom"><span className={market.changePct >= 0 ? "quote-change positive" : "quote-change negative"}>{market.changePct >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{market.change >= 0 ? "+" : ""}{formatPriceFor(market, market.change)} ({market.changePct >= 0 ? "+" : ""}{market.changePct.toFixed(2)}%)</span><span className="quote-time">из демонстрационного набора</span></div>
            </section>

            <section className="panel trade-panel" id="trade-form">
              <div className="panel-heading trade-heading"><div><div className="eyebrow">ПАРАМЕТРЫ СДЕЛКИ</div><h2>Сценарий позиции</h2></div><span className="paper-badge"><span /> PAPER</span></div>
              <div className="direction-tabs" role="group" aria-label="Направление сделки">
                <button className={side === "long" ? "direction-tab buy selected" : "direction-tab buy"} onClick={() => setDirection("long")}><ArrowUpRight size={15} /> Покупка</button>
                <button className={side === "short" ? "direction-tab sell selected" : "direction-tab sell"} onClick={() => setDirection("short")}><ArrowDownRight size={15} /> Продажа</button>
              </div>
              <div className="form-grid">
                <label className="field-label">Вход <span>USD</span><input type="number" step={market.decimals === 2 ? "0.01" : "0.0001"} value={entry} onChange={(event) => setEntry(Number(event.target.value))} /></label>
                <label className="field-label">Стоп-лосс <span>USD</span><input className="input-stop" type="number" step={market.decimals === 2 ? "0.01" : "0.0001"} value={stop} onChange={(event) => setStop(Number(event.target.value))} /></label>
                <label className="field-label">Цель <span>USD</span><input className="input-target" type="number" step={market.decimals === 2 ? "0.01" : "0.0001"} value={target} onChange={(event) => setTarget(Number(event.target.value))} /></label>
                <label className="field-label">Размер позиции <span>ед.</span><input type="number" min="0.01" step="0.1" value={size} onChange={(event) => setSize(Math.max(0.01, Number(event.target.value) || 0.01))} /></label>
              </div>
              <div className="trade-panel-footer">
                <div className="trade-rr"><Target size={14} /><span>Прибыль / риск</span><strong>{Math.abs(entry - stop) > 0 ? (Math.abs(target - entry) / Math.abs(entry - stop)).toFixed(2) : "—"}R</strong></div>
                <button className="save-demo-button" onClick={saveDemoTrade} disabled={!validLevels}><Check size={14} /> Сохранить демо-запись</button>
              </div>
              {savedMessage && <div className="toast-message"><Check size={14} />{savedMessage}</div>}
            </section>
          </div>

          <div className="main-grid">
            <div className="chart-column">
              <PriceChart candles={candles} symbol={market.symbol} entry={entry} stop={stop} target={target} side={side} timeframe={timeframe} onTimeframeChange={setTimeframe} formatPrice={priceFormatter} />
              <ScenarioChart result={simulation} entry={entry} stop={stop} target={target} side={side} formatPrice={priceFormatter} />
            </div>
            <aside className="analysis-column">
              <RiskPanel entry={entry} stop={stop} target={target} side={side} size={size} balance={accountSettings.balanceUsd} maxRiskPercent={accountSettings.riskLimitPercent} valid={validLevels} formatMoney={moneyFormatter} />
              <section className="panel probability-panel" id="scenario-outcomes">
                <div className="panel-heading probability-heading"><div><div className="eyebrow">РЕЗУЛЬТАТЫ МОДЕЛИ</div><h2>Вероятности исходов</h2></div><button className={`run-button ${isRunning ? "running" : ""}`} onClick={runSimulation} disabled={!validLevels || isRunning}><Play size={12} fill="currentColor" />{isRunning ? "Считаем" : "Пересчитать"}</button></div>
                <div className="model-status"><span className="model-status-dot" /> {simulation.trials.toLocaleString("ru-RU")} прогонов · параметры текущего сценария</div>
                <OutcomeDistribution result={simulation} side={side} />
                <div className="probability-foot"><span>Результаты зависят от входа, стопа и цели</span><button onClick={runSimulation} aria-label="Перезапустить модель" disabled={!validLevels || isRunning}><RefreshCw size={14} /></button></div>
              </section>
              <section className="panel modules-panel">
                <div className="panel-heading modules-heading"><div><div className="eyebrow">ИНСТРУМЕНТЫ</div><h2>Торговые модули</h2></div><SlidersHorizontal size={16} className="muted-icon" /></div>
                <div className="module-status-row"><span className="module-status-icon lime"><BarChart3 size={15} /></span><span><strong>Сканер графиков</strong><small>Работает на условных данных</small></span><span className="module-chip online">ДЕМО</span></div>
                <div className="module-status-row"><span className="module-status-icon violet"><Sparkles size={15} /></span><span><strong>Машина времени</strong><small>Сценарный симулятор</small></span><span className="module-chip online">ON</span></div>
                <div className="module-status-row"><span className="module-status-icon amber"><Newspaper size={15} /></span><span><strong>Монитор новостей</strong><small>Источник не подключён</small></span><span className="module-chip offline">OFF</span></div>
                <div className="module-status-row"><span className="module-status-icon blue"><Gauge size={15} /></span><span><strong>Таймер входа</strong><small>Учебный режим</small></span><span className="module-chip offline">ДЕМО</span></div>
                <div className="module-status-row"><span className="module-status-icon coral"><Wallet size={15} /></span><span><strong>Исполнитель ордеров</strong><small>Реальные заявки выключены</small></span><span className="module-chip offline">OFF</span></div>
                <div className="modules-footer"><span><span className="tiny-lock" />Без подключённых внешних сервисов</span><button aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}><Settings2 size={13} /> Настройки</button></div>
              </section>
            </aside>
          </div>

          <DemoJournal
            entries={demoTrades}
            storageAvailable={journalStorageAvailable}
            formatPrice={(symbol, value) => formatPriceFor(MARKETS.find((item) => item.symbol === symbol) ?? market, value)}
            formatMoney={moneyFormatter}
            onDelete={deleteDemoTrade}
          />

          <section className="bottom-info-grid">
            <div className="panel news-placeholder"><div className="bottom-info-icon amber"><Newspaper size={16} /></div><div><strong>Монитор новостей</strong><p>Внешняя новостная лента не подключена. Здесь можно подключить выбранный источник событий.</p></div><span className="module-chip offline">НЕТ ИСТОЧНИКА</span></div>
            <CandleTimer timeframe={timeframe} />
          </section>
          <footer className="page-footer"><span><span className="footer-brand">ST</span> Skill Trader · демо-прототип</span><span>Синтетические данные · без торговых рекомендаций</span><span className="footer-version">BUILD 0.1.0</span></footer>
        </div>
      </main>
      {settingsOpen && <AccountSettingsModal settings={accountSettings} onClose={() => setSettingsOpen(false)} onSave={saveAccountSettings} />}
    </div>
  );
}
