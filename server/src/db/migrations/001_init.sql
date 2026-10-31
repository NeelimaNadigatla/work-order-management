-- Initial schema for the Maintenance Work Order Management system.
-- Timestamps are stored as ISO-8601 UTC strings; calendar dates as YYYY-MM-DD.

CREATE TABLE assets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code      TEXT    NOT NULL COLLATE NOCASE,          -- business "Asset ID", e.g. AST-1024
    asset_type      TEXT    NOT NULL,
    manufacturer    TEXT    NOT NULL,
    model           TEXT    NOT NULL,
    serial_number   TEXT    NOT NULL COLLATE NOCASE,
    usage_hours     REAL    NOT NULL DEFAULT 0 CHECK (usage_hours >= 0),
    usage_cycles    INTEGER NOT NULL DEFAULT 0 CHECK (usage_cycles >= 0),
    status          TEXT    NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE', 'RETIRED')),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX ux_assets_asset_code          ON assets (asset_code);
CREATE UNIQUE INDEX ux_assets_manufacturer_serial ON assets (manufacturer, serial_number);
CREATE INDEX        ix_assets_status              ON assets (status);

CREATE TABLE technicians (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    skill       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE', 'ON_LEAVE', 'INACTIVE')),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ix_technicians_status ON technicians (status);

-- Lookup table: keeps "is this an emergency?" as data rather than a hard-coded list (Rule 6).
CREATE TABLE maintenance_types (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT    NOT NULL,
    is_emergency  INTEGER NOT NULL DEFAULT 0 CHECK (is_emergency IN (0, 1)),
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO maintenance_types (code, name, is_emergency) VALUES
    ('INSPECTION',       'Inspection',       0),
    ('SERVICING',        'Servicing',        0),
    ('REPAIR',           'Repair',           0),
    ('OVERHAUL',         'Overhaul',         0),
    ('EMERGENCY_REPAIR', 'Emergency Repair', 1);

CREATE TABLE work_orders (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_number    TEXT    NOT NULL COLLATE NOCASE,
    asset_id             INTEGER NOT NULL REFERENCES assets (id)            ON DELETE RESTRICT,
    maintenance_type_id  INTEGER NOT NULL REFERENCES maintenance_types (id) ON DELETE RESTRICT,
    technician_id        INTEGER          REFERENCES technicians (id)       ON DELETE RESTRICT,
    description          TEXT    NOT NULL,
    priority             TEXT    NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status               TEXT    NOT NULL DEFAULT 'OPEN'
                         CHECK (status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    scheduled_date       TEXT    NOT NULL
                         CHECK (scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at           TEXT,
    completed_at         TEXT,
    cancelled_at         TEXT,

    -- Rule 2: a CRITICAL work order must have an assigned technician.
    CONSTRAINT ck_critical_has_technician
        CHECK (priority <> 'CRITICAL' OR technician_id IS NOT NULL),
    -- Once work is assigned/started/done there must be someone responsible for it.
    CONSTRAINT ck_assigned_states_have_technician
        CHECK (status IN ('OPEN', 'CANCELLED') OR technician_id IS NOT NULL),
    CONSTRAINT ck_completed_at_matches_status
        CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
    CONSTRAINT ck_cancelled_at_matches_status
        CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);
-- Rule 1: work order number is unique (case-insensitive via the column collation).
CREATE UNIQUE INDEX ux_work_orders_number         ON work_orders (work_order_number);
CREATE INDEX        ix_work_orders_status         ON work_orders (status);
CREATE INDEX        ix_work_orders_priority       ON work_orders (priority);
CREATE INDEX        ix_work_orders_asset          ON work_orders (asset_id, created_at);
CREATE INDEX        ix_work_orders_technician     ON work_orders (technician_id);
CREATE INDEX        ix_work_orders_type           ON work_orders (maintenance_type_id);
CREATE INDEX        ix_work_orders_scheduled_date ON work_orders (scheduled_date);

-- Rules 3 & 4 as a last line of defence: COMPLETED and CANCELLED are terminal,
-- even for writes that bypass the API.
CREATE TRIGGER trg_work_orders_terminal_status
BEFORE UPDATE OF status ON work_orders
WHEN OLD.status IN ('COMPLETED', 'CANCELLED') AND NEW.status <> OLD.status
BEGIN
    SELECT RAISE(ABORT, 'work order is in a terminal status and cannot change status');
END;

-- Audit trail of status changes and (re)assignments: drives "maintenance history".
CREATE TABLE work_order_status_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id  INTEGER NOT NULL REFERENCES work_orders (id) ON DELETE CASCADE,
    from_status    TEXT,
    to_status      TEXT    NOT NULL,
    technician_id  INTEGER REFERENCES technicians (id) ON DELETE SET NULL,
    note           TEXT,
    changed_at     TEXT    NOT NULL
);
CREATE INDEX ix_wo_history_work_order ON work_order_status_history (work_order_id, changed_at);
