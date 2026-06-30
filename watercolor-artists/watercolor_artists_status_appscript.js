const SPREADSHEET_ID = '17yWD_Xy7nzwsSLKJIW5OUijnaI-jRf_tQj2MhRmHO2U';
const SHEET_NAME = 'Кандидаты';

const COLUMNS = {
  number: 1,
  artist: 2,
  rating: 3,
  note: 4,
  status: 5,
  owner: 6,
  workNotes: 7,
  updatedAt: 8,
  report: 9,
};

function doGet(e) {
  const action = String(e.parameter.action || 'list');
  const callback = e.parameter.callback;

  if (action === 'health') {
    return output_({ ok: true, spreadsheetId: SPREADSHEET_ID }, callback);
  }

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getDisplayValues();
  const rows = values.slice(1).filter((row) => row[COLUMNS.artist - 1]);

  const data = rows.map((row) => ({
    number: row[COLUMNS.number - 1],
    artist: row[COLUMNS.artist - 1],
    rating: row[COLUMNS.rating - 1],
    candidateNote: row[COLUMNS.note - 1],
    status: row[COLUMNS.status - 1],
    owner: row[COLUMNS.owner - 1],
    notes: row[COLUMNS.workNotes - 1],
    updatedAt: row[COLUMNS.updatedAt - 1],
    report: row[COLUMNS.report - 1],
  }));

  return output_({ ok: true, data }, callback);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const payload = parsePayload_(e);
    const artist = String(payload.artist || '').trim();
    if (!artist) {
      return output_({ ok: false, error: 'artist is required' });
    }

    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    const rowIndex = findArtistRow_(sheet, artist);
    if (!rowIndex) {
      return output_({ ok: false, error: 'artist not found', artist });
    }

    if (payload.status !== undefined) {
      sheet.getRange(rowIndex, COLUMNS.status).setValue(String(payload.status || ''));
    }
    if (payload.owner !== undefined) {
      sheet.getRange(rowIndex, COLUMNS.owner).setValue(String(payload.owner || ''));
    }
    if (payload.notes !== undefined) {
      sheet.getRange(rowIndex, COLUMNS.workNotes).setValue(String(payload.notes || ''));
    }

    const updatedAt = payload.updatedAt || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    sheet.getRange(rowIndex, COLUMNS.updatedAt).setValue(updatedAt);

    return output_({ ok: true, artist, row: rowIndex, updatedAt });
  } finally {
    lock.releaseLock();
  }
}

function findArtistRow_(sheet, artist) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const names = sheet.getRange(2, COLUMNS.artist, lastRow - 1, 1).getDisplayValues();
  const target = artist.toLowerCase();
  for (let i = 0; i < names.length; i += 1) {
    if (String(names[i][0]).trim().toLowerCase() === target) {
      return i + 2;
    }
  }
  return null;
}

function parsePayload_(e) {
  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (error) {
      return {};
    }
  }
  return e.parameter || {};
}

function output_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${json});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
