# Occupancy Analytics Dashboard
**MOCK PROPOSAL ONLY**

## Overview
Real-time dashboard for monitoring occupancy rates, turnover, and house performance.

## Key Metrics

### 1. Occupancy Overview
```
Total Houses: 15
Total Rooms: 132
Occupied Rooms: 124 (94% occupancy)
Vacant Rooms: 8 (6% vacancy)
```

### 2. Turnover Analysis
```
Monthly Turnover Rate: 8.3% (11 occupants)
Average Stay Duration: 4.2 months
Move-ins This Month: 14
Move-outs This Month: 11
```

### 3. House Performance
```
Top Performing Houses:
1. EB1 - 100% occupancy, $4,290/week
2. SH2 - 100% occupancy, $3,840/week  
3. WL4 - 95% occupancy, $3,630/week

Underperforming Houses:
1. SP9 - 80% occupancy, $2,640/week
2. V5 - 85% occupancy, $2,805/week
```

## Dashboard Widgets

### Widget 1: Occupancy Heatmap
```javascript
{
  title: "House Occupancy Heatmap",
  type: "heatmap",
  data: {
    houses: [
      { code: "EB1", occupancy: 100, revenue: 4290 },
      { code: "SH2", occupancy: 100, revenue: 3840 },
      { code: "WL4", occupancy: 95, revenue: 3630 },
      // ... all houses
    ]
  },
  refresh: "5 minutes"
}
```

### Widget 2: Turnover Timeline
```javascript
{
  title: "Occupant Turnover Timeline",
  type: "timeline",
  data: {
    events: [
      { date: "2026-03-01", type: "move_in", count: 5 },
      { date: "2026-03-08", type: "move_out", count: 3 },
      { date: "2026-03-15", type: "move_in", count: 7 },
      // ... weekly events
    ]
  },
  timeframe: "last_30_days"
}
```

### Widget 3: Vacancy Forecast
```javascript
{
  title: "30-Day Vacancy Forecast",
  type: "forecast",
  data: {
    current_vacancy: 8,
    forecast: [
      { date: "2026-04-07", predicted_vacancy: 7 },
      { date: "2026-04-14", predicted_vacancy: 9 },
      { date: "2026-04-21", predicted_vacancy: 6 },
      { date: "2026-04-28", predicted_vacancy: 5 }
    ],
    confidence: 0.85
  },
  algorithm: "prophet"
}
```

## Alerts & Notifications

### Critical Alerts:
- **High Vacancy**: House below 80% occupancy for 2+ weeks
- **Rent Arrears**: Occupant > 7 days overdue on payment
- **Inspection Due**: Property inspection overdue by > 30 days
- **Bond Return Pending**: Bond return > 14 days after move-out

### Warning Alerts:
- **Occupancy Drop**: House occupancy decreased by >10% in 7 days
- **High Turnover**: House turnover rate >15% in 30 days
- **Low Engagement**: Occupant not opening WA messages for 7+ days

## Reports

### Daily Report (6:00 AM)
```
OCCUPANCY DAILY REPORT - 2026-04-07
===================================

SUMMARY:
• Total Revenue Yesterday: $18,240
• New Move-ins: 2 (EB1, SH2)
• Move-outs Completed: 1 (WL4)
• Bond Returns Processed: 3 ($3,960)

ALERTS:
⚠️  SP9 - 80% occupancy (3 rooms vacant)
⚠️  V5 - Rent arrears: 2 occupants > 7 days
✅  All inspections scheduled for this week

TOP PERFORMERS:
1. EB1 - 100% occupancy, $4,290/week
2. SH2 - 100% occupancy, $3,840/week

ACTION ITEMS:
1. Follow up on SP9 vacancies
2. Contact V5 arrears occupants
3. Schedule SH1 inspection (due tomorrow)
```

### Weekly Performance Report
```sql
-- Weekly occupancy metrics
SELECT 
    DATE_TRUNC('week', created_at) as week,
    COUNT(DISTINCT house_id) as active_houses,
    AVG(occupancy_rate) as avg_occupancy,
    SUM(weekly_revenue) as total_revenue,
    COUNT(CASE WHEN status = 'archived' THEN 1 END) as move_outs,
    COUNT(CASE WHEN status = 'active' AND rent_days_overdue > 7 THEN 1 END) as arrears_count
FROM house_daily_snapshot
GROUP BY DATE_TRUNC('week', created_at)
ORDER BY week DESC;
```

## Predictive Analytics

### 1. Occupancy Prediction Model
```python
# Mock prediction model
def predict_occupancy(house_code, days_ahead=30):
    """
    Predict occupancy for a house based on:
    - Historical occupancy patterns
    - Seasonality (semester cycles)
    - Market trends
    - House-specific factors
    """
    features = {
        'house_code': house_code,
        'day_of_year': current_day_of_year,
        'is_semester_start': True/False,
        'market_demand_index': 0.85,
        'house_rating': 4.2
    }
    
    # ML model prediction
    predicted_occupancy = model.predict(features)
    return predicted_occupancy
```

### 2. Revenue Forecasting
```
Weekly Revenue Forecast (Next 4 Weeks):
Week 1: $18,500 ± $500
Week 2: $18,200 ± $600  
Week 3: $18,800 ± $700
Week 4: $19,100 ± $800

Factors considered:
- Scheduled move-ins/outs
- Seasonal trends
- Payment patterns
- Market conditions
```

## Integration Points

### 1. Mission Control Sync
```javascript
// Real-time sync with MC
POST /webhooks/mc-occupant-update
{
  "event": "occupant.updated",
  "data": {
    "occupant_id": "uuid",
    "changes": {
      "status": "archived",
      "move_out_date": "2026-04-30"
    }
  }
}
```

### 2. WhatsApp Engagement Metrics
```javascript
// Track message engagement
GET /analytics/whatsapp/engagement
{
  "house_code": "EB1",
  "period": "last_7_days",
  "metrics": {
    "messages_sent": 42,
    "messages_read": 38,
    "response_rate": 65%,
    "avg_response_time": "2.3 hours"
  }
}
```

### 3. Financial Integration
```javascript
// Bank transaction matching
POST /analytics/payments/match-transactions
{
  "bank_statement": [...],
  "expected_payments": [...],
  "matching_algorithm": "fuzzy_date_amount"
}
```

## Implementation Roadmap

### Phase 1: Basic Dashboard (2 weeks)
- Occupancy overview widget
- Basic alerts (vacancy, arrears)
- Daily email report

### Phase 2: Advanced Analytics (4 weeks)
- Turnover analysis
- Predictive forecasting
- WhatsApp engagement tracking
- Mobile-responsive dashboard

### Phase 3: AI/ML Features (8 weeks)
- Occupancy prediction model
- Anomaly detection
- Automated recommendations
- Natural language queries

## Success Metrics

### Quantitative:
- **Dashboard adoption**: >80% staff using daily
- **Alert accuracy**: >95% true positive rate
- **Forecast error**: <5% mean absolute error
- **Report generation time**: <5 seconds

### Qualitative:
- **Better decisions**: Data-driven occupancy management
- **Faster response**: Real-time alerts reduce problem duration
- **Staff efficiency**: Less manual data gathering
- **Business growth**: Foundation for scaling operations