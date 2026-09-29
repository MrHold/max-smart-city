import { NavLink } from 'react-router-dom';
import { IconBuilding, IconHome, IconList, IconUser } from './icons';
import { cx } from './index';

const tabs = [
  { to: '/', label: 'Мой дом', icon: IconHome, end: true },
  { to: '/requests', label: 'Заявки', icon: IconList },
  { to: '/house', label: 'Дом', icon: IconBuilding },
  { to: '/profile', label: 'Профиль', icon: IconUser },
];

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Разделы">
      {tabs.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => cx('tab', isActive && 'tab--on')}
        >
          <Icon size={22} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
