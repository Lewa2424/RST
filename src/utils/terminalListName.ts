const OPERATION_SHORT: Record<string, string> = {
  UNLOADING: 'Прибытие',
  CLEANING: 'Зачистка',
  LOADING: 'Погрузка',
  DEPARTURE_LOADED: 'Отправка гружёным',
  DEPARTURE_EMPTY: 'Отправка пустым',
};

export function formatRuDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}.${m}.${y}`;
}

export function defaultTerminalListName(operationType: string, listDate: string): string {
  const op = OPERATION_SHORT[operationType] || operationType;
  return `${op} ${formatRuDate(listDate)}`;
}

export function todayIsoDate(): string {
  return new Date().toISOString().split('T')[0];
}
