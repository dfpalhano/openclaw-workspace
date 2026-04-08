# Occupants API Endpoints
**MOCK PROPOSAL ONLY**

## Base URL
`https://api.housemates.online/v1/occupants`

## Authentication
- API Key: `X-API-Key: <key>`
- JWT Token: `Authorization: Bearer <token>`

## Endpoints

### 1. List Occupants
```
GET /occupants
```

**Query Parameters:**
- `status` - Filter by status (active, future, archived, bond_pending)
- `house_code` - Filter by house code
- `limit` - Results per page (default: 50)
- `offset` - Pagination offset

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "John Smith",
      "phone": "+61412345678",
      "house_code": "EB1",
      "room": "3",
      "status": "active",
      "weekly_rent": 330.00,
      "move_in_date": "2026-03-14",
      "whatsapp_id": "61412345678@c.us"
    }
  ],
  "pagination": {
    "total": 132,
    "limit": 50,
    "offset": 0
  }
}
```

### 2. Get Single Occupant
```
GET /occupants/{id}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "John Smith",
    "phone": "+61412345678",
    "email": "john@example.com",
    "house": {
      "code": "EB1",
      "address": "553 Vulture St E, East Brisbane",
      "wa_group_jid": "120363179855324665@g.us"
    },
    "room": "3",
    "status": "active",
    "weekly_rent": 330.00,
    "bond_amount": 1320.00,
    "move_in_date": "2026-03-14",
    "payment_reference": "1519870741 EB1",
    "bank_account": {
      "bsb": "014002",
      "account": "231444039",
      "name": "John Smith"
    },
    "metadata": {
      "nationality": "Australian",
      "passport_number": "PA123456"
    },
    "created_at": "2026-03-10T10:30:00Z",
    "updated_at": "2026-03-10T10:30:00Z"
  }
}
```

### 3. Create Occupant
```
POST /occupants
```

**Request Body:**
```json
{
  "name": "Jane Doe",
  "phone": "+61498765432",
  "house_code": "SH2",
  "room": "5",
  "weekly_rent": 320.00,
  "move_in_date": "2026-04-15",
  "bond_amount": 1280.00,
  "payment_reference": "SH2-2026-04",
  "metadata": {
    "nationality": "French",
    "source": "Flatmates"
  }
}
```

**Automated Actions (webhooks):**
1. Generate occupancy letter PDF
2. Send welcome WhatsApp message
3. Add to house WhatsApp group
4. Create calendar event for move-in
5. Schedule follow-up tasks

### 4. Update Occupant Status
```
PATCH /occupants/{id}/status
```

**Request Body:**
```json
{
  "status": "archived",
  "move_out_date": "2026-04-30",
  "notes": "Completed bond return"
}
```

**Automated Actions:**
- If status → `archived`:
  1. Remove from WhatsApp group
  2. Generate bond return token
  3. Send bond return form link
  4. Archive payment records

### 5. Occupant Changes (Webhook)
```
POST /webhooks/occupant-changes
```

**Payload:**
```json
{
  "event": "occupant.status_changed",
  "data": {
    "occupant_id": "uuid",
    "old_status": "active",
    "new_status": "archived",
    "changed_at": "2026-04-06T22:30:00Z"
  }
}
```

**Subscribers:**
- WhatsApp bridge (group management)
- Analytics dashboard
- Notification system
- Reporting engine

## Integration Examples

### 1. WhatsApp Sync
```javascript
// When occupant created/status changed
POST /integrations/whatsapp/sync-occupant
{
  "occupant_id": "uuid",
  "action": "add_to_group" // or "remove_from_group"
}
```

### 2. Occupancy Letter Generation
```javascript
POST /documents/occupancy-letter
{
  "occupant_id": "uuid",
  "template": "standard",
  "signatory": "natalie_mosh"
}
```

### 3. Bond Return Flow
```javascript
// 1. Create bond return case
POST /bond-returns
{
  "occupant_id": "uuid",
  "amount": 1320.00,
  "return_date": "2026-04-30"
}

// 2. Generate personalized form
GET /bond-return/form/{token}

// 3. Mark as paid
PATCH /bond-returns/{id}
{
  "status": "paid",
  "paid_date": "2026-05-05"
}
```

## Error Handling

**Common Errors:**
- `400` - Invalid input data
- `404` - Occupant not found
- `409` - Room already occupied
- `429` - Rate limit exceeded

**Error Response:**
```json
{
  "error": {
    "code": "ROOM_OCCUPIED",
    "message": "Room 3 in house EB1 is already occupied",
    "details": {
      "house_code": "EB1",
      "room": "3",
      "current_occupant": "John Smith"
    }
  }
}
```

## Rate Limits
- `100 requests/minute` per API key
- `1000 requests/day` per IP address

## Webhook Events
- `occupant.created`
- `occupant.status_changed`
- `occupant.payment_received`
- `occupant.bond_return_initiated`
- `occupant.archived`