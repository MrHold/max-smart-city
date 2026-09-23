export type Provenance = 'fact' | 'calc' | 'model';
export type Role = 'resident' | 'dispatcher' | 'executor';
export type RequestKind = 'emergency' | 'repair' | 'utility_quality' | 'utility_interruption';
export type Service = 'heating' | 'hot_water' | 'cold_water';
export type RequestStatus =
  | 'new'
  | 'accepted'
  | 'rejected'
  | 'assigned'
  | 'in_progress'
  | 'done'
  | 'confirmed'
  | 'reopened';
export type LocationScope = 'yard' | 'entrance' | 'floor' | 'apartment';
export type MeasurementPlace = 'room' | 'corner_room' | 'tap';

export interface Me {
  userId: string;
  role: Role;
  house: { id: string; address: string; apartmentLabel: string | null } | null;
}

export interface HouseSearchItem {
  id: string;
  address: string;
  regionCode: string;
  dataKind: Provenance;
}

export interface Schedule {
  days: number[];
  from: string;
  to: string;
}

export interface Contact {
  kind: 'office' | 'dispatcher' | 'emergency';
  phone: string;
  schedule: Schedule | null;
  open: { isOpen: boolean; until: string | null } | null;
}

export interface Home {
  house: { id: string; address: string; tz: string; dataKind: Provenance };
  org: { id: string; name: string; address: string | null; dataKind: Provenance } | null;
  contacts: Contact[];
  announcement: { title: string; text: string } | null;
  now: string;
}

export interface Category {
  code: string;
  title: string;
  kind: RequestKind;
  service?: Service;
  zone?: 'yard' | 'entrance' | 'apartment';
  slaHours: number;
}

export interface Measurement {
  value: number;
  unit: 'celsius';
  measuredAt: string;
  place: MeasurementPlace;
}

export interface Location {
  scope: LocationScope;
  entrance?: number;
  floor?: number;
  note?: string;
}

export interface NewRequestInput {
  category: string;
  location: Location;
  description: string;
  startedAt: string;
  measurements: Measurement[];
  plannedNotice: boolean | null;
  photoKeys: string[];
}

export interface RequestSummary {
  id: string;
  number: string;
  title: string;
  kind: RequestKind;
  status: RequestStatus;
  createdAt: string;
  dueAt: string;
  overdue: boolean;
  locationText: string;
  joinersCount: number;
}

export interface LiabilityStep {
  label: string;
  value: number;
  unit: string;
  provenance: Provenance;
  ref?: { act: string; point: string; url?: string };
}

export interface Liability {
  requestId: string;
  apartmentKopecks: number;
  houseKopecks: number;
  perHourHouseKopecks: number;
  hours: number;
  thresholdReachedAt: string | null;
  steps: LiabilityStep[];
  computedAt: string;
  rulesVersion: string;
}

export interface RequestEvent {
  type: string;
  label: string;
  at: string;
}

export interface RequestDetail extends RequestSummary {
  service: Service | null;
  description: string;
  location: Location;
  startedAt: string;
  endedAt: string | null;
  plannedNotice: boolean | null;
  measurements: Measurement[];
  photos: Array<{ key: string; url: string }>;
  events: RequestEvent[];
  joiners: Array<{ apartmentLabel: string; joinedAt: string }>;
  liability: Liability | null;
  executor: { nameShort: string; slot: string | null; phone: string | null } | null;
  isAuthor: boolean;
  canJoin: boolean;
  shareUrl: string;
  claim: { available: boolean; url: string | null };
  gji: { available: boolean; afterAt: string | null };
}

export interface JoinInput {
  apartmentLabel: string;
  measurements: Measurement[];
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
