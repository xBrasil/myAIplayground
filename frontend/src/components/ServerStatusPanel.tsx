import { useI18n } from '../lib/i18n';
import { shutdownServer } from '../lib/api';
import type { HealthResponse } from '../types';

interface ServerStatusPanelProps {
  open: boolean;
  health: HealthResponse | null;
  onClose: () => void;
}

export default function ServerStatusPanel({ open, health, onClose }: ServerStatusPanelProps) {
  const { t } = useI18n();

  if (!open) return null;

  const disconnected = health === null;
  const activeModel = health?.available_models?.find((m) => m.key === health.active_model_key);

  function handleStop() {
    if (!window.confirm(t('serverPanel.confirmStop'))) return;
    void shutdownServer().catch(() => {});
    onClose();
  }

  function statusLabel(): string {
    if (!health) return t('status.disconnected');
    if (health.model_status === 'loading') return t('status.loading');
    if (health.model_status === 'loaded') return t('status.ready');
    if (health.model_status === 'error') return t('status.error');
    return t('status.idle');
  }

  return (
    <div className="server-panel-overlay" onClick={onClose}>
      <div className="server-panel" onClick={(e) => e.stopPropagation()}>
        <header className="server-panel__header">
          <h3>{t('serverPanel.title')}</h3>
          <button type="button" className="server-panel__close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </header>
        {disconnected ? (
          <div className="server-panel__body">
            <p className="server-panel__disconnected">{t('serverPanel.disconnectedMessage')}</p>
          </div>
        ) : (
          <div className="server-panel__body">
            <dl className="server-panel__info">
              <dt>{t('serverPanel.model')}</dt>
              <dd>{activeModel ? `${activeModel.label} — ${activeModel.summary}` : '—'}</dd>
              <dt>{t('serverPanel.status')}</dt>
              <dd>
                <span className={`status-badge status-badge--${health.model_status}`}>
                  <span className="status-badge__dot" />
                  {statusLabel()}
                </span>
              </dd>
              <dt>{t('serverPanel.gpu')}</dt>
              <dd>
                {health.gpu_vendor !== 'none'
                  ? `${health.gpu_display_name} (${health.gpu_backend.toUpperCase()})`
                  : t('serverPanel.gpuNo')
                }
              </dd>
              {health.context_size > 0 && (
                <>
                  <dt>{t('serverPanel.contextSize')}</dt>
                  <dd>{t('serverPanel.tokens', { count: String(health.context_size) })}</dd>
                </>
              )}
              {health.model_setup_status && (
                <>
                  <dt>{t('serverPanel.setupStatus')}</dt>
                  <dd>{health.model_setup_status}</dd>
                </>
              )}
            </dl>
            <button type="button" className="server-panel__stop" onClick={handleStop}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              {t('serverPanel.stopServer')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
