import { MaxUI } from '@maxhub/max-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { RouterProvider, useNavigate } from 'react-router-dom';
import { ApiError, useMock } from '../api/client';
import { getStartParam, isMockBridge } from '../bridge';
import { isDemoMode } from '../clock';
import { DemoClockBadge, DemoClockSync } from '../clock/DemoClockControl';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx повторять бессмысленно: протухшая initData или чужая заявка не станут другими
      retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status < 500),
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});

if (isDemoMode) document.documentElement.classList.add('demo');

export function App() {
  return (
    <MaxUI colorScheme="light" className="app-root">
      <QueryClientProvider client={queryClient}>
        <DemoClockSync />
        <DemoClockBadge />
        <RouterProvider router={router} />
        {(isMockBridge() || useMock) && (
          <div className="mock-badge">
            {[isMockBridge() && 'mock bridge', useMock && 'mock api'].filter(Boolean).join(' · ')}
          </div>
        )}
      </QueryClientProvider>
    </MaxUI>
  );
}

/** start_param живёт всю сессию, а редирект по нему нужен один раз: иначе каждая смена
 * раскладки возвращает соседа на экран присоединения. */
let deepLinkConsumed = false;

export function DeepLinkRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    if (deepLinkConsumed) return;
    const p = getStartParam();
    if (!p) return;
    deepLinkConsumed = true;
    const [kind, ...rest] = p.split('_');
    const id = rest.join('_');
    if (kind === 'r' && id) navigate(`/join/${id}`, { replace: true });
    else if (kind === 'req' && id) navigate(`/requests/${id}`, { replace: true });
  }, [navigate]);
  return null;
}
