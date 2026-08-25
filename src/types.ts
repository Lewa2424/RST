export type TerminalStatus = 
  | 'NOT_AT_TERMINAL'
  | 'AT_TERMINAL'
  | 'UNLOADED'
  | 'CLEANED'
  | 'LOADED'
  | 'DEPARTED_LOADED'
  | 'DEPARTED_EMPTY';

export type RouteStatus = 
  | 'ACTIVE'
  | 'PARTIAL'
  | 'CLOSED'
  | 'HAS_DISCREPANCIES'
  | 'ARCHIVED';

export type OperationType = 
  | 'UNLOADING'
  | 'CLEANING'
  | 'LOADING'
  | 'DEPARTURE_LOADED'
  | 'DEPARTURE_EMPTY';

export type ImportMethod = 'MANUAL' | 'TEXT' | 'EXCEL' | 'WORD' | 'IMAGE';

export type DiscrepancyType = 
  | 'MISSING_IN_TERMINAL_LIST'
  | 'EXTRA_IN_TERMINAL_LIST'
  | 'INVALID_CHECK_DIGIT'
  | 'DUPLICATE_IN_INPUT'
  | 'ACTIVE_ROUTE_CONFLICT'
  | 'WEIGHT_MISMATCH'
  | 'DATA_CONFLICT';

export type DiscrepancyStatus = 'OPEN' | 'RESOLVED' | 'IGNORED';

export interface ProductType {
  id: number;
  name: string;
  normalized_name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  // Computed metrics
  active_routes_count?: number;
  total_wagons_count?: number;
  unprocessed_wagons_count?: number;
  open_discrepancies_count?: number;
}

export interface ProductGrade {
  id: number;
  product_type_id: number;
  name: string;
  normalized_name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Station {
  id: number;
  name: string;
  normalized_name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Route {
  id: number;
  internal_code: string;
  display_name: string;
  product_type_id: number;
  product_grade_id?: number | null;
  station_id?: number | null;
  route_date?: string | null;
  status: RouteStatus;
  wagon_count: number;
  processed_count: number;
  notes?: string | null;
  closed_at?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
  // Joined names
  product_type_name?: string;
  product_grade_name?: string;
  station_name?: string;
  open_discrepancies_count?: number;
}

export interface Wagon {
  id: number;
  wagon_number: string;
  is_checksum_valid: number;
  created_at: string;
  updated_at: string;
}

export interface RouteWagon {
  id: number;
  route_id: number;
  wagon_id: number;
  wagon_number: string;
  is_checksum_valid: number;
  sequence_no?: number | null;
  declared_weight_kg?: number | null;
  terminal_weight_kg?: number | null;
  terminal_status: TerminalStatus;
  processed_for_route: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  discrepancies?: Discrepancy[];
}

export interface TerminalList {
  id: number;
  route_id?: number | null;
  route_display_name?: string | null;
  product_type_id: number;
  product_grade_id?: number | null;
  station_id?: number | null;
  display_name?: string | null;
  operation_type: OperationType;
  list_date?: string | null;
  import_method: ImportMethod;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  created_at: string;
  confirmed_at?: string | null;
  updated_at: string;
  // Joined names
  product_type_name?: string;
  product_grade_name?: string;
  station_name?: string;
  rows_count?: number;
}

export interface TerminalListRow {
  id: number;
  terminal_list_id: number;
  wagon_id?: number | null;
  raw_wagon_number: string;
  parsed_wagon_number?: string | null;
  checksum_valid?: number | null;
  weight_kg?: number | null;
  row_status: 'VALID' | 'INVALID_NUMBER' | 'DUPLICATE' | 'UNMATCHED' | 'CONFLICT' | 'CONFIRMED';
  parsing_confidence?: number | null;
  source_row_no?: number | null;
  notes?: string | null;
  created_at: string;
}

export interface Discrepancy {
  id: number;
  route_id: number;
  terminal_list_id?: number | null;
  wagon_id?: number | null;
  wagon_number?: string | null;
  type: DiscrepancyType;
  status: DiscrepancyStatus;
  details_json: string;
  created_at: string;
  resolved_at?: string | null;
}

export interface WagonEvent {
  id: number;
  wagon_id: number;
  route_id?: number | null;
  terminal_list_id?: number | null;
  event_type: 'AT_TERMINAL' | 'UNLOADED' | 'CLEANED' | 'LOADED' | 'DEPARTED_LOADED' | 'DEPARTED_EMPTY' | 'MANUAL_CORRECTION';
  event_at: string;
  weight_kg?: number | null;
  product_type_id?: number | null;
  product_grade_id?: number | null;
  notes?: string | null;
  created_at: string;
}

export interface ParsedRowCandidate {
  raw_wagon_number: string;
  parsed_wagon_number: string;
  is_checksum_valid: boolean;
  expected_check_digit: number;
  actual_check_digit: number;
  suggested_wagon_number?: string | null;
  weight_kg: number | null;
  is_duplicate: boolean;
  doubtful?: boolean;
  parsing_confidence?: number;
  active_route_conflict?: string | null;
  error_reason?: string | null;
  source_row_no?: number;
}

export interface GlobalSummaryMetrics {
  active_routes_count: number;
  total_wagons_count: number;
  pending_wagons_count: number;
  at_terminal_count: number;
  unloaded_count: number;
  cleaned_count: number;
  loaded_count: number;
  open_discrepancies_count: number;
}

export interface SearchWagonResult {
  wagon_number: string;
  is_checksum_valid: number;
  routes: Array<{
    route_id: number;
    internal_code: string;
    display_name: string;
    route_status: RouteStatus;
    product_type_name: string;
    product_grade_name?: string;
    station_name?: string;
    terminal_status: TerminalStatus;
    declared_weight_kg?: number;
    notes?: string;
  }>;
  events: Array<{
    event_type: string;
    event_at: string;
    weight_kg?: number;
    route_display_name?: string;
    notes?: string;
  }>;
}
