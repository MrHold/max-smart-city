import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, json } from './client';
import type {
  Category,
  Home,
  HouseSearchItem,
  JoinInput,
  Me,
  NewRequestInput,
  RequestDetail,
  RequestSummary,
} from './types';

export const keys = {
  me: ['me'] as const,
  home: (houseId: string) => ['home', houseId] as const,
  categories: (houseId: string) => ['categories', houseId] as const,
  houses: (q: string) => ['houses', q] as const,
  requests: ['requests'] as const,
  request: (id: string) => ['request', id] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api<Me>('/api/me') });
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

export function useRequest(id: string | undefined) {
  return useQuery({
    queryKey: keys.request(id ?? ''),
    queryFn: () => api<RequestDetail>(`/api/requests/${id}`),
    enabled: Boolean(id),
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
    onSuccess: (r) => qc.setQueryData(keys.request(r.id), r),
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
