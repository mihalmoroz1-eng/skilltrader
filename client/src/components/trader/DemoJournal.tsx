import { useMemo, useState } from "react";
import { ClipboardList, Download, HardDrive, Search, Trash2 } from "lucide-react";
import type { DemoJournalRecord, DemoJournalSideFilter } from "@/lib/demoJournal";
import { downloadDemoJournalCsv, filterDemoJournal } from "@/lib/demoJournal";

type Props = {
  entries: DemoJournalRecord[];
  storageAvailable: boolean;
  formatPrice: (symbol: string, value: number) => string;
  formatSize: (symbol: string, value: number) => string;
  formatMoney: (value: number) => string;
  onDelete: (id: string) => void;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function DirectionBadge({ side }: { side: DemoJournalRecord["side"] }) {
  return <span className={`journal-direction ${side === "long" ? "long" : "short"}`}>{side === "long" ? "Покупка" : "Продажа"}</span>;
}

function EntryLevels({ entry, stop, target, symbol, formatPrice }: Pick<DemoJournalRecord, "entry" | "stop" | "target" | "symbol"> & { formatPrice: Props["formatPrice"] }) {
  return (
    <span className="journal-levels">
      <span>Вход {formatPrice(symbol, entry)}</span>
      <span>Стоп {formatPrice(symbol, stop)}</span>
      <span>Цель {formatPrice(symbol, target)}</span>
    </span>
  );
}

export default function DemoJournal({ entries, storageAvailable, formatPrice, formatSize, formatMoney, onDelete }: Props) {
  const [search, setSearch] = useState("");
  const [sideFilter, setSideFilter] = useState<DemoJournalSideFilter>("all");
  const [exportMessage, setExportMessage] = useState("");
  const visibleEntries = useMemo(() => filterDemoJournal(entries, search, sideFilter), [entries, search, sideFilter]);

  const exportCsv = () => {
    const succeeded = downloadDemoJournalCsv(visibleEntries);
    setExportMessage(succeeded ? `CSV выгружен: ${visibleEntries.length}` : "Скачивание CSV недоступно в этом браузере");
    window.setTimeout(() => setExportMessage(""), 2500);
  };

  return (
    <section className="panel journal-panel" id="demo-journal">
      <div className="panel-heading journal-heading">
        <div>
          <div className="eyebrow">ЛОКАЛЬНАЯ ИСТОРИЯ</div>
          <h2><ClipboardList size={16} /> Журнал демо-сценариев</h2>
        </div>
        <div className="journal-heading-meta">
          <span className="journal-count">{entries.length} / 50</span>
          <span className={`journal-storage ${storageAvailable ? "available" : "unavailable"}`}>
            <HardDrive size={12} />{storageAvailable ? "Только этот браузер" : "Хранилище недоступно"}
          </span>
        </div>
      </div>
      <p className="journal-description">Сценарии не исполняются и не отправляются на сервер. Поиск и экспорт работают локально.</p>

      <div className="journal-controls">
        <label className="journal-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Поиск по тикеру" aria-label="Поиск по тикеру" />
        </label>
        <select className="journal-side-filter" value={sideFilter} onChange={(event) => setSideFilter(event.currentTarget.value as DemoJournalSideFilter)} aria-label="Фильтр по направлению">
          <option value="all">Все направления</option>
          <option value="long">Покупка</option>
          <option value="short">Продажа</option>
        </select>
        <button className="journal-export-button" onClick={exportCsv} disabled={!visibleEntries.length} title="Скачать CSV текущей выборки">
          <Download size={14} /> Экспорт CSV
        </button>
      </div>
      <div className="journal-results-row">
        <span className="journal-results-count">Показано {visibleEntries.length} из {entries.length}</span>
        {exportMessage && <span className="journal-export-message" role="status">{exportMessage}</span>}
      </div>

      {!entries.length ? (
        <div className="journal-empty">
          <span className="journal-empty-icon"><ClipboardList size={20} /></span>
          <strong>Записей пока нет</strong>
          <span>Настройте сценарий выше и нажмите «Сохранить демо-запись».</span>
        </div>
      ) : !visibleEntries.length ? (
        <div className="journal-empty journal-no-results">
          <strong>По фильтру ничего не найдено</strong>
          <span>Измените запрос или сбросьте параметры отбора.</span>
          <button className="journal-reset-button" onClick={() => { setSearch(""); setSideFilter("all"); }}>Сбросить фильтры</button>
        </div>
      ) : (
        <>
          <div className="journal-table-wrap">
            <table className="journal-table">
              <thead><tr><th>Дата</th><th>Инструмент</th><th>Сторона</th><th>Уровни</th><th>Размер</th><th>Риск / потенциал</th><th><span className="sr-only">Действия</span></th></tr></thead>
              <tbody>
                {visibleEntries.map((record) => (
                  <tr key={record.id}>
                    <td><time dateTime={record.createdAt}>{formatDate(record.createdAt)}</time></td>
                    <td><strong className="journal-symbol">{record.symbol}</strong><small>Демо-сценарий</small></td>
                    <td><DirectionBadge side={record.side} /></td>
                    <td><EntryLevels {...record} formatPrice={formatPrice} /></td>
                    <td>{formatSize(record.symbol, record.size)}</td>
                    <td><span className="journal-metric-risk">−{formatMoney(record.riskUsd)}</span><small className="journal-metric-reward">+{formatMoney(record.potentialUsd)} · {record.riskReward.toFixed(2)}R</small></td>
                    <td><button className="journal-delete" aria-label={`Удалить запись ${record.symbol} от ${formatDate(record.createdAt)}`} title="Удалить запись" onClick={() => onDelete(record.id)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="journal-card-list">
            {visibleEntries.map((record) => (
              <article className="journal-entry-card" key={record.id}>
                <div className="journal-entry-card-head">
                  <div><strong className="journal-symbol">{record.symbol}</strong><time dateTime={record.createdAt}>{formatDate(record.createdAt)}</time></div>
                  <div className="journal-entry-actions"><DirectionBadge side={record.side} /><button className="journal-delete" aria-label={`Удалить запись ${record.symbol} от ${formatDate(record.createdAt)}`} title="Удалить запись" onClick={() => onDelete(record.id)}><Trash2 size={14} /></button></div>
                </div>
                <EntryLevels {...record} formatPrice={formatPrice} />
                <div className="journal-entry-card-foot"><span>{formatSize(record.symbol, record.size)}</span><span className="journal-metric-risk">Риск −{formatMoney(record.riskUsd)}</span><span className="journal-metric-reward">Цель +{formatMoney(record.potentialUsd)} · {record.riskReward.toFixed(2)}R</span></div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
