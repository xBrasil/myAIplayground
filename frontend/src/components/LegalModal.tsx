import { useI18n } from '../lib/i18n';

type LegalDocument = 'terms' | 'privacy';

interface LegalModalProps {
  document: LegalDocument | null;
  onClose: () => void;
}

export default function LegalModal({ document, onClose }: LegalModalProps) {
  const { t, tList } = useI18n();

  if (!document) {
    return null;
  }

  const title = document === 'terms' ? t('legal.termsTitle') : t('legal.privacyTitle');
  const content = document === 'terms' ? tList('legal.terms') : tList('legal.privacy');

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card legal-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h3>{title}</h3>
          <button type="button" onClick={onClose}>
            {t('close')}
          </button>
        </header>
        <div className="modal-content legal-copy">
          {content.map((text, index) => {
            if (/^\d+\.\s/.test(text)) {
              return <h4 key={index} className="legal-heading">{text}</h4>;
            }
            if (text.startsWith('• ')) {
              return <p key={index} className="legal-bullet">{text}</p>;
            }
            return <p key={index}>{text}</p>;
          })}
        </div>
      </section>
    </div>
  );
}