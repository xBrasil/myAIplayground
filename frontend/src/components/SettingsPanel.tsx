import { useEffect, useMemo, useState } from 'react';

import { useI18n, type Locale } from '../lib/i18n';
import VoiceSettings from './VoiceSettings';

interface SettingsPanelProps {
  open: boolean;
  busy: boolean;
  preferredVoice: string;
  enterToSend: boolean;
  onClose: () => void;
  onChangePreferredVoice: (voiceName: string) => void;
  onToggleEnterToSend: (value: boolean) => void;
  onDeleteAll: () => Promise<void>;
}

export default function SettingsPanel({
  open,
  busy,
  preferredVoice,
  enterToSend,
  onClose,
  onChangePreferredVoice,
  onToggleEnterToSend,
  onDeleteAll,
}: SettingsPanelProps) {
  const { t, locale, setLocale } = useI18n();
  const deleteConfirmation = t('settings.deleteAllConfirmation');
  const [confirmationText, setConfirmationText] = useState('');
  const canDeleteAll = useMemo(() => confirmationText === deleteConfirmation && !busy, [confirmationText, busy, deleteConfirmation]);

  useEffect(() => {
    if (!open) {
      setConfirmationText('');
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card settings-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h3>{t('settings.title')}</h3>
          <button type="button" onClick={onClose}>
            {t('close')}
          </button>
        </header>

        <div className="modal-content settings-grid">
          <section className="settings-section">
            <h4>{t('settings.language')}</h4>
            <label className="toggle-row">
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
              >
                <option value="pt-BR">Português (Brasil)</option>
                <option value="en-US">English (US)</option>
                <option value="es-ES">Español</option>
                <option value="fr-FR">Français</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <h4>{t('settings.experience')}</h4>
            <label className="toggle-row">
              <span>{t('settings.enterToSend')}</span>
              <input
                type="checkbox"
                checked={enterToSend}
                onChange={(event) => onToggleEnterToSend(event.target.checked)}
              />
            </label>
            <p className="settings-help">
              {t('settings.enterToSendHelp')}
            </p>
          </section>

          <section className="settings-section">
            <h4>{t('settings.voice')}</h4>
            <VoiceSettings value={preferredVoice} onChange={onChangePreferredVoice} locale={locale} />
          </section>

          <section className="settings-section">
            <h4>{t('settings.localStorage')}</h4>
            <p className="settings-help">{t('settings.storageConversations')}</p>
            <p className="settings-help">{t('settings.storageUploads')}</p>
            <p className="settings-help">
              {t('settings.storagePrivacy')}
            </p>
            <p className="settings-help">
              <strong>{t('settings.voiceWarning').split(':')[0]}:</strong>{t('settings.voiceWarning').slice(t('settings.voiceWarning').indexOf(':') + 1)}
            </p>
          </section>

          <section className="settings-section danger-zone">
            <h4>{t('settings.deleteAll')}</h4>
            <p className="settings-help">
              {t('settings.deleteAllHelp')}
            </p>
            <label className="confirm-label">
              <span>{t('settings.deleteAllConfirmLabel', { confirmation: deleteConfirmation })}</span>
              <input
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                placeholder={deleteConfirmation}
              />
            </label>
            <button type="button" className="danger-button" disabled={!canDeleteAll} onClick={() => void onDeleteAll()}>
              {t('settings.deleteAllButton')}
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}