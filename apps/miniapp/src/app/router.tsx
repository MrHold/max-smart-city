import { createBrowserRouter, Outlet } from 'react-router-dom';
import { DispatcherInbox } from '../screens/dispatcher/Inbox';
import { JoinRequest } from '../screens/JoinRequest';
import { BindHouse } from '../screens/resident/BindHouse';
import { Contacts } from '../screens/resident/Contacts';
import { Home } from '../screens/resident/Home';
import { House } from '../screens/resident/House';
import { MyData } from '../screens/resident/MyData';
import { NewRequest } from '../screens/resident/NewRequest';
import { Profile } from '../screens/resident/Profile';
import { RequestCard } from '../screens/resident/RequestCard';
import { Requests } from '../screens/resident/Requests';
import { TabBar } from '../ui/TabBar';
import { DeepLinkRedirect } from './App';

function WithTabs() {
  return (
    <>
      <DeepLinkRedirect />
      <Outlet />
      <TabBar />
    </>
  );
}

function Bare() {
  return (
    <>
      <DeepLinkRedirect />
      <Outlet />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <WithTabs />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/contacts', element: <Contacts /> },
      { path: '/requests', element: <Requests /> },
      { path: '/requests/:id', element: <RequestCard /> },
      { path: '/house', element: <House /> },
      { path: '/profile', element: <Profile /> },
      { path: '/profile/data', element: <MyData /> },
    ],
  },
  {
    element: <Bare />,
    children: [
      { path: '/bind', element: <BindHouse /> },
      { path: '/requests/new', element: <NewRequest /> },
      { path: '/join/:id', element: <JoinRequest /> },
      { path: '/dispatcher', element: <DispatcherInbox /> },
    ],
  },
]);
