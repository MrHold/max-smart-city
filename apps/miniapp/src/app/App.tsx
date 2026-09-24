import { MaxUI } from '@maxhub/max-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { RouterProvider, useNavigate } from 'react-router-dom';
import { useMock } from '../api/client';
import { getStartParam, isMockBridge } from '../bridge';
import { DemoClockBadge, DemoClockSync } from '../clock/DemoClockControl';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false } },
});

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

export function DeepLinkRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const p = getStartParam();
    if (!p) return;
    const [kind, ...rest] = p.split('_');
    const id = rest.join('_');
    if (kind === 'r' && id) navigate(`/join/${id}`, { replace: true });
    else if (kind === 'req' && id) navigate(`/requests/${id}`, { replace: true });
  }, [navigate]);
  return null;
}
