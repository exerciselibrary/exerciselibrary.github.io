import { KG_PER_LB, LB_PER_KG } from './constants.js';
import { convertKgToUnit, convertUnitToKg } from '../shared/weight-utils.js';
import { normalizeMuscleName } from './muscles.js';

// --- generic helpers -------------------------------------------------------

export const uniq = (arr) => Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));

export const niceName = (str) => String(str)
  .toLowerCase()
  .replace(/_/g, ' ')
  .split(' ')
  .filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ');

export const intersects = (a, b) => {
  for (const v of a) if (b.has(v)) return true;
  return false;
};

export const isSuperset = (set, subset) => {
  for (const v of subset) if (!set.has(v)) return false;
  return true;
};

export const tokenizeSearch = (text) => String(text || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .split(' ')
  .filter(Boolean);

export const collectTokens = (values) => {
  const tokens = [];
  for (const value of values || []) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      tokens.push(...collectTokens(value));
    } else {
      tokens.push(...tokenizeSearch(value));
    }
  }
  return tokens;
};

export const levenshteinDistance = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return Math.abs(a.length - b.length);
  const prev = [];
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = prev[j] + 1;
      const insertion = prev[j - 1] + 1;
      const substitution = prevDiag + cost;
      prev[j] = Math.min(deletion, insertion, substitution);
      prevDiag = temp;
    }
  }
  return prev[b.length];
};

export const shuffleArray = (source) => {
  const arr = Array.from(source);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export const formatListLabel = (values, fallback) => {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return fallback;
  const names = list.map((item) => niceName(item)).filter(Boolean);
  return names.length ? names.join(', ') : fallback;
};

export const buildEquipmentKey = (exercise) => {
  const equipment = Array.isArray(exercise?.equipment) ? exercise.equipment : [];
  if (!equipment.length) return '__none__';
  const normalized = equipment
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
  return normalized.length ? normalized.join('|') : '__none__';
};

export const buildAttributeKey = (values, normalizer = normalizeMuscleName) => {
  const list = Array.isArray(values) ? values : [];
  const normalized = list
    .map((item) => normalizer(item))
    .filter(Boolean)
    .sort();
  return normalized.length ? normalized.join('|') : '__none__';
};

// --- spreadsheet export helpers -------------------------------------------

const ZIP_ENCODER = new TextEncoder();

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const stringToUint8 = (input) => {
  if (input instanceof Uint8Array) return input;
  return ZIP_ENCODER.encode(String(input));
};

const concatUint8 = (arrays) => {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((arr) => {
    result.set(arr, offset);
    offset += arr.length;
  });
  return result;
};

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createZip = (files) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = ZIP_ENCODER.encode(file.name);
    const content = stringToUint8(file.data);
    const crc = crc32(content);
    const size = content.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, content);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += localHeader.length + size;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const centralOffset = offset;
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralOffset, true);
  eocdView.setUint16(20, 0, true);

  return concatUint8([...localParts, ...centralParts, eocd]);
};

const columnName = (index) => {
  let name = '';
  let current = index;
  while (current >= 0) {
    name = String.fromCharCode((current % 26) + 65) + name;
    current = Math.floor(current / 26) - 1;
  }
  return name;
};

const escapeXml = (value) => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r\n|\r|\n/g, '&#10;');
};

export const createWorksheetXml = (rows) => {
  const body = rows
    .map((row, rowIdx) => {
      const cells = row
        .map((cell, colIdx) => {
          const value = cell === null || cell === undefined ? '' : String(cell);
          if (!value) return '';
          const ref = `${columnName(colIdx)}${rowIdx + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .filter(Boolean)
        .join('');
      return `<row r="${rowIdx + 1}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${body}</sheetData>
</worksheet>`;
};

export const createWorkbookXlsx = (rows) => {
  const normalized = rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
  const worksheetXml = createWorksheetXml(normalized);
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  const relsRoot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Workout" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  return createZip([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: relsRoot },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/worksheets/sheet1.xml', data: worksheetXml }
  ]);
};

// --- weight helpers --------------------------------------------------------

const roundToStep = (value, step) => {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) / step) * step;
};

export const formatWeight = (value, unit) => {
  if (value === '' || value === null || value === undefined) return '';
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(num)) return '';
  const step = unit === 'KG' ? 0.1 : 0.5;
  const rounded = roundToStep(num, step);
  const decimals = step >= 1 ? 0 : (step.toString().split('.')[1]?.length || 0);
  const formatted = rounded.toFixed(decimals);
  return decimals === 0 ? formatted : formatted.replace(/\.0$/, '');
};

export const convertWeightValue = (value, from, to) => {
  if (!value && value !== 0) return '';
  const normalizedFrom = from === 'LBS' ? 'lb' : 'kg';
  const normalizedTo = to === 'LBS' ? 'lb' : 'kg';
  const kgValue = convertUnitToKg(value, normalizedFrom);
  if (Number.isNaN(kgValue)) return '';
  const converted = convertKgToUnit(kgValue, normalizedTo);
  if (!Number.isFinite(converted)) return '';
  return formatWeight(converted, to);
};
