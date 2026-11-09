import { beforeEach } from 'vitest';
import { localTranslations, setLanguage } from './language';

// Existing UI fixtures specify the Russian baseline. Localization tests choose
// their own language explicitly; this does not change the production default.
beforeEach(() => { localTranslations.set([]); setLanguage('ru'); });
