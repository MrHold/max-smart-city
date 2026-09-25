// Типы приходят из @msc/domain: там же лежат zod-схемы, которыми их валидирует сервер.
export type {
  AcceptInput,
  ApiErrorBody,
  AssignInput,
  BulkResult,
  Category,
  ClusterCard,
  CompleteInput,
  Contact,
  DispatcherInbox,
  Executor,
  ExecutorInvite,
  Home,
  HouseSearchItem,
  JoinInput,
  Liability,
  LiabilityStep,
  Location,
  LocationScope,
  Me,
  Measurement,
  MeasurementPlace,
  NewRequestInput,
  Provenance,
  RejectInput,
  RequestDetail,
  RequestEvent,
  RequestKind,
  RequestStatus,
  RequestSummary,
  Role,
  Schedule,
  Service,
} from '@msc/domain';

export interface DocumentLink {
  url: string;
  expiresAt: string;
}
