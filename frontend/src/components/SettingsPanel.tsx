import { useEffect, useMemo, useState } from 'react';

import { useI18n, type Locale } from '../lib/i18n';
import VoiceSettings from './VoiceSettings';

interface SettingsPanelProps {
  open: boolean;
  busy: boolean;
  preferredVoice: string;
  enterToSend: boolean;
  customInstructions: string;
  webAccess: boolean;
  localFiles: boolean;
  allowedFolders: string[];
  onClose: () => void;
  onChangePreferredVoice: (voiceName: string) => void;
  onToggleEnterToSend: (value: boolean) => void;
  onChangeCustomInstructions: (value: string) => void;
  onChangeWebAccess: (value: boolean) => void;
  onChangeLocalFiles: (value: boolean) => void;
  onChangeAllowedFolders: (folders: string[]) => void;
  onDeleteAll: () => Promise<void>;
}

export default function SettingsPanel({
  open,
  busy,
  preferredVoice,
  enterToSend,
  customInstructions,
  webAccess,
  localFiles,
  allowedFolders,
  onClose,
  onChangePreferredVoice,
  onToggleEnterToSend,
  onChangeCustomInstructions,
  onChangeWebAccess,
  onChangeLocalFiles,
  onChangeAllowedFolders,
  onDeleteAll,
}: SettingsPanelProps) {
  const { t, locale, setLocale } = useI18n();
  const deleteConfirmation = t('settings.deleteAllConfirmation');
  const [confirmationText, setConfirmationText] = useState('');
  const [newFolderPath, setNewFolderPath] = useState('');
  const canDeleteAll = useMemo(() => confirmationText === deleteConfirmation && !busy, [confirmationText, busy, deleteConfirmation]);

  useEffect(() => {
    if (!open) {
      setConfirmationText('');
      setNewFolderPath('');
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
            <h4>{t('settings.voice')}</h4>
            <VoiceSettings value={preferredVoice} onChange={onChangePreferredVoice} locale={locale} />
          </section>

          <section className="settings-section">
            <h4>{t('settings.customInstructions')}</h4>
            <p className="settings-help">
              {t('settings.customInstructionsHelp')}
            </p>
            <textarea
              className="custom-instructions-textarea"
              value={customInstructions}
              onChange={(e) => onChangeCustomInstructions(e.target.value)}
              placeholder={t('settings.customInstructionsPlaceholder')}
              rows={4}
            />
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
            <h4>{t('settings.webAccess')}</h4>
            <p className="settings-help">
              {t('settings.webAccessHelp')}
            </p>
            <label className="toggle-row">
              <span>{t('settings.webAccessToggle')}</span>
              <input
                type="checkbox"
                checked={webAccess}
                onChange={(event) => {
                  if (event.target.checked && !webAccess) {
                    const confirmed = window.confirm(t('settings.webAccessWarning'));
                    if (!confirmed) return;
                  }
                  onChangeWebAccess(event.target.checked);
                }}
              />
            </label>
            {webAccess && (
              <p className="settings-help settings-help--warning">
                ⚠ {t('settings.webAccessActive')}
              </p>
            )}
          </section>

          <section className="settings-section">
            <h4>{t('settings.localFiles')}</h4>
            <p className="settings-help">
              {t('settings.localFilesHelp')}
            </p>
            <label className="toggle-row">
              <span>{t('settings.localFilesToggle')}</span>
              <input
                type="checkbox"
                checked={localFiles}
                onChange={(event) => {
                  if (event.target.checked && !localFiles) {
                    const confirmed = window.confirm(t('settings.localFilesWarning'));
                    if (!confirmed) return;
                  }
                  onChangeLocalFiles(event.target.checked);
                }}
              />
            </label>
            {localFiles && (
              <>
                <p className="settings-help settings-help--warning">
                  ⚠ {t('settings.localFilesActive')}
                </p>
                <div className="settings-subsection">
                  <h5>{t('settings.localFilesFolders')}</h5>
                  {allowedFolders.length === 0 && (
                    <p className="settings-help">{t('settings.localFilesNoFolders')}</p>
                  )}
                  {allowedFolders.map((folder, index) => (
                    <div key={index} className="folder-entry">
                      <code className="folder-path">{folder}</code>
                      <button
                        type="button"
                        className="folder-remove-button"
                        onClick={() => {
                          const updated = allowedFolders.filter((_, i) => i !== index);
                          onChangeAllowedFolders(updated);
                        }}
                        title={t('settings.localFilesRemoveFolder')}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <div className="folder-add-row">
                    <input
                      type="text"
                      className="folder-input"
                      value={newFolderPath}
                      onChange={(e) => setNewFolderPath(e.target.value)}
                      placeholder={t('settings.localFilesFolderPlaceholder')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const trimmed = newFolderPath.trim();
                          if (trimmed && !allowedFolders.includes(trimmed)) {
                            onChangeAllowedFolders([...allowedFolders, trimmed]);
                            setNewFolderPath('');
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="folder-add-button"
                      disabled={!newFolderPath.trim() || allowedFolders.includes(newFolderPath.trim())}
                      onClick={() => {
                        const trimmed = newFolderPath.trim();
                        if (trimmed && !allowedFolders.includes(trimmed)) {
                          onChangeAllowedFolders([...allowedFolders, trimmed]);
                          setNewFolderPath('');
                        }
                      }}
                    >
                      {t('settings.localFilesAddFolder')}
                    </button>
                  </div>
                </div>
              </>
            )}
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