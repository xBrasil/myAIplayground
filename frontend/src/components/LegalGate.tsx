import { useState } from 'react';

import { useI18n } from '../lib/i18n';

interface LegalGateProps {
  onAccept: () => void;
}

function renderLegalParagraphs(items: string[]) {
  return items.map((text, index) => {
    if (/^\d+\.\s/.test(text)) {
      return <h4 key={index} className="legal-heading">{text}</h4>;
    }
    if (text.startsWith('• ')) {
      return <p key={index} className="legal-bullet">{text}</p>;
    }
    return <p key={index}>{text}</p>;
  });
}

export default function LegalGate({ onAccept }: LegalGateProps) {
  const { t, tList } = useI18n();
  const [checked, setChecked] = useState(false);

  const terms = tList('legal.terms');
  const privacy = tList('legal.privacy');

  return (
    <div className="legal-gate">
      <div className="legal-gate__card">
        <header className="legal-gate__header">
          <h1>{t('appName')}</h1>
          <p>{t('legal.gate.subtitle')}</p>
        </header>
        <div className="legal-gate__content legal-copy">
          <h2>{t('legal.termsTitle')}</h2>
          {renderLegalParagraphs(terms)}
          <hr className="legal-gate__divider" />
          <h2>{t('legal.privacyTitle')}</h2>
          {renderLegalParagraphs(privacy)}
        </div>
        <footer className="legal-gate__footer">
          <label className="legal-gate__checkbox">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>{t('legal.gate.accept')}</span>
          </label>
          <button
            type="button"
            className="legal-gate__button"
            disabled={!checked}
            onClick={onAccept}
          >
            {t('legal.gate.continue')}
          </button>
        </footer>
      </div>
    </div>
  );
}
