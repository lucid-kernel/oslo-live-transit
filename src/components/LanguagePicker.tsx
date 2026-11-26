import { useLanguage } from '../i18n/LanguageProvider.tsx';

export function LanguagePicker() {
  const { language, selectLanguage, m } = useLanguage();
  return (
    <select
      className="language-picker"
      aria-label={m.language}
      value={language}
      onChange={event => selectLanguage(event.target.value === 'nb' ? 'nb' : 'en')}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    >
      <option value="nb" lang="nb">Norsk bokmål</option>
      <option value="en" lang="en">English</option>
    </select>
  );
}
