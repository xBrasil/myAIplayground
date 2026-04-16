import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '../lib/i18n';
import type { HealthResponse, ModelKey } from '../types';

interface ModelSelectorModalProps {
  open: boolean;
  health: HealthResponse | null;
  cudaAvailable: boolean;
  onClose: () => void;
  onSelectModel: (modelKey: ModelKey) => Promise<void>;
  onRefreshHealth: () => Promise<HealthResponse | null>;
}

interface ModelMeta {
  key: ModelKey;
  contextWindow: string;
  vramEstimate: string;
  capabilitiesKey: string;
  limitationsKey: string;
  requiresGpu: boolean;
}

const MODEL_META: ModelMeta[] = [
  {
    key: 'e2b',
    contextWindow: '~128K tokens',
    vramEstimate: '~4 GB',
    capabilitiesKey: 'modelSelector.e2b.capabilities',
    limitationsKey: 'modelSelector.e2b.limitations',
    requiresGpu: false,
  },
  {
    key: 'e4b',
    contextWindow: '~128K tokens',
    vramEstimate: '~6 GB',
    capabilitiesKey: 'modelSelector.e4b.capabilities',
    limitationsKey: 'modelSelector.e4b.limitations',
    requiresGpu: true,
  },
  {
    key: '26b',
    contextWindow: '~256K tokens',
    vramEstimate: '~14 GB',
    capabilitiesKey: 'modelSelector.26b.capabilities',
    limitationsKey: 'modelSelector.26b.limitations',
    requiresGpu: true,
  },
];

type SwitchState = 'idle' | 'switching' | 'success' | 'error';

export default function ModelSelectorModal({
  open,
  health,
  cudaAvailable,
  onClose,
  onSelectModel,
  onRefreshHealth,
}: ModelSelectorModalProps) {
  const { t, tList } = useI18n();

  const [selectedKey, setSelectedKey] = useState<ModelKey | null>(null);
  const [switchState, setSwitchState] = useState<SwitchState>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const previousModelRef = useRef<ModelKey | null>(null);
  const pollRef = useRef<number | null>(null);
  const pollingInFlightRef = useRef(false);
  const prevOpenRef = useRef(false);

  const activeKey = health?.active_model_key || 'e4b';

  // Reset state only when the modal opens (not when activeKey changes during a switch)
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (justOpened) {
      setSelectedKey(activeKey);
      setSwitchState('idle');
      setStatusMessage('');
      setErrorDetail('');
      previousModelRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, activeKey]);

  const models = useMemo(() => {
    const available = health?.available_models || [];
    return MODEL_META.map((meta) => {
      const model = available.find((m) => m.key === meta.key);
      return {
        ...meta,
        label: model?.label || meta.key,
        summary: model?.summary || '',
        cached: model?.cached || false,
        modelId: model?.model_id || '',
        requiresGpu: meta.requiresGpu,
      };
    });
  }, [health]);

  const selectedModel = useMemo(
    () => models.find((m) => m.key === selectedKey) || null,
    [models, selectedKey],
  );

  const canSwitch = switchState === 'idle' && selectedKey !== null && selectedKey !== activeKey;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleSwitch = useCallback(async () => {
    if (!selectedKey || selectedKey === activeKey) return;

    previousModelRef.current = activeKey;
    setSwitchState('switching');
    setStatusMessage(t('modelSelector.switching'));
    setErrorDetail('');

    try {
      await onSelectModel(selectedKey);
    } catch {
      setSwitchState('error');
      setStatusMessage(t('modelSelector.errorTitle'));
      setErrorDetail(t('modelSelector.errorUnexpected'));
      return;
    }

    // Poll health for status updates
    pollRef.current = window.setInterval(async () => {
      if (pollingInFlightRef.current) return;
      pollingInFlightRef.current = true;
      try {
        const h = await onRefreshHealth();
        if (!h) return;

        if (h.model_status === 'loading') {
          setStatusMessage(h.model_setup_status || t('modelSelector.switching'));
          return;
        }

        if (h.model_status === 'loaded') {
          stopPolling();
          setSwitchState('success');
          setStatusMessage(t('modelSelector.success'));
          return;
        }

        if (h.model_status === 'error') {
          stopPolling();
          const detail = h.model_setup_status || t('modelSelector.errorUnexpected');
          setSwitchState('error');
          setStatusMessage(t('modelSelector.errorTitle'));
          setErrorDetail(detail);

          // Automatic fallback to previous model
          const prev = previousModelRef.current;
          if (prev && prev !== h.active_model_key) {
            setErrorDetail((d) => d + '\n' + t('modelSelector.fallback', { model: prev }));
            try {
              await onSelectModel(prev as ModelKey);
            } catch {
              // fallback failed, nothing more to do
            }
          }
          return;
        }
      } catch {
        // network error during polling, keep trying
      } finally {
        pollingInFlightRef.current = false;
      }
    }, 2000);
  }, [selectedKey, activeKey, onSelectModel, onRefreshHealth, stopPolling, t]);

  const handleRetry = useCallback(() => {
    setSwitchState('idle');
    setStatusMessage('');
    setErrorDetail('');
  }, []);

  const handleClose = useCallback(() => {
    stopPolling();
    onClose();
  }, [stopPolling, onClose]);

  // Auto-close on success after a brief delay
  useEffect(() => {
    if (switchState === 'success') {
      const timer = window.setTimeout(() => {
        stopPolling();
        onClose();
      }, 1500);
      return () => window.clearTimeout(timer);
    }
  }, [switchState, stopPolling, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleClose}>
      <section
        className="modal-card model-selector-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>{t('modelSelector.title')}</h3>
          <button type="button" onClick={handleClose} disabled={switchState === 'success'}>
            {t('close')}
          </button>
        </header>

        <div className="modal-content model-selector-content">
          {/* Model list */}
          <div className="model-selector-list">
            {models.map((model) => {
              const isActive = model.key === activeKey;
              const isSelected = model.key === selectedKey;
              const gpuBlocked = model.requiresGpu && !cudaAvailable;
              const capabilities = tList(model.capabilitiesKey);
              const limitations = tList(model.limitationsKey);

              return (
                <button
                  key={model.key}
                  type="button"
                  className={`model-card ${isSelected ? 'model-card--selected' : ''} ${isActive ? 'model-card--active' : ''} ${gpuBlocked ? 'model-card--disabled' : ''}`}
                  onClick={() => switchState === 'idle' && !gpuBlocked && setSelectedKey(model.key)}
                  disabled={switchState !== 'idle' || gpuBlocked}
                >
                  <div className="model-card__header">
                    <strong className="model-card__name">{model.label}</strong>
                    <span className="model-card__summary">{model.summary}</span>
                    <div className="model-card__badges">
                      {isActive && <span className="badge badge--current">{t('modelSelector.current')}</span>}
                      {gpuBlocked
                        ? <span className="badge badge--gpu-required">{t('modelSelector.gpuRequired')}</span>
                        : model.cached
                          ? <span className="badge badge--cached">{t('modelSelector.cached')}</span>
                          : <span className="badge badge--download">{t('modelSelector.notCached')}</span>}
                    </div>
                  </div>

                  {isSelected && !gpuBlocked && (
                    <div className="model-card__details">
                      <div className="model-card__specs">
                        <span>{t('modelSelector.contextWindow')}: <strong>{model.contextWindow}</strong></span>
                        <span>VRAM: <strong>{model.vramEstimate}</strong></span>
                      </div>

                      {capabilities.length > 0 && (
                        <div className="model-card__section">
                          <h5>{t('modelSelector.capabilities')}</h5>
                          <ul>
                            {capabilities.map((cap, i) => <li key={i}>{cap}</li>)}
                          </ul>
                        </div>
                      )}

                      {limitations.length > 0 && (
                        <div className="model-card__section">
                          <h5>{t('modelSelector.limitations')}</h5>
                          <ul>
                            {limitations.map((lim, i) => <li key={i}>{lim}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {gpuBlocked && (
                    <p className="model-card__gpu-warning">{t('modelSelector.gpuWarning')}</p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Status / Progress area */}
          {switchState !== 'idle' && (
            <div className={`model-selector-status model-selector-status--${switchState}`}>
              {(switchState === 'switching' || switchState === 'success') && (
                <div className="model-selector-progress">
                  <div className="progress-bar">
                    <div className={`progress-bar__fill ${switchState === 'success' ? 'progress-bar__fill--complete' : 'progress-bar__fill--indeterminate'}`} />
                  </div>
                </div>
              )}
              <p className="model-selector-status__message">{statusMessage}</p>
              {errorDetail && (
                <pre className="model-selector-status__detail">{errorDetail}</pre>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <footer className="model-selector-actions">
          {switchState === 'idle' && (
            <>
              <button type="button" onClick={handleClose}>
                {t('modelSelector.cancel')}
              </button>
              <button type="button" className="primary-button" disabled={!canSwitch} onClick={handleSwitch}>
                {t('modelSelector.save')}
              </button>
            </>
          )}
          {switchState === 'switching' && (
            <button type="button" onClick={handleClose}>
              {t('modelSelector.cancel')}
            </button>
          )}
          {switchState === 'success' && (
            <button type="button" className="primary-button" onClick={handleClose}>
              {t('modelSelector.successClose')}
            </button>
          )}
          {switchState === 'error' && (
            <>
              <button type="button" onClick={handleClose}>
                {t('modelSelector.cancel')}
              </button>
              <button type="button" className="primary-button" onClick={handleRetry}>
                {t('modelSelector.retry')}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
