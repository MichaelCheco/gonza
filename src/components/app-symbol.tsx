import { SymbolView, type SymbolViewProps } from 'expo-symbols';

type SymbolName = SymbolViewProps['name'];
type AppSymbolName = Extract<SymbolName, string>;

const androidSymbolByIosName: Partial<Record<AppSymbolName, NonNullable<Exclude<SymbolName, string>['android']>>> = {
  'arrow.uturn.backward': 'undo',
  'calendar': 'calendar_month',
  'calendar.badge.plus': 'calendar_add_on',
  'checkmark': 'check',
  'checkmark.circle.fill': 'check_circle',
  'chevron.left': 'chevron_left',
  'chevron.right': 'chevron_right',
  'clock.arrow.circlepath': 'history',
  'doc.on.doc': 'content_copy',
  'dollarsign.circle.fill': 'attach_money',
  'exclamationmark.triangle.fill': 'warning',
  'magnifyingglass': 'search',
  'person.3.fill': 'groups',
  'person.badge.plus': 'person_add',
  'plus': 'add',
  'rectangle.portrait.and.arrow.right': 'logout',
  'slider.horizontal.3': 'tune',
  'trash.fill': 'delete',
  'xmark.circle.fill': 'cancel',
};

export function AppSymbol({ name, ...props }: SymbolViewProps) {
  if (typeof name !== 'string') {
    return <SymbolView name={name} {...props} />;
  }

  const androidName = androidSymbolByIosName[name];

  return (
    <SymbolView
      name={androidName ? { ios: name, android: androidName, web: androidName } : name}
      {...props}
    />
  );
}
