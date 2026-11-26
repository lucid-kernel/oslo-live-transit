import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { initialLanguage, messages, preferenceKey, type Language } from './language.ts';

const LanguageContext = createContext<{
  language: Language;
  selectLanguage: (language: Language) => void;
} | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(initialLanguage);

  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.title = messages[language].title;
  }, [language]);

  function selectLanguage(next: Language) {
    setLanguage(next);
    try {
      localStorage.setItem(preferenceKey, next);
    } catch { /* Keep the session preference in React state. */ }
  }

  return <LanguageContext.Provider value={{ language, selectLanguage }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('Missing LanguageProvider');
  return { ...context, m: messages[context.language] };
}
