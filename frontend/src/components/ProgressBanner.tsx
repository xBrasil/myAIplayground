import { useI18n } from '../lib/i18n';

interface ProgressBannerProps {
  visible: boolean;
  label: string;
}

export default function ProgressBanner({ visible, label }: ProgressBannerProps) {
  const { t } = useI18n();

  if (!visible) {
    return null;
  }

  return (
    <section className="progress-banner" aria-live="polite" aria-busy="true">
      <div className="progress-banner__head">
        <span className="progress-spinner" aria-hidden="true" />
        <strong>{t('progress.processing')}</strong>
        <span>{label}</span>
      </div>
      <div className="progress-track">
        <div className="progress-bar" />
      </div>
    </section>
  );
}