// Génération de classeurs .xlsx dans le navigateur.
// La bibliothèque est chargée seulement au moment d'un export (aucun poids ajouté au chargement du site).
import { getLang } from '../i18n';

const GREEN = 'FF1E7145';
const HEAD_TXT = 'FFFFFFFF';
const GRID = 'FFD9DCD9';

/**
 * Types de colonnes :
 *  pct   : valeur exprimée en % (12,3) -> stockée 0,123 au format pourcentage
 *  num / num4 : nombre à 2 ou 4 décimales ; int : entier ; money : montant
 *  date  : « AAAA-MM-JJ » -> vraie date ; text (défaut)
 */
const FORMATS = { pct: '0.00%', num: '0.00', num4: '0.0000', int: '#,##0', money: '#,##0.00', date: 'dd/mm/yyyy' };

function cellValue(v, type) {
  if (v === null || v === undefined || v === '') return null;
  if (type === 'pct') return typeof v === 'number' ? v / 100 : null;
  if (type === 'date') {
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(`${s.slice(0, 10)}T00:00:00Z`) : s;
  }
  if (['num', 'num4', 'int', 'money'].includes(type)) return typeof v === 'number' && Number.isFinite(v) ? v : null;
  return v;
}

const safeSheetName = (n) => String(n).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Feuille';

/**
 * sheets : [{ name, title?, subtitle?, columns: [{ header, key, type, width }], rows: [{...}] }]
 * ou { name, title?, pairs: [[libellé, valeur, type?]] } pour une feuille « clé / valeur ».
 */
export async function downloadWorkbook(fileName, sheets) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'The Yield Is Yours';
  wb.created = new Date();

  for (const sh of sheets) {
    const ws = wb.addWorksheet(safeSheetName(sh.name), { properties: { tabColor: { argb: GREEN } } });
    let r = 1;
    if (sh.title) {
      ws.getCell(r, 1).value = sh.title;
      ws.getCell(r, 1).font = { bold: true, size: 14, color: { argb: GREEN } };
      r += 1;
      if (sh.subtitle) {
        ws.getCell(r, 1).value = sh.subtitle;
        ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF69716C' } };
        r += 1;
      }
      r += 1;
    }

    const columns = sh.pairs
      ? [{ header: getLang() === 'en' ? 'Item' : 'Élément', key: 'k', width: 34 }, { header: getLang() === 'en' ? 'Value' : 'Valeur', key: 'v', width: 28 }]
      : sh.columns;
    const rows = sh.pairs ? sh.pairs.map(([k, v, type]) => ({ k, v, _type: type })) : sh.rows;

    // En-tête de colonnes
    const headRow = r;
    columns.forEach((c, i) => {
      const cell = ws.getCell(headRow, i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: HEAD_TXT } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: GRID } } };
      ws.getColumn(i + 1).width = c.width || Math.min(40, Math.max(10, String(c.header).length + 4));
    });
    ws.getRow(headRow).height = 20;

    // Données
    rows.forEach((row, ri) => {
      const sheetRow = headRow + 1 + ri;
      columns.forEach((c, ci) => {
        const type = row._type && c.key === 'v' ? row._type : c.type;
        const cell = ws.getCell(sheetRow, ci + 1);
        cell.value = cellValue(row[c.key], type);
        if (FORMATS[type]) cell.numFmt = FORMATS[type];
        if (c.wrap) cell.alignment = { wrapText: true, vertical: 'top' };
        cell.border = { bottom: { style: 'hair', color: { argb: GRID } } };
        if (c.color) {
          const argb = c.color(row[c.key], row);
          if (argb) cell.font = { color: { argb } };
        }
      });
    });

    ws.views = [{ state: 'frozen', ySplit: headRow }];
    if (!sh.pairs && rows.length) {
      ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow + rows.length, column: columns.length } };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `${fileName.replace(/[\\/:*?"<>|]/g, '-')} ${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Couleurs de police pour les valeurs signées (hausse / baisse)
export const signArgb = (v) => (typeof v === 'number' ? (v >= 0 ? 'FF107C41' : 'FFC42B1C') : null);
