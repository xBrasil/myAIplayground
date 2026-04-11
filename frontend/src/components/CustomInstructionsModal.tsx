import { useI18n } from '../lib/i18n';

interface CustomInstructionsModalProps {
  open: boolean;
  snapshots: { text: string; date: string }[];
  onClose: () => void;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export default function CustomInstructionsModal({
  open,
  snapshots,
  onClose,
}: CustomInstructionsModalProps) {
  const { t } = useI18n();

  if (!open) return null;

  // Deduplicate snapshots by text, keeping the earliest date
  const unique: { text: string; date: string }[] = [];
  const seen = new Set<string>();
  for (const s of snapshots) {
    if (!seen.has(s.text)) {
      seen.add(s.text);
      unique.push(s);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="ci-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>⚠ {t('chat.customInstructionsModalTitle')}</h3>
          <button type="button" onClick={onClose}>✕</button>
        </div>
        <div className="modal-content">
          <p className="ci-modal-disclaimer">
            {t('chat.customInstructionsDisclaimerFull')}
          </p>
          {unique.map((snapshot, idx) => (
            <div key={idx} className="ci-modal-snapshot">
              {unique.length > 1 && (
                <div className="ci-modal-date">
                  {t('chat.customInstructionsFrom')} {formatDate(snapshot.date)}
                </div>
              )}
              <pre className="ci-snapshot-block">{snapshot.text}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
