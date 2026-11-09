export type SettingsSection = 'overview' | 'account' | 'privacy' | 'security' | 'connection' | 'files' | 'application';
export type LegacySettingsSection = SettingsSection | 'nodes' | 'connect' | 'storage';
export type ConnectionSection = 'overview' | 'nodes' | 'connect' | 'diagnostics' | 'direct' | 'servers' | 'outgoing' | 'incoming' | 'parameters' | 'recovery' | 'radio';
export type MediaSettingsSection = 'overview' | 'files' | 'storage';
export const settingsMenu: { id: SettingsSection; label: string }[] = [
  { id:'account',label:'Профиль' }, { id:'privacy',label:'Конфиденциальность' },
  { id:'security',label:'Безопасность' }, { id:'connection',label:'Связь и ноды' },
  { id:'files',label:'Медиа и хранилище' }, { id:'application',label:'Приложение' },
];
export const settingsDescriptions: Record<SettingsSection,string> = {
  overview:'Выберите раздел. Настройки профиля действуют на этом устройстве.',
  account:'Фото, имя, Mesh ID и профили.', privacy:'Отметки о прочтении, пересылка и метаданные фото.',
  security:'Устройства, пароль и резервные копии.', connection:'Соединения и доставка сообщений.',
  files:'GIF, стикеры, загрузки и очистка.', application:'Тема, обновления и запуск без сайта.',
};
export const connectionMenu = [
  {id:'servers',label:'Сигналинг',detail:'Поиск собеседников и настройка соединений'},
  {id:'direct',label:'Прямое подключение',detail:'P2P-соединения и обмен QR'},
  {id:'radio',label:'LoRa',detail:'Meshtastic по USB, радиоконтакты и очередь'},
  {id:'nodes',label:'Ноды доставки',detail:'Домашние и серверные ноды, доступ к очереди'},
  {id:'diagnostics',label:'Диагностика доставки',detail:'Проверки, подтверждения и ошибки'},
  {id:'parameters',label:'Параметры сети',detail:'Интернет, LAN и резерв сигналинга'},
  {id:'recovery',label:'Восстановление связи',detail:'После восстановления данных или сбоя подключения'},
];
export const mediaSettingsMenu = [
  {id:'library',label:'GIF и стикеры',detail:'Моя библиотека, импорт и удаление'},
  {id:'files',label:'Получение и воспроизведение',detail:'Автоматическая загрузка файлов и видео'},
  {id:'storage',label:'Хранилище',detail:'Занятое место, сохранённые файлы и очистка'},
];
// Old in-memory shortcuts keep their destination; no saved network setting,
// membership or queue is migrated by an interface reorganization.
export function settingsLocation(section: LegacySettingsSection | string, connection?: string, media?: string) {
  const connections = ['overview','nodes','connect','diagnostics','direct','servers','outgoing','incoming','parameters','recovery','radio'];
  const medias = ['overview','files','storage'];
  if(section==='nodes'||section==='connect') return {section:'connection' as SettingsSection,connection:section as ConnectionSection,media:'overview' as MediaSettingsSection};
  if(section==='storage') return {section:'files' as SettingsSection,connection:'overview' as ConnectionSection,media:'storage' as MediaSettingsSection};
  return {
    section:(section==='overview'||settingsMenu.some(item=>item.id===section) ? section : 'overview') as SettingsSection,
    connection:(connections.includes(connection??'') ? connection : 'overview') as ConnectionSection,
    media:(medias.includes(media??'') ? media : 'overview') as MediaSettingsSection,
  };
}
