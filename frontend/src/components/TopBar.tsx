import { useI18n } from '../lib/i18n';
import type { HealthResponse } from '../types';

interface TopBarProps {
  health: HealthResponse | null;
  onOpenSettings: () => void;
  onOpenModelSelector: () => void;
}

export default function TopBar({ health, onOpenSettings, onOpenModelSelector }: TopBarProps) {
  const { t } = useI18n();

  function modelStatusLabel(h: HealthResponse | null): string {
    if (!h) return t('topbar.connectingBackend');
    if (h.model_status === 'loading') return t('topbar.loadingModel');
    if (h.model_status === 'loaded') return t('topbar.modelLoaded');
    if (h.model_status === 'error') return t('topbar.loadFailed');
    return t('topbar.modelIdle');
  }

  const activeModel = health?.available_models?.find((m) => m.key === health.active_model_key);

  return (
    <div className="topbar">
      <div className="topbar__brand">
        <strong>My AI Playground</strong>
        <span>
          {!health || health.gpu_vendor === 'none'
            ? t('topbar.gpuNotDetected')
            : t('topbar.gpuReady', { name: health.gpu_display_name, backend: health.gpu_backend.toUpperCase() })
          }
        </span>
      </div>

      <div className="topbar__controls">
        <button
          type="button"
          className="model-select-button"
          onClick={onOpenModelSelector}
          disabled={!health || health.model_status === 'loading'}
        >
          <span className="model-select-button__label">{t('topbar.model')}</span>
          <span className="model-select-button__value">
            {activeModel ? `${activeModel.label}: ${activeModel.summary}` : '...'}
          </span>
        </button>

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