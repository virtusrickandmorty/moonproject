export interface ParsedRow {
  rowType: 'customer' | 'measurement' | 'employee' | 'piece_rate' | 'unknown';
  raw: Record<string, string>;
  issues: string[];
  status: 'valid' | 'needs_review';
  legacyId: string | null;
}

/**
 * Basic CSV parser supporting quotes and tracking line numbers.
 */
export function parseCSV(csvText: string): { objects: Record<string, string>[], lineNumbers: number[] } {
  const rows: string[][] = [];
  const lineNumbers: number[] = [];

  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  let currentLineNumber = 1;
  let rowStartLine = 1;

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
        if (char === '\n') currentLineNumber++;
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
        lineNumbers.push(rowStartLine);

        currentRow = [];
        currentCell = '';
        if (char === '\r') i++; // skip \n
        currentLineNumber++;
        rowStartLine = currentLineNumber;
      } else {
        currentCell += char;
      }
    }
  }

  // push last row if not empty
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
    lineNumbers.push(rowStartLine);
  }

  if (rows.length === 0) return { objects: [], lineNumbers: [] };

  const headers = rows[0]!.map((h) => h.trim());
  const objects: Record<string, string>[] = [];
  const outLineNumbers: number[] = [];

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
    outLineNumbers.push(lineNumbers[i]!);
  }

  return { objects, lineNumbers: outLineNumbers };
}

export function validateRow(rawRow: Record<string, string>, seenIdentifiers: Set<string>): ParsedRow {
  let rowType: ParsedRow['rowType'] = 'unknown';
  const issues: string[] = [];
  let legacyId: string | null = null;

  const keys = Object.keys(rawRow);
  if (keys.includes('Measurement_ID') || keys.includes('Shoulder') || keys.includes('Chest')) {
    rowType = 'measurement';
    legacyId = rawRow['Measurement_ID'] || null;
  } else if (keys.includes('Employee_ID') || keys.includes('Daily_Rate') || keys.includes('Pay_Type')) {
    rowType = 'employee';
    legacyId = rawRow['Employee_ID'] || null;
  } else if (keys.includes('Customer_Name') || keys.includes('TIN') || keys.includes('Email')) {
    rowType = 'customer';
    // Let's assume customer might use email or name as a legacy id if explicitly given
    legacyId = rawRow['Legacy_ID'] || rawRow['Customer_ID'] || null;
  } else if (keys.includes('Garment_Type') && keys.includes('Operation') && keys.includes('Rate')) {
    rowType = 'piece_rate';
  }

  if (rowType === 'unknown') {
    issues.push('Could not determine row type from columns.');
  }

  if (rowType === 'customer') {
    if (!rawRow['Customer_Name'] && !rawRow['Registered_Name']) {
      issues.push('Customer is missing a name.');
    }
    const dupKey = `cust:${rawRow['Customer_Name']}:${rawRow['TIN']}`;
    if (seenIdentifiers.has(dupKey)) {
      issues.push('Possible duplicate customer name and TIN combination.');
    } else if (rawRow['Customer_Name']) {
      seenIdentifiers.add(dupKey);
    }
    if (legacyId) {
      const legacyKey = `cust_leg:${legacyId}`;
      if (seenIdentifiers.has(legacyKey)) issues.push('Duplicate legacy ID for customer.');
      else seenIdentifiers.add(legacyKey);
    }
  }

  if (rowType === 'measurement') {
    if (!rawRow['Measurement_ID']) {
      issues.push('Measurement missing ID.');
    } else {
       const legacyKey = `meas_leg:${rawRow['Measurement_ID']}`;
       if (seenIdentifiers.has(legacyKey)) issues.push('Duplicate Measurement_ID.');
       else seenIdentifiers.add(legacyKey);
    }
    if (rawRow['Source'] === 'MANUAL' || rawRow['Customer_Name'] === 'MANUAL' || (!rawRow['Customer_Name'] && !rawRow['Group_Name'])) {
      issues.push('Manual measurement row needs to be assigned to a customer or group.');
    }
    if (rawRow['Shoulder'] && isNaN(Number(rawRow['Shoulder']))) {
      issues.push('Shoulder measurement must be a number.');
    }
  }

  if (rowType === 'employee') {
    if (!rawRow['Employee_Name']) {
      issues.push('Employee is missing a name.');
    }
    if (legacyId) {
       const legacyKey = `emp_leg:${legacyId}`;
       if (seenIdentifiers.has(legacyKey)) issues.push('Duplicate Employee_ID.');
       else seenIdentifiers.add(legacyKey);
    }
    if (rawRow['Daily_Rate']) {
      const rateStr = rawRow['Daily_Rate'];
      const num = Number(rateStr);
      if (isNaN(num)) {
         issues.push('Daily rate must be a number.');
      } else {
         const cents = Math.round(num * 100);
         if (Math.abs(cents - (num * 100)) > 0.0001) {
           issues.push('Daily rate must be exact to the centavo.');
         } else {
           rawRow['daily_rate_cents'] = cents.toString();
           issues.push('Employee daily rate requires confirmation.');
         }
      }
    }
  }

  if (rowType === 'piece_rate') {
     issues.push('Piece rate seed requires confirmation.');
  }

  return {
    rowType,
    raw: rawRow,
    issues,
    status: issues.length > 0 ? 'needs_review' : 'valid',
    legacyId,
  };
}
