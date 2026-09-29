import type { DeleteMeResult, DemoClockInput, DemoClockState, MyData } from '@msc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ensureWebApp, getPlatform } from '../bridge';
import { applyDemoOffset, isDemoMode } from '../clock';
import { absoluteApiUrl, api, apiBlob, json, openBlob } from './client';
import type {
  AcceptInput,
  AssignInput,
  BulkResult,
  Category,
  CompleteInput,
  DispatcherInbox,
  DocumentLink,
  Executor,
  ExecutorInvite,
  Home,
  HouseSearchItem,
  JoinInput,
  Me,
  NewRequestInput,
  RejectInput,
  RequestDetail,
  RequestSummary,
  Role,
} from './types';

export const keys = {
  me: ['me'] as const,
  home: (houseId: string) => ['home', houseId] as const,
  categories: (houseId: string) => ['categories', houseId] as const,
  houses: (q: string) => ['houses', q] as const,
  requests: ['requests'] as const,
  request: (id: string) => ['request', id] as const,
  demoClock: ['demoClock'] as const,
  myData: ['myData'] as const,
  dispatcherInbox: ['dispatcher', 'inbox'] as const,
  executors: ['dispatcher', 'executors'] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api<Me>('/api/me'), staleTime: 5 * 60_000 });
}

export function useHome(houseId: string | undefined) {
  return useQuery({
    queryKey: keys.home(houseId ?? ''),
    queryFn: () => api<Home>(`/api/houses/${houseId}/home`),
    enabled: Boolean(houseId),
    refetchInterval: 60_000,
  });
}

export function useCategories(houseId: string | undefined) {
  return useQuery({
    queryKey: keys.categories(houseId ?? ''),
    queryFn: () => api<Category[]>(`/api/houses/${houseId}/categories`),
    enabled: Boolean(houseId),
    staleTime: 5 * 60_000,
  });
}

export function useHouseSearch(q: string) {
  return useQuery({
    queryKey: keys.houses(q),
    queryFn: () => api<HouseSearchItem[]>(`/api/houses?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 3,
  });
}

export function useBindHouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { houseId: string; apartmentLabel: string }) =>
      api<Me>('/api/me/house', json(input)),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}

export function useMyRequests() {
  return useQuery({
    queryKey: keys.requests,
    queryFn: () => api<RequestSummary[]>('/api/requests'),
  });
}

export function useRequest(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.request(id ?? ''),
    queryFn: () => api<RequestDetail>(`/api/requests/${id}`),
    enabled: Boolean(id) && enabled,
    refetchInterval: 30_000,
  });
}

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewRequestInput) => api<RequestDetail>('/api/requests', json(input)),
    onSuccess: (r) => {
      qc.setQueryData(keys.request(r.id), r);
      void qc.invalidateQueries({ queryKey: keys.requests });
    },
  });
}

export function useJoinRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JoinInput) => api<RequestDetail>(`/api/requests/${id}/join`, json(input)),
    onSuccess: (r) => {
      qc.setQueryData(keys.request(r.id), r);
      void qc.invalidateQueries({ queryKey: keys.requests });
    },
  });
}

export function useConfirmRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accepted: boolean) =>
      api<RequestDetail>(`/api/requests/${id}/confirm`, json({ accepted })),
    onSuccess: (r) => {
      qc.setQueryData(keys.request(r.id), r);
      void qc.invalidateQueries({ queryKey: keys.requests });
    },
  });
}

export function useUploadPhoto() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<{ key: string; url: string }>('/api/photos', { method: 'POST', body: form });
    },
  });
}

export function useDemoClock() {
  return useQuery({
    queryKey: keys.demoClock,
    queryFn: () => api<DemoClockState>('/api/demo/clock'),
    enabled: isDemoMode,
    refetchInterval: 30_000,
    retry: false,
  });
}

/** После перемотки сроки и суммы на сервере другие — перечитываем всё, что от времени зависит. */
export function useShiftDemoClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DemoClockInput) => api<DemoClockState>('/api/demo/clock', json(input)),
    onSuccess: (state) => {
      qc.setQueryData(keys.demoClock, state);
      applyDemoOffset(state.offsetMs);
      void qc.invalidateQueries({ queryKey: keys.requests });
      void qc.invalidateQueries({ queryKey: ['request'] });
      void qc.invalidateQueries({ queryKey: ['dispatcher'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
      void qc.invalidateQueries({ queryKey: keys.myData });
    },
  });
}

export type DocumentKind = 'claim' | 'gji';

interface OpenDocumentInput {
  requestId: string;
  kind: DocumentKind;
  filename: string;
  /** Подписанная ссылка из карточки, если сервер её уже выдал: тогда лишнего запроса не будет. */
  signedUrl?: string | null;
}

/**
 * MAX Bridge не скачивает файлы по href и blob-ссылкам — только через downloadFile по https,
 * без заголовков. Поэтому внутри MAX берём подписанную ссылку и отдаём её клиенту;
 * в обычном браузере качаем сами с заголовком входа.
 */
export function useOpenDocument() {
  return useMutation({
    mutationFn: async ({ requestId, kind, filename, signedUrl }: OpenDocumentInput) => {
      const wa = ensureWebApp();
      if (typeof wa.downloadFile !== 'function') {
        const blob = await apiBlob(`/api/requests/${requestId}/documents/${kind}.pdf`);
        openBlob(blob, filename);
        return;
      }
      const path =
        signedUrl ??
        (await api<DocumentLink>(`/api/requests/${requestId}/documents/${kind}/link`, json({})))
          .url;
      const url = absoluteApiUrl(path);
      if (getPlatform() === 'web' && wa.openLink) wa.openLink(url);
      else await wa.downloadFile?.(url, filename);
    },
  });
}

export function useMyData() {
  return useQuery({ queryKey: keys.myData, queryFn: () => api<MyData>('/api/me/data') });
}

/** Удаление всего, что сервис хранит о человеке. После него кэш пуст: пользователя больше нет. */
export function useDeleteMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<DeleteMeResult>('/api/me', { method: 'DELETE' }),
    onSuccess: () => qc.clear(),
  });
}

export function useDispatcherInbox(enabled = true) {
  return useQuery({
    queryKey: keys.dispatcherInbox,
    queryFn: () => api<DispatcherInbox>('/api/dispatcher/inbox'),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useExecutors() {
  return useQuery({
    queryKey: keys.executors,
    queryFn: () => api<Executor[]>('/api/dispatcher/executors'),
  });
}

export function useExecutorInvite() {
  return useMutation({
    mutationFn: (executorId: string) =>
      api<ExecutorInvite>(`/api/dispatcher/executors/${executorId}/invite`),
  });
}

export type DispatcherAction =
  | { action: 'accept'; body: AcceptInput }
  | { action: 'reject'; body: RejectInput }
  | { action: 'assign'; body: AssignInput }
  | { action: 'start'; body: AcceptInput }
  | { action: 'complete'; body: CompleteInput };

/** Массовое действие над кластером: после него меняются и входящие, и карточки жителей. */
export function useDispatcherAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: DispatcherAction) =>
      api<BulkResult>(`/api/dispatcher/${action}`, json(body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.dispatcherInbox });
      void qc.invalidateQueries({ queryKey: keys.requests });
      void qc.invalidateQueries({ queryKey: ['request'] });
    },
  });
}

/** Демо-режим: жюри проходит сценарий одним аккаунтом, вторым человеком быть некому. */
export function useBecomeDispatcher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ role: Role; orgId: string; orgName: string }>('/api/demo/dispatcher', json({})),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.me }),
  });
}
