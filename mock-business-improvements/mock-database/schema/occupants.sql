-- Unified Occupant Schema
-- MOCK PROPOSAL ONLY - NOT FOR PRODUCTION

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Houses/Properties
CREATE TABLE houses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(10) UNIQUE NOT NULL,  -- e.g., "EB1", "SH2"
    address TEXT NOT NULL,
    total_rooms INTEGER NOT NULL,
    occupied_rooms INTEGER DEFAULT 0,
    weekly_rent_base DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Occupants (was: tenants)
CREATE TABLE occupants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    house_id UUID REFERENCES houses(id) ON DELETE CASCADE,
    
    -- Personal details
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    nationality TEXT,
    passport_number TEXT,
    
    -- Occupancy details
    room_number VARCHAR(10),
    move_in_date DATE,
    move_out_date DATE,
    weekly_rent DECIMAL(10,2) NOT NULL,
    bond_amount DECIMAL(10,2),
    
    -- Status tracking
    status VARCHAR(20) DEFAULT 'future' CHECK (status IN ('future', 'active', 'archived', 'bond_pending')),
    status_changed_at TIMESTAMP DEFAULT NOW(),
    
    -- Communication IDs
    whatsapp_id TEXT,
    wa_group_jid TEXT,
    
    -- Payment tracking
    payment_reference TEXT,
    bank_account JSONB,  -- {bsb, account, name}
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Indexes for performance
    INDEX idx_occupants_house_id (house_id),
    INDEX idx_occupants_status (status),
    INDEX idx_occupants_phone (phone),
    UNIQUE (house_id, room_number) WHERE move_out_date IS NULL
);

-- Payments
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    occupant_id UUID REFERENCES occupants(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL,
    reference TEXT,
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
    bank_transaction_id TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Bond Returns
CREATE TABLE bond_returns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    occupant_id UUID REFERENCES occupants(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    return_date DATE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    token TEXT UNIQUE,  -- For personalized bond return forms
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- House WhatsApp Groups
CREATE TABLE house_wa_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    house_id UUID REFERENCES houses(id) ON DELETE CASCADE,
    group_jid TEXT UNIQUE NOT NULL,
    group_name TEXT,
    member_count INTEGER DEFAULT 0,
    last_sync TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Audit Log
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(10) CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_values JSONB,
    new_values JSONB,
    changed_by TEXT DEFAULT 'system',
    changed_at TIMESTAMP DEFAULT NOW()
);

-- Views for common queries
CREATE VIEW active_occupants AS
SELECT o.*, h.code as house_code, h.address
FROM occupants o
JOIN houses h ON o.house_id = h.id
WHERE o.status IN ('active', 'future');

CREATE VIEW monthly_financial_summary AS
SELECT 
    DATE_TRUNC('month', p.payment_date) as month,
    COUNT(DISTINCT p.occupant_id) as paying_occupants,
    SUM(p.amount) as total_revenue,
    COUNT(br.id) as bond_returns_processed,
    SUM(br.amount) as total_bonds_returned
FROM payments p
LEFT JOIN bond_returns br ON DATE_TRUNC('month', br.return_date) = DATE_TRUNC('month', p.payment_date)
WHERE p.status = 'confirmed'
GROUP BY DATE_TRUNC('month', p.payment_date);

-- Triggers for automation
CREATE OR REPLACE FUNCTION update_house_occupancy()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE houses 
        SET occupied_rooms = (
            SELECT COUNT(*) 
            FROM occupants 
            WHERE house_id = NEW.house_id 
            AND status IN ('active', 'future')
            AND move_out_date IS NULL
        )
        WHERE id = NEW.house_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_house_occupancy
AFTER INSERT OR UPDATE OR DELETE ON occupants
FOR EACH ROW
EXECUTE FUNCTION update_house_occupancy();

-- Function to generate occupancy letter
CREATE OR REPLACE FUNCTION generate_occupancy_letter(occupant_uuid UUID)
RETURNS TEXT AS $$
DECLARE
    occupant_record RECORD;
    house_record RECORD;
    letter_text TEXT;
BEGIN
    SELECT * INTO occupant_record FROM occupants WHERE id = occupant_uuid;
    SELECT * INTO house_record FROM houses WHERE id = occupant_record.house_id;
    
    letter_text := format(
        'CONFIRMATION OF OCCUPANCY
        Date: %s
        
        To: %s
        Address: %s
        Room: %s
        
        This letter confirms that %s is authorized to occupy room %s at %s,
        commencing %s.
        
        Weekly Contribution: $%s
        Security Contribution: $%s
        
        Signed,
        Natalie Mosh
        Property Manager
        +61 410 076 937',
        CURRENT_DATE,
        occupant_record.name,
        house_record.address,
        occupant_record.room_number,
        occupant_record.name,
        occupant_record.room_number,
        house_record.address,
        occupant_record.move_in_date,
        occupant_record.weekly_rent,
        occupant_record.bond_amount
    );
    
    RETURN letter_text;
END;
$$ LANGUAGE plpgsql;