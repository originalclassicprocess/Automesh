import type { ZxcvbnFactory } from '@zxcvbn-ts/core';
export type PasswordStrength = { score: number; label: string; warning: string; suggestions: string[] };
let factory: Promise<ZxcvbnFactory> | undefined;
let factoryLanguage = 'ru';
async function estimator(language: 'en'|'ru'): Promise<ZxcvbnFactory> {
  // All code/dictionaries are bundled locally and included in the offline shell.
  // No breach API, telemetry or password-derived network request is used.
  if(factoryLanguage!==language){factory=undefined;factoryLanguage=language;}
  factory ??= Promise.all([
    import('@zxcvbn-ts/core'), import('@zxcvbn-ts/language-common'),
    import('@zxcvbn-ts/language-en'), import('@zxcvbn-ts/language-ru'),
  ]).then(([core, common, english, russian]) => new core.ZxcvbnFactory({
    dictionary: { ...common.dictionary, ...english.dictionary, ...russian.dictionary },
    graphs: common.adjacencyGraphs, translations: language==='ru'?russian.translations:english.translations,
  })).catch(error => { factory = undefined; throw error; });
  return factory;
}
export async function passwordStrength(password: string, nickname = '', language:'en'|'ru'='ru'): Promise<PasswordStrength> {
  const checker = await estimator(language);
  // Bounded estimation work; the actual vault password is NEVER truncated.
  const assessed = Array.from(password).slice(0, 100).join('');
  try {
    const result = checker.check(assessed, ['Automesh', 'MeshAutonomy', ...(nickname ? [nickname] : [])]);
    const score = result.score;
    return { score, label: ['Очень слабый', 'Слабый', 'Средний', 'Хороший', 'Сильный'][score],
      warning: result.feedback.warning ?? '', suggestions: result.feedback.suggestions };
  } finally {
    // v4.2.0 retains scoring.password and match tokens in the factory. Replace
    // them with an empty assessment, even on failure; only public dictionaries
    // should survive between calls. This drops references, not guaranteed RAM erasure.
    try { checker.check('', []); } catch { factory = undefined; }
  }
}
