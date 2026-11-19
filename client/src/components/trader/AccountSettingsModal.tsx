import { useEffect, useState, type FormEvent } from "react";
import { Save, ShieldCheck, X } from "lucide-react";
import {
  DEMO_BALANCE_MAX_USD,
  DEMO_BALANCE_MIN_USD,
  DEMO_RISK_MAX_PERCENT,
  DEMO_RISK_MIN_PERCENT,
  type DemoAccountSettings,
} from "@/lib/demoAccountSettings";

type Props = {
  settings: DemoAccountSettings;
  onClose: () => void;
  onSave: (settings: DemoAccountSettings) => void;
};

export default function AccountSettingsModal({ settings, onClose, onSave }: Props) {
  const [balanceInput, setBalanceInput] = useState(settings.balanceUsd.toFixed(2));
  const [riskInput, setRiskInput] = useState(settings.riskLimitPercent.toFixed(1));
  const balanceUsd = Number(balanceInput);
  const riskLimitPercent = Number(riskInput);
  const balanceValid = balanceInput.trim() !== "" && Number.isFinite(balanceUsd) && balanceUsd >= DEMO_BALANCE_MIN_USD && balanceUsd <= DEMO_BALANCE_MAX_USD;
  const riskValid = riskInput.trim() !== "" && Number.isFinite(riskLimitPercent) && riskLimitPercent >= DEMO_RISK_MIN_PERCENT && riskLimitPercent <= DEMO_RISK_MAX_PERCENT;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!balanceValid || !riskValid) return;
    onSave({
      balanceUsd: Math.round(balanceUsd * 100) / 100,
      riskLimitPercent: Math.round(riskLimitPercent * 10) / 10,
    });
  };

  return (
    <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="account-settings-title" aria-describedby="account-settings-description">
        <header className="settings-dialog-header">
          <div className="settings-dialog-icon"><ShieldCheck size={17} /></div>
          <div><div className="eyebrow">ЛОКАЛЬНАЯ СИМУЛЯЦИЯ</div><h2 id="account-settings-title">Демо-счёт</h2></div>
          <button className="icon-button settings-close" type="button" aria-label="Закрыть настройки" onClick={onClose}><X size={17} /></button>
        </header>
        <p className="settings-dialog-description" id="account-settings-description">Настройки меняют только учебные расчёты этой панели и сохраняются в браузере.</p>
        <form className="account-settings-form" onSubmit={handleSubmit} noValidate>
          <label className="settings-field" htmlFor="demo-balance">
            <span>Стартовый баланс <small>USD</small></span>
            <input
              autoFocus
              id="demo-balance"
              type="number"
              inputMode="decimal"
              min={DEMO_BALANCE_MIN_USD}
              max={DEMO_BALANCE_MAX_USD}
              step="0.01"
              value={balanceInput}
              onChange={(event) => setBalanceInput(event.target.value)}
              aria-invalid={!balanceValid}
              aria-describedby={!balanceValid ? "demo-balance-error" : undefined}
            />
            {!balanceValid && <small className="settings-field-error" id="demo-balance-error">Введите сумму от $1 до $1 000 000 000.</small>}
          </label>
          <label className="settings-field" htmlFor="demo-risk-limit">
            <span>Максимальный риск на сценарий <small>% от баланса</small></span>
            <input
              id="demo-risk-limit"
              type="number"
              inputMode="decimal"
              min={DEMO_RISK_MIN_PERCENT}
              max={DEMO_RISK_MAX_PERCENT}
              step="0.1"
              value={riskInput}
              onChange={(event) => setRiskInput(event.target.value)}
              aria-invalid={!riskValid}
              aria-describedby={!riskValid ? "demo-risk-limit-error" : undefined}
            />
            {!riskValid && <small className="settings-field-error" id="demo-risk-limit-error">Допустимо от 0,1% до 10%.</small>}
          </label>
          <div className="settings-local-note"><ShieldCheck size={14} /><span>Не связан с реальными средствами, банком или брокером.</span></div>
          <div className="settings-actions">
            <button className="settings-cancel" type="button" onClick={onClose}>Отмена</button>
            <button className="settings-save" type="submit" disabled={!balanceValid || !riskValid}><Save size={14} /> Сохранить</button>
          </div>
        </form>
      </section>
    </div>
  );
}
