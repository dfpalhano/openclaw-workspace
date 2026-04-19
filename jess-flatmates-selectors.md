# Jess Flatmates.com.au CSS Selectors Reference

**Source:** `/home/diegopalhano/Documents/Jess.txt` (captured from actual Flatmates.com.au inspection)
**Date:** 2026-04-19

## Key Selectors for Jess Chrome Extension

### Message Timestamps
```
div.time-sent
```
**Example:** `"Wednesday 4:17 am"`

**Note:** May include delivery status prefix like `"Delivered\nWednesday 4:17 am"` - parser should remove "Delivered"/"Seen"/"Read"/"Sent" prefixes.

### Message Text
**Incoming messages (enquirer):**
```
div.message-details.other-message > div.message-text > p
```

**Outgoing messages (our replies):**
```
div > div.message-text > p
```

### Conversation List Items
```
li.conversation-item
li.conversation-item.unread  (for unread messages)
```

### Conversation Details
**Enquirer name:**
```
a > div.details > div.member
```

**Last active status:**
```
a > div.details > div.last-active
```
**Example:** `"Online Today"`

**Message snippet/preview:**
```
a > div.details > div.snippet
```

### Listing Information
**Listing link in message thread:**
```
div.inbox-messages-subject > a
```

**Listing ID extraction:** Look for `P` numbers in href (e.g., `P1773878`)

### Profile Key Features (age, gender, occupation)
```
div.styles__keyFeatures___3CJA7 > div:nth-child(1) > div > div.styles__text__wrapper___2QRUH > div  (gender)
div.styles__keyFeatures___3CJA7 > div:nth-child(2) > div > div.styles__text__wrapper___2QRUH > div  (age)
div.styles__keyFeatures___3CJA7 > div:nth-child(3) > div > div.styles__text__wrapper___2QRUH > div  (occupation)
```

### Listing Management
**Listing status labels:**
```
div.status-label.live > span        (Live)
div.status-label.boosted > span     (Boosted)
div.status-label.inactive > span    (Inactive)
```

**Deactivate room button:**
```
button > span:contains("Set as unavailable")
```

**Deactivate listing button:**
```
button > span:contains("Deactivate listing")
```

## Parser Requirements

### Timestamp Formats to Handle
1. `"Wednesday 4:17 am"` (day of week + time)
2. `"Today 1:48 pm"` (relative day + time)
3. `"Yesterday 3:01pm"` (relative day + time)
4. `"5 Mar 3:01pm"` (date + month + time)
5. `"3 days ago 2:30pm"` (relative days + time)

### Delivery Status Prefixes to Remove
- `"Delivered"`
- `"Seen"`
- `"Read"`
- `"Sent"`

### Year Inference Logic
Flatmates does NOT display years. Parser must infer year:
- Start with current year
- If parsed date is in future (>2 days ahead), subtract years until in past
- Maximum 5 years back (covers 2021-2026 range)

## Implementation Notes

1. **Multiple selector attempts:** Try `div.time-sent`, `.time-sent`, `[data-testid="message-timestamp"]`, etc.
2. **Clean text:** Remove delivery status prefixes and normalize newlines
3. **Debug logging:** Log which selector found timestamp and raw text
4. **Fallback patterns:** If no timestamp found, use extraction timestamp with warning

## Common Issues & Solutions

### Issue: "Delivered\nToday 1:48 pm"
**Solution:** Remove "Delivered" prefix, parse "Today 1:48 pm"

### Issue: Year ambiguity (Mar 5 = 2023, 2024, 2025, or 2026?)
**Solution:** Assume most recent past year (subtract years until date ≤ extraction date)

### Issue: "3 days ago" format
**Solution:** Parse relative days and subtract from current date

## Verification Commands

Check timestamp parsing:
```bash
cd /home/diegopalhano/projects/mission-control && node -e "
const data = require('./data/jess-inbox.json');
const invalid = data.filter(item => 
  item.messageHistory && Object.values(item.messageHistory).some(msg => 
    msg.ts && isNaN(new Date(msg.ts).getTime())
  )
);
console.log(\`Invalid timestamps: \${invalid.length}\`);
"
```

## Chrome Extension Code Updates

Based on this reference, the following fixes were applied to `/home/diegopalhano/projects/jess-bot/extension/content.js`:

1. **Added "Today" support** to timestamp parser
2. **Added delivery status removal** (`Delivered`, `Seen`, `Read`, `Sent`)
3. **Added "X days ago" support** for relative timestamps
4. **Added multiple selector attempts** with debug logging

## Last Updated
2026-04-19