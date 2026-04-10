import { useEffect, useState } from 'react';

import { fetchServerConfig } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { ServerConfig } from '../types';

interface ApiAccessPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function ApiAccessPanel({ open, onClose }: ApiAccessPanelProps) {
  const { t } = useI18n();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      void fetchServerConfig().then(setConfig).catch(() => null);
    }
  }, [open]);

  if (!open) return null;

  const endpoint = config ? `${config.llama_server_url}/v1/chat/completions` : '';
  const modelId = config?.model_id || '';
  const isReady = config?.model_loaded ?? false;

  const curlSnippet = `curl ${endpoint} \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelId}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;

  const pythonSnippet = `from openai import OpenAI

client = OpenAI(
    base_url="${config?.llama_server_url || 'http://127.0.0.1:8081'}/v1",
    api_key="not-needed",
)

response = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`;

  async function handleCopy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-card api-access-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>{t('api.title')}</h3>
          <button type="button" onClick={onClose}>
            {t('close')}
          </button>
        </header>

        <div className="modal-content">
          <p className="settings-help">{t('api.description')}</p>

          <div className="api-info-grid">
            <div className="api-info-row">
              <strong>{t('api.endpointLabel')}</strong>
              <code>{endpoint || '—'}</code>
            </div>
            <div className="api-info-row">
              <strong>{t('api.modelLabel')}</strong>
              <code>{modelId || '—'}</code>
            </div>
            <div className="api-info-row">
              <strong>{t('api.statusLabel')}</strong>
              <span className={`status-badge status-badge--${isReady ? 'loaded' : 'idle'}`}>
                <span className="status-badge__dot" />
                {isReady ? t('api.statusReady') : t('api.statusNotReady')}
              </span>
            </div>
          </div>

          <h4>{t('api.curlExample')}</h4>
          <div className="api-code-block">
            <pre><code>{curlSnippet}</code></pre>
            <button
              type="button"
              className="api-copy-btn"
              onClick={() => void handleCopy(curlSnippet, 'curl')}
            >
              {copied === 'curl' ? t('api.copied') : t('api.copy')}
            </button>
          </div>

          <h4>{t('api.pythonExample')}</h4>
          <div className="api-code-block">
            <pre><code>{pythonSnippet}</code></pre>
            <button
              type="button"
              className="api-copy-btn"
              onClick={() => void handleCopy(pythonSnippet, 'python')}
            >
              {copied === 'python' ? t('api.copied') : t('api.copy')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
