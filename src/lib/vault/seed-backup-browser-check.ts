import { mount, tick, unmount } from 'svelte';
import SeedBackup from './SeedBackup.svelte';
import SeedEntry from './SeedEntry.svelte';
import BackupReader from './BackupReader.svelte';
import EncryptedBackup from './EncryptedBackup.svelte';
import { mnemonicToSeed } from '@scure/bip39';
import { deriveIdentitySeed } from '$lib/identity/namespace';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { getAccountId } from '$lib/addressing/address';
import { bytesToHex } from '$lib/message/encoding';
import { createEncryptedBackup } from './encrypted-backup';

// Public disposable fixture. This check never reads a user vault or writes storage.
const fixture = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

async function fixtureAccountId(): Promise<string> {
  const master = await mnemonicToSeed(fixture);
  const derived = await deriveIdentitySeed(master);
  try {
    const identity = new WebCryptoIdentity();
    return await getAccountId(bytesToHex((await identity.fromSeed(derived)).publicKey));
  } finally { master.fill(0); derived.fill(0); }
}

// Interactive download/file-picker check, using the real UI and a public fixture.
export async function mountBackupDownloadFixture(target: HTMLElement): Promise<() => Promise<void>> {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('local_check_only');
  const component = mount(EncryptedBackup, { target, props: {
    accountId: await fixtureAccountId(), nickname: 'Public fixture',
    onClose: () => {}, onVerified: async () => true,
    readVault: async (password) => password === 'public-fixture-password'
      ? { mnemonic: new TextEncoder().encode(fixture), metadata: null } : null,
  } });
  await tick();
  return () => unmount(component);
}

export async function checkSeedBackupInBrowser(target: HTMLElement, report: (message: string) => void): Promise<void> {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('local_check_only');
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const click = async (label: string) => {
    const button = [...target.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
    if (!button) throw new Error(`button_missing:${label}`);
    button.click();
    await tick();
    await tick();
  };
  const enterAnswers = async (correct: boolean) => {
    const labels = [...target.querySelectorAll<HTMLLabelElement>('label.answer')];
    assert(labels.length === 3, 'three_answer_fields');
    for (const label of labels) {
      const position = Number(label.textContent?.match(/№(\d+)/)?.[1]);
      const input = label.querySelector('input')!;
      input.value = correct ? fixture.split(' ')[position - 1] : 'wrong';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await tick();
  };
  for (const scenario of ['skip', 'check', 'save-failure']) {
    let verified = false;
    let skipped = false;
    let canSave = scenario !== 'save-failure';
    const seed = new TextEncoder().encode(fixture);
    const component = mount(SeedBackup, { target, props: {
      initialSeed: seed, onSeedConsumed: () => seed.fill(0),
      onSkip: () => { skipped = true; },
      onVerified: async () => { if (canSave) verified = true; return canSave; },
    } });
    try {
      await tick();
      if (scenario === 'skip') {
        await click('Пропустить');
        assert(skipped && !verified, 'skip_must_not_verify');
        report('OK: пропуск не подтверждает резервную копию.');
        continue;
      }
      await click('Показать фразу');
      assert(target.querySelectorAll('.seed span').length === 12, 'twelve_numbered_words');
      const hold = target.querySelector<HTMLButtonElement>('.seed')!;
      assert(!hold.textContent?.includes('abandon'), 'phrase_hidden_until_hold');
      hold.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      await tick();
      assert(hold.textContent!.includes('abandon'), 'phrase_revealed_while_held');
      hold.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
      await tick();
      assert(!hold.textContent?.includes('abandon'), 'phrase_hidden_after_release');
      assert(seed.every((byte) => byte === 0), 'initial_seed_consumed');
      assert(!verified && !target.querySelector('img, a[download]'), 'display_not_verification_or_export');
      await click('Записала — проверить');
      assert(!target.querySelector('.seed'), 'phrase_hidden_during_check');
      await enterAnswers(false);
      await click('Проверить запись');
      assert(!verified && !!target.querySelector('[role="alert"]'), 'wrong_answers_rejected');
      assert([...target.querySelectorAll<HTMLInputElement>('label.answer input')].every((input) => input.value === 'wrong'), 'wrong_answers_preserved');
      assert(!target.querySelector('input[type="password"]'), 'seed_answers_not_password_fields');
      await enterAnswers(true);
      await click('Проверить запись');
      if (!canSave) {
        assert(!verified && !!target.querySelector('[role="alert"]'), 'failed_save_not_confirmed');
        canSave = true;
        await click('Проверить запись');
        report('OK: ошибка сохранения не подтверждает копию; повтор работает.');
      }
      assert(verified && !target.querySelector('input, .seed') && target.textContent!.includes('Запись проверена'), 'successful_verification_cleans_secrets');
      await click('Продолжить');
      assert(skipped, 'completion_callback');
      report('OK: показ не снимает предупреждение; неверные слова отклонены; три верных слова подтверждены, поля очищены.');
    } finally {
      await unmount(component);
      seed.fill(0);
    }
  }
  report('OK: фраза видна только во время удержания; ответы после ошибки сохраняются и не являются полями пароля.');

  let recovered = '';
  const entry = mount(SeedEntry, { target, props: { onComplete: (phrase: string) => { recovered = phrase; } } });
  try {
    await tick();
    const input = target.querySelector<HTMLInputElement>('#recovery-word')!;
    input.value = 'abotu'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    assert(input.getAttribute('aria-invalid') === 'true', 'recovery_typo_highlighted');
    for (let index = 0; index < 12; index++) {
      input.value = fixture.split(' ')[index]; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
      if (index < 11) { input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); await tick(); }
    }
    assert(!target.querySelector('.word-list')!.textContent!.includes('abandon'), 'completed_words_hidden');
    await click('Восстановить аккаунт');
    assert(recovered === fixture, 'wordwise_restore_returns_exact_phrase');
    report('OK: ввод по словам, переход пробелом, скрытые завершённые слова и подсветка опечатки.');
  } finally { await unmount(entry); recovered = ''; }

  const id = await fixtureAccountId();
  const seed = new TextEncoder().encode(fixture);
  const encrypted = await createEncryptedBackup(seed, 'public-fixture-password', id, 'Public fixture');
  seed.fill(0);
  let fileVerified = false;
  const waitUntil = async (condition: () => boolean) => {
    const deadline = Date.now() + 8000;
    while (!condition()) { if (Date.now() > deadline) throw new Error('backup_reader_timeout'); await new Promise((resolve) => setTimeout(resolve, 20)); await tick(); }
  };
  const exporter = mount(EncryptedBackup, { target, props: {
    accountId: id, nickname: 'Public fixture', onClose: () => {}, onVerified: async () => { fileVerified = true; return true; },
    readVault: async (password) => password === 'public-fixture-password'
      ? { mnemonic: new TextEncoder().encode(fixture), metadata: null } : null,
  } });
  try {
    await tick();
    const password = target.querySelector<HTMLInputElement>('input[type="password"]')!;
    password.value = 'wrong-password'; password.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    await click('Создать зашифрованный файл');
    await waitUntil(() => !!target.querySelector('[role="alert"]'));
    assert(!target.querySelector('a[download]') && !fileVerified, 'wrong_vault_password_no_file');
    password.value = 'public-fixture-password'; password.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    await click('Создать зашифрованный файл');
    await waitUntil(() => !!target.querySelector('a[download], [role="alert"]'));
    assert(!!target.querySelector('a[download]'), `export_download_missing:${target.textContent}`);
    const link = target.querySelector<HTMLAnchorElement>('a[download]')!;
    const exported = await (await fetch(link.href)).text();
    assert(!exported.includes(fixture) && !exported.includes(id), 'export_no_plain_secrets');
    assert(!!target.querySelector('input[type="file"]') && !fileVerified, 'download_precedes_verification');
    const transfer = new DataTransfer();
    transfer.items.add(new File([exported], link.download, { type: 'application/json' }));
    const file = target.querySelector<HTMLInputElement>('input[type="file"]')!;
    file.files = transfer.files; file.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    const filePassword = target.querySelector<HTMLInputElement>('input[type="password"]')!;
    filePassword.value = 'wrong-file-password'; filePassword.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    await click('Проверить сохранённый файл');
    await waitUntil(() => !!target.querySelector('[role="alert"]'));
    assert(!fileVerified && !!target.querySelector('a[download]'), 'wrong_file_password_keeps_download');
    filePassword.value = 'public-fixture-password'; filePassword.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    await click('Проверить сохранённый файл');
    await waitUntil(() => target.textContent!.includes('Файл проверен'));
    assert(fileVerified && !target.querySelector('input'), 'exported_file_verified_and_inputs_cleared');
    report('OK: создание → ссылка скачивания → обратный выбор именно созданного файла → проверка пароля. Ошибки не подтверждают копию, повтор работает.');
  } finally { await unmount(exporter); }
  let resolveVault: (value: { mnemonic: Uint8Array; metadata: null }) => void = () => {};
  let waiting = false;
  const cancelledSeed = new TextEncoder().encode(fixture);
  const cancelled = mount(EncryptedBackup, { target, props: {
    accountId: id, nickname: '', onClose: () => {}, onVerified: async () => true,
    readVault: () => new Promise((resolve) => { waiting = true; resolveVault = resolve; }),
  } });
  try {
    await tick();
    const password = target.querySelector<HTMLInputElement>('input[type="password"]')!;
    password.value = 'public-fixture-password'; password.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    await click('Создать зашифрованный файл');
    assert(waiting && !!target.querySelector('[role="status"]'), 'pending_export_shows_progress');
    await click('Отменить подготовку');
    resolveVault({ mnemonic: cancelledSeed, metadata: null }); await tick(); await tick();
    assert(cancelledSeed.every((byte) => byte === 0) && !target.querySelector('a[download]'), 'cancelled_export_wipes_late_seed');
    assert(!password.disabled && !!target.querySelector('[role="alert"]'), 'cancelled_export_allows_retry');
    report('OK: ожидание видно; отмена возвращает рабочую форму, поздний результат не создаёт файл, seed очищена.');
  } finally { await unmount(cancelled); cancelledSeed.fill(0); }
  fileVerified = false;
  const reader = mount(BackupReader, { target, props: { expectedAccountId: id,
    onOpened: async (opened) => { fileVerified = opened.accountId === id && new TextDecoder().decode(opened.seed) === fixture; return fileVerified; },
  } });
  try {
    await tick();
    const transfer = new DataTransfer();
    transfer.items.add(new File([encrypted], 'Automesh-public-fixture.automesh', { type: 'application/json' }));
    const file = target.querySelector<HTMLInputElement>('input[type="file"]')!;
    file.files = transfer.files; file.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    const password = target.querySelector<HTMLInputElement>('input[type="password"]')!;
    password.value = 'wrong-public-fixture-password'; password.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    await click('Открыть резервную копию');
    await waitUntil(() => !!target.querySelector('[role="alert"]'));
    assert(!fileVerified, 'file_not_verified_with_wrong_password');
    password.value = 'public-fixture-password'; password.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    await click('Открыть резервную копию');
    await waitUntil(() => fileVerified);
    report('OK: настоящий компонент открывает зашифрованный файл; неверный пароль не подтверждает копию.');
  } finally { await unmount(reader); }
  report('ГОТОВО: проверен настоящий компонент в браузере, пользовательские аккаунты и история не изменены.');
}
