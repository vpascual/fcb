/**
 * FCB Predictions — Google Apps Script backend
 *
 * SETUP:
 * 1. Go to https://sheets.google.com → create a new sheet named "FCB Predictions"
 * 2. Rename the first tab to "Game"
 * 3. Add these exact headers in row 1:
 *    matchId | victorHome | victorAway | maxHome | maxAway
 * 4. Open Extensions → Apps Script
 * 5. Paste this entire file, replacing the default content
 * 6. Click Deploy → New Deployment → Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 7. Copy the Web App URL
 * 8. Paste it in your .env.local file as VITE_SCRIPT_URL=<url>
 * 9. Restart the dev server: npm run dev
 */

const SHEET_NAME = 'Game'

// ── GET handler — supports ?action=getData and ?action=save ──────────────────
function doGet(e) {
  const action = e.parameter.action || 'getData'

  if (action === 'save') {
    return handleSave(e.parameter)
  }

  return getData()
}

// ── Return all predictions ───────────────────────────────────────────────────
function getData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
  const [headers, ...rows] = sheet.getDataRange().getValues()

  const predictions = rows.map(row => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = row[i] })
    return obj
  })

  return json({ predictions })
}

// ── Save a prediction (via GET params to avoid CORS preflight) ───────────────
function handleSave(params) {
  const { matchId, player, h, a } = params
  if (!matchId || !player || h === undefined || a === undefined) {
    return json({ error: 'Missing params' })
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
  const [headers, ...rows] = sheet.getDataRange().getValues()

  const midIdx  = headers.indexOf('matchId')
  const existingRowIdx = rows.findIndex(r => String(r[midIdx]) === String(matchId))

  if (existingRowIdx === -1) {
    // New row
    const newRow = headers.map(header => {
      if (header === 'matchId')    return matchId
      if (header === 'victorHome') return player === 'victor' ? Number(h) : ''
      if (header === 'victorAway') return player === 'victor' ? Number(a) : ''
      if (header === 'maxHome')    return player === 'max'    ? Number(h) : ''
      if (header === 'maxAway')    return player === 'max'    ? Number(a) : ''
      return ''
    })
    sheet.appendRow(newRow)
  } else {
    // Update existing
    const rowNum = existingRowIdx + 2  // +1 header, +1 one-based
    if (player === 'victor') {
      sheet.getRange(rowNum, headers.indexOf('victorHome') + 1).setValue(Number(h))
      sheet.getRange(rowNum, headers.indexOf('victorAway') + 1).setValue(Number(a))
    } else {
      sheet.getRange(rowNum, headers.indexOf('maxHome') + 1).setValue(Number(h))
      sheet.getRange(rowNum, headers.indexOf('maxAway') + 1).setValue(Number(a))
    }
  }

  return json({ ok: true })
}

// ── Helper ───────────────────────────────────────────────────────────────────
function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}
