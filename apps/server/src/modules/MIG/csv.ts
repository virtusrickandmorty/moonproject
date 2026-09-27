export interface ParsedRow {
  rowType: 'customer' | 'measurement' | 'employee' | 'unknown';
  raw: Record<string, string>;
  issues: string[];
  status: 'valid' | 'needs_review';
}

/**
 * Basic CSV parser supporting quotes.
 */
export function parseCSV(csvText: string): Record<string, string>[] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentCell);
        currentCell = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        if (char === '\r') i++; // skip \n
      } else {
        currentCell += char;
      }
    }
  }

  // push last row if not empty
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  if (rows.length === 0) return [];

  const headers = rows[0]!.map((h) => h.trim());
  const objects: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    // Skip completely empty rows
    if (row.length === 0 || (row.length === 1 && !row[0]?.trim())) continue;

    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j]!;
      if (header) { // Ignore empty headers
        obj[header] = row[j]?.trim() ?? '';
      }
    }
    objects.push(obj);
  }

  return objects;
}

export function validateRow(rawRow: Record<string, string>): ParsedRow {
  let rowType: ParsedRow['rowType'] = 'unknown';
  const issues: string[] = [];

  // Very basic heuristic based on column presence
  const keys = Object.keys(rawRow);
  if (keys.includes('Measurement_ID') || keys.includes('Shoulder') || keys.includes('Chest')) {
    rowType = 'measurement';
  } else if (keys.includes('Employee_ID') || keys.includes('Daily_Rate') || keys.includes('Pay_Type')) {
    rowType = 'employee';
  } else if (keys.includes('Customer_Name') || keys.includes('TIN') || keys.includes('Email')) {
    rowType = 'customer';
  }

  if (rowType === 'unknown') {
    issues.push('Could not determine row type from columns.');
  }

  if (rowType === 'customer') {
    if (!rawRow['Customer_Name'] && !rawRow['Registered_Name']) {
      issues.push('Customer is missing a name.');
    }
    if (rawRow['Customer_Name'] === rawRow['Registered_Name']) {
       // just example of possible review flag
    }
  }

  if (rowType === 'measurement') {
    if (!rawRow['Measurement_ID']) {
      issues.push('Measurement missing ID.');
    }
    if (rawRow['Source'] === 'MANUAL' || rawRow['Customer_Name'] === 'MANUAL' || (!rawRow['Customer_Name'] && !rawRow['Group_Name'])) {
      issues.push('Manual measurement row needs to be assigned to a customer or group.');
    }
    // simple number validation
    if (rawRow['Shoulder'] && isNaN(Number(rawRow['Shoulder']))) {
      issues.push('Shoulder measurement must be a number.');
    }
  }

  if (rowType === 'employee') {
    if (!rawRow['Employee_Name']) {
      issues.push('Employee is missing a name.');
    }
    if (rawRow['Daily_Rate']) {
      const rate = Number(rawRow['Daily_Rate']);
      if (isNaN(rate)) {
         issues.push('Daily rate must be a number.');
      } else if (rate < 550 && rate > 0) { // Silang minimum wage
         issues.push('Employee daily rate is below the minimum wage (550). Requires confirmation.');
      }
    }
  }

  return {
    rowType,
    raw: rawRow,
    issues,
    status: issues.length > 0 ? 'needs_review' : 'valid',
  };
}
