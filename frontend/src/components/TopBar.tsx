import { useI18n } from '../lib/i18n';
import type { HealthResponse, ModelKey } from '../types';

interface TopBarProps {
  health: HealthResponse | null;
  onOpenSettings: () => void;
  onSelectModel: (modelKey: ModelKey) => Promise<void>;
}

export default function TopBar({ health, onOpenSettings, onSelectModel }: TopBarProps) {
  const { t } = useI18n();

  function modelStatusLabel(h: HealthResponse | null): string {
    if (!h) return t('topbar.connectingBackend');
    if (h.model_status === 'loading') return t('topbar.loadingModel');
    if (h.model_status === 'loaded') return t('topbar.modelLoaded');
    if (h.model_status === 'error') return t('topbar.loadFailed');
    return t('topbar.modelIdle');
  }

  return (
    <div className="topbar">
      <div className="topbar__brand">
        <strong>My AI Playground</strong>
        <span>{health?.cuda_available ? t('topbar.cudaReady') : t('topbar.cudaNotDetected')}</span>
      </div>

      <div className="topbar__controls">
        <label className="model-select">
          <span>{t('topbar.model')}</span>
          <select
            value={health?.active_model_key || 'e4b'}
            onChange={(event) => void onSelectModel(event.target.value as ModelKey)}
            disabled={!health || health.model_status === 'loading'}
          >
            {(health?.available_models || []).map((model) => (
              <option key={model.key} value={model.key}>
                {model.label}: {model.summary}{model.cached ? ` · ${t('topbar.cached')}` : ` · ${t('topbar.downloading')}`}
              </option>
            ))}
          </select>
        </label>

        <div className={`topbar__status topbar__status--${health?.model_status || 'idle'}`}>
          <strong>{modelStatusLabel(health)}</strong>
          <span>{health?.model_setup_status || t('topbar.waitingBackend')}</span>
        </div>

        <button type="button" className="topbar__settings" onClick={onOpenSettings}>
          {t('settings')}
        </button>
      </div>
    </div>
  );
}