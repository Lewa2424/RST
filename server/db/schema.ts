/** Shared logical schema — SQLite and Postgres dialects. */

export const SQLITE_SCHEMA = `
    CREATE TABLE IF NOT EXISTS product_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(product_type_id, normalized_name)
    );

    CREATE TABLE IF NOT EXISTS stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      internal_code TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      product_grade_id INTEGER NULL REFERENCES product_grades(id),
      station_id INTEGER NULL REFERENCES stations(id),
      route_date TEXT NULL,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE','PARTIAL','CLOSED','HAS_DISCREPANCIES','ARCHIVED')),
      wagon_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT NULL,
      closed_at TEXT NULL,
      archived_at TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wagons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wagon_number TEXT NOT NULL UNIQUE,
      is_checksum_valid INTEGER NOT NULL CHECK (is_checksum_valid IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS route_wagons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      wagon_id INTEGER NOT NULL REFERENCES wagons(id),
      sequence_no INTEGER NULL,
      declared_weight_kg INTEGER NULL,
      terminal_status TEXT NOT NULL DEFAULT 'NOT_AT_TERMINAL' CHECK (terminal_status IN (
        'NOT_AT_TERMINAL',
        'AT_TERMINAL',
        'UNLOADED',
        'CLEANED',
        'LOADED',
        'DEPARTED_LOADED',
        'DEPARTED_EMPTY'
      )),
      processed_for_route INTEGER NOT NULL DEFAULT 0 CHECK (processed_for_route IN (0,1)),
      notes TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(route_id, wagon_id)
    );

    CREATE TABLE IF NOT EXISTS terminal_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NULL REFERENCES routes(id) ON DELETE SET NULL,
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      product_grade_id INTEGER NULL REFERENCES product_grades(id),
      station_id INTEGER NULL REFERENCES stations(id),
      display_name TEXT NULL,
      operation_type TEXT NOT NULL CHECK (operation_type IN ('UNLOADING','CLEANING','LOADING','DEPARTURE_LOADED','DEPARTURE_EMPTY')),
      list_date TEXT NULL,
      import_method TEXT NOT NULL CHECK (import_method IN ('MANUAL','TEXT','EXCEL','WORD','IMAGE')),
      status TEXT NOT NULL CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED')),
      created_at TEXT NOT NULL,
      confirmed_at TEXT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS terminal_list_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      terminal_list_id INTEGER NOT NULL REFERENCES terminal_lists(id) ON DELETE CASCADE,
      wagon_id INTEGER NULL REFERENCES wagons(id),
      raw_wagon_number TEXT NOT NULL,
      parsed_wagon_number TEXT NULL,
      checksum_valid INTEGER NULL,
      weight_kg INTEGER NULL,
      row_status TEXT NOT NULL CHECK (row_status IN ('VALID','INVALID_NUMBER','DUPLICATE','UNMATCHED','CONFLICT','CONFIRMED')),
      parsing_confidence REAL NULL,
      source_row_no INTEGER NULL,
      notes TEXT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wagon_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wagon_id INTEGER NOT NULL REFERENCES wagons(id),
      route_id INTEGER NULL REFERENCES routes(id) ON DELETE SET NULL,
      terminal_list_id INTEGER NULL REFERENCES terminal_lists(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('AT_TERMINAL','UNLOADED','CLEANED','LOADED','DEPARTED_LOADED','DEPARTED_EMPTY','MANUAL_CORRECTION')),
      event_at TEXT NOT NULL,
      weight_kg INTEGER NULL,
      product_type_id INTEGER NULL REFERENCES product_types(id),
      product_grade_id INTEGER NULL REFERENCES product_grades(id),
      notes TEXT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discrepancies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      terminal_list_id INTEGER NULL REFERENCES terminal_lists(id) ON DELETE SET NULL,
      wagon_id INTEGER NULL REFERENCES wagons(id),
      type TEXT NOT NULL CHECK (type IN (
        'MISSING_IN_TERMINAL_LIST',
        'EXTRA_IN_TERMINAL_LIST',
        'INVALID_CHECK_DIGIT',
        'DUPLICATE_IN_INPUT',
        'ACTIVE_ROUTE_CONFLICT',
        'WEIGHT_MISMATCH',
        'DATA_CONFLICT'
      )),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','IGNORED')),
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      resolved_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS import_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('ROUTE','TERMINAL_LIST')),
      import_method TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('UPLOADED','PARSED','REVIEW','CONFIRMED','FAILED','CANCELLED')),
      parser_version TEXT NULL,
      rows_total INTEGER NOT NULL DEFAULT 0,
      rows_valid INTEGER NOT NULL DEFAULT 0,
      rows_invalid INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NULL,
      error_message TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_routes_display_name ON routes(display_name);
    CREATE INDEX IF NOT EXISTS idx_wagons_wagon_number ON wagons(wagon_number);
    CREATE INDEX IF NOT EXISTS idx_routes_filter ON routes(product_type_id, product_grade_id, station_id, status);
    CREATE INDEX IF NOT EXISTS idx_route_wagons_processed ON route_wagons(route_id, processed_for_route);
    CREATE INDEX IF NOT EXISTS idx_discrepancies_route ON discrepancies(route_id, status);
    CREATE INDEX IF NOT EXISTS idx_terminal_list_rows_list ON terminal_list_rows(terminal_list_id);
`;

export const POSTGRES_SCHEMA = `
    CREATE TABLE IF NOT EXISTS product_types (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_grades (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(product_type_id, normalized_name)
    );

    CREATE TABLE IF NOT EXISTS stations (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      internal_code TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      product_grade_id INTEGER NULL REFERENCES product_grades(id),
      station_id INTEGER NULL REFERENCES stations(id),
      route_date TEXT NULL,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE','PARTIAL','CLOSED','HAS_DISCREPANCIES','ARCHIVED')),
      wagon_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT NULL,
      closed_at TEXT NULL,
      archived_at TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wagons (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      wagon_number TEXT NOT NULL UNIQUE,
      is_checksum_valid INTEGER NOT NULL CHECK (is_checksum_valid IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS route_wagons (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      wagon_id INTEGER NOT NULL REFERENCES wagons(id),
      sequence_no INTEGER NULL,
      declared_weight_kg INTEGER NULL,
      terminal_status TEXT NOT NULL DEFAULT 'NOT_AT_TERMINAL' CHECK (terminal_status IN (
        'NOT_AT_TERMINAL',
        'AT_TERMINAL',
        'UNLOADED',
        'CLEANED',
        'LOADED',
        'DEPARTED_LOADED',
        'DEPARTED_EMPTY'
      )),
      processed_for_route INTEGER NOT NULL DEFAULT 0 CHECK (processed_for_route IN (0,1)),
      notes TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(route_id, wagon_id)
    );

    CREATE TABLE IF NOT EXISTS terminal_lists (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      route_id INTEGER NULL REFERENCES routes(id) ON DELETE SET NULL,
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      product_grade_id INTEGER NULL REFERENCES product_grades(id),
      station_id INTEGER NULL REFERENCES stations(id),
      display_name TEXT NULL,
      operation_type TEXT NOT NULL CHECK (operation_type IN ('UNLOADING','CLEANING','LOADING','DEPARTURE_LOADED','DEPARTURE_EMPTY')),
      list_date TEXT NULL,
      import_method TEXT NOT NULL CHECK (import_method IN ('MANUAL','TEXT','EXCEL','WORD','IMAGE')),
      status TEXT NOT NULL CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED')),
      created_at TEXT NOT NULL,
      confirmed_at TEXT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS terminal_list_rows (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      terminal_list_id INTEGER NOT NULL REFERENCES terminal_lists(id) ON DELETE CASCADE,
      wagon_id INTEGER NULL REFERENCES wagons(id),
      raw_wagon_number TEXT NOT NULL,
      parsed_wagon_number TEXT NULL,
      checksum_valid INTEGER NULL,
      weight_kg INTEGER NULL,
      row_status TEXT NOT NULL CHECK (row_status IN ('VALID','INVALID_NUMBER','DUPLICATE','UNMATCHED','CONFLICT','CONFIRMED')),
      parsing_confidence DOUBLE PRECISION NULL,
      source_row_no INTEGER NULL,
      notes TEXT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wagon_events (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      wagon_id INTEGER NOT NULL REFERENCES wagons(id),
      route_id INTEGER NULL REFERENCES routes(id) ON DELETE SET NULL,
      terminal_list_id INTEGER NULL REFERENCES terminal_lists(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('AT_TERMINAL','UNLOADED','CLEANED','LOADED','DEPARTED_LOADED','DEPARTED_EMPTY','MANUAL_CORRECTION')),
      event_at TEXT NOT NULL,
      weight_kg INTEGER NULL,
      product_type_id INTEGER NULL REFERENCES product_types(id),
      product_grade_id INTEGER NULL REFERENCES product_grades(id),
      notes TEXT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discrepancies (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      terminal_list_id INTEGER NULL REFERENCES terminal_lists(id) ON DELETE SET NULL,
      wagon_id INTEGER NULL REFERENCES wagons(id),
      type TEXT NOT NULL CHECK (type IN (
        'MISSING_IN_TERMINAL_LIST',
        'EXTRA_IN_TERMINAL_LIST',
        'INVALID_CHECK_DIGIT',
        'DUPLICATE_IN_INPUT',
        'ACTIVE_ROUTE_CONFLICT',
        'WEIGHT_MISMATCH',
        'DATA_CONFLICT'
      )),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','IGNORED')),
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      resolved_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS import_sessions (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('ROUTE','TERMINAL_LIST')),
      import_method TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('UPLOADED','PARSED','REVIEW','CONFIRMED','FAILED','CANCELLED')),
      parser_version TEXT NULL,
      rows_total INTEGER NOT NULL DEFAULT 0,
      rows_valid INTEGER NOT NULL DEFAULT 0,
      rows_invalid INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NULL,
      error_message TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_routes_display_name ON routes(display_name);
    CREATE INDEX IF NOT EXISTS idx_wagons_wagon_number ON wagons(wagon_number);
    CREATE INDEX IF NOT EXISTS idx_routes_filter ON routes(product_type_id, product_grade_id, station_id, status);
    CREATE INDEX IF NOT EXISTS idx_route_wagons_processed ON route_wagons(route_id, processed_for_route);
    CREATE INDEX IF NOT EXISTS idx_discrepancies_route ON discrepancies(route_id, status);
    CREATE INDEX IF NOT EXISTS idx_terminal_list_rows_list ON terminal_list_rows(terminal_list_id);
`;
