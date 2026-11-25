import { useEffect, useState } from "react";
import { AlertTriangle, Play, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MARKET_DATA_INTERVALS } from "@shared/marketData";

const OFFLINE_MODE = import.meta.env.VITE_APP_MODE === "android-demo";
const INTERVALS = ["5m","15m","1h","4h","1d"] as const;
const LABELS: Record<string,string> = {
  uptrend:"Восходящий тренд",downtrend:"Нисходящий тренд",ranging:"Боковое движение",
  high_volatility:"Высокая волатильность",transition:"Переходный режим",
};
function day(days:number){return new Date(Date.now()-days*86_400_000).toISOString().slice(0,10);}
function safeError(error:unknown){
  const code=(error as {data?:{code?:string}}|null)?.data?.code;
  if(code==="BAD_REQUEST")return "Недостаточно сохранённых свечей или история содержит разрывы. Сначала проверьте и загрузите историю.";
  if(code==="TOO_MANY_REQUESTS")return "Достигнут лимит запросов. Повторите позже.";
  if(code==="UNAUTHORIZED")return "Требуется авторизованная сессия.";
  return "Анализ режима рынка временно недоступен.";
}
export default function MarketRegimePanel(){
  const [symbol,setSymbol]=useState("BTCUSDT");
  const [interval,setInterval]=useState<(typeof MARKET_DATA_INTERVALS)[number]>("1h");
  const [startDate,setStartDate]=useState(()=>day(90));
  const [endDate,setEndDate]=useState(()=>day(0));
  const [lookback,setLookback]=useState("30");
  const auth=trpc.auth.me.useQuery(undefined,{enabled:!OFFLINE_MODE,retry:false,staleTime:30_000,refetchOnWindowFocus:false});
  const analysis=trpc.backtesting.marketRegime.useMutation();
  const startTime=Date.parse(startDate+"T00:00:00.000Z");
  const endTime=Date.parse(endDate+"T23:59:59.999Z");
  const valid= /^[A-Z0-9]{2,20}$/.test(symbol.trim().toUpperCase()) && Number.isFinite(startTime) && Number.isFinite(endTime) && endTime>startTime && endTime-startTime<=366*86_400_000 && Number.isInteger(Number(lookback)) && Number(lookback)>=10 && Number(lookback)<=200;
  useEffect(()=>{analysis.reset();},[symbol,interval,startDate,endDate,lookback]);
  const run=()=>{if(valid&&auth.data)analysis.mutate({symbol:symbol.trim().toUpperCase(),interval,startTime,endTime,lookback:Number(lookback)});};
  if(OFFLINE_MODE)return <section className="panel portfolio-panel" id="market-regime"><h2>Market Regime Intelligence</h2><p>Автономная Android-сборка не подключается к серверной истории. Анализ доступен в серверной версии.</p><span className="portfolio-tag">OFFLINE APK</span></section>;
  return <section className="panel portfolio-panel" id="market-regime" aria-labelledby="market-regime-title">
    <div className="portfolio-heading"><div><div className="eyebrow">MARKET REGIME INTELLIGENCE</div><h2 id="market-regime-title">Режим рынка</h2><p>Детерминированная классификация сохранённых закрытых свечей.</p></div><span className="portfolio-tag"><ShieldCheck size={13}/> RESEARCH ONLY</span></div>
    <div className="portfolio-safety"><ShieldCheck size={14}/> Аналитика не прогнозирует цену, не создаёт сигналы и не меняет торговые параметры.</div>
    {auth.isLoading&&<p className="portfolio-note">Проверка авторизации…</p>}
    {auth.isError&&<p className="portfolio-warning">Не удалось проверить авторизацию. Запрос не запускался.</p>}
    {auth.data&&<>
      <div className="portfolio-controls">
        <label>Символ<input value={symbol} maxLength={20} onChange={e=>setSymbol(e.target.value.toUpperCase())}/></label>
        <label>Интервал<select value={interval} onChange={e=>setInterval(e.target.value as (typeof MARKET_DATA_INTERVALS)[number])}>{INTERVALS.map(v=><option key={v}>{v}</option>)}</select></label>
        <label>Начало UTC<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
        <label>Конец UTC<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
        <label>Окно, свечей<input type="number" min="10" max="200" value={lookback} onChange={e=>setLookback(e.target.value)}/></label>
      </div>
      <button className="portfolio-run" type="button" disabled={!valid||analysis.isPending} onClick={run}><Play size={14}/>{analysis.isPending?"Анализ выполняется…":"Определить режим рынка"}</button>
      <p className="portfolio-note">Перед запуском загрузите выбранный период на панели «История и Backtest». Данные читаются из хранилища; повторной загрузки с биржи нет.</p>
      {!valid&&<p className="portfolio-warning"><AlertTriangle size={13}/>Проверьте символ, даты и окно от 10 до 200 свечей.</p>}
      {analysis.error&&<p className="portfolio-warning">{safeError(analysis.error)}</p>}
      {analysis.data&&<div className="portfolio-results">
        <div className="portfolio-subtitle">Текущий режим</div>
        <div className="portfolio-metrics">
          <div><span>Классификация</span><strong>{LABELS[analysis.data.current?.regime??""]??"Недоступно"}</strong></div>
          <div><span>Rule-strength score</span><strong>{analysis.data.current?analysis.data.current.confidence.toFixed(1)+"%":"—"}</strong></div>
          <div><span>Изменение окна</span><strong>{analysis.data.current?(analysis.data.current.netChangeBps/100).toFixed(2)+"%":"—"}</strong></div>
          <div><span>Средний true range</span><strong>{analysis.data.current?(analysis.data.current.averageTrueRangeBps/100).toFixed(2)+"%":"—"}</strong></div>
          <div><span>Efficiency ratio</span><strong>{analysis.data.current?.efficiencyRatio.toFixed(3)??"—"}</strong></div>
          <div><span>Обработано свечей</span><strong>{analysis.data.candlesProcessed.toLocaleString("ru-RU")}</strong></div>
        </div>
        <div className="portfolio-subtitle">Распределение режимов</div>
        <div className="portfolio-table-wrap"><table><thead><tr><th>Режим</th><th>Наблюдений</th><th>Доля</th></tr></thead><tbody>{analysis.data.distribution.map(item=><tr key={item.regime}><td>{LABELS[item.regime]}</td><td>{item.observations}</td><td>{item.sharePct.toFixed(1)}%</td></tr>)}</tbody></table></div>
        <div className="portfolio-subtitle">Последние переходы</div>
        {analysis.data.transitions.length===0?<p className="portfolio-note">В выбранном периоде переходы не обнаружены.</p>:<div className="portfolio-table-wrap"><table><thead><tr><th>Из</th><th>В</th><th>Время UTC</th></tr></thead><tbody>{analysis.data.transitions.slice(-10).reverse().map((t,i)=><tr key={t.time+"-"+i}><td>{LABELS[t.from]}</td><td>{LABELS[t.to]}</td><td>{new Date(t.time).toISOString().replace("T"," ").slice(0,16)}</td></tr>)}</tbody></table></div>}
        {analysis.data.warnings.map(w=><p className="portfolio-warning" key={w}>{w}</p>)}
        <details className="portfolio-assumptions"><summary>Методика и ограничения</summary><ul>{analysis.data.methodology.map(x=><li key={x}>{x}</li>)}</ul></details>
        <div className="portfolio-result-foot">Run ID: {analysis.data.runId} · SHA-256: {analysis.data.dataDigest.slice(0,16)}… · executionEligible=false · exchangeOrderSent=false</div>
      </div>}
    </>}
  </section>;
}
