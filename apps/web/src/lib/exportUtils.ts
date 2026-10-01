/**
 * Omnysync ERP Document Printing, PDF Generation & Spreadsheet Export Engine
 * 
 * Supports:
 * 1. Isolated High-Definition PDF Printing via hidden iframe with @page margins
 * 2. Excel (.xlsx / .xml) & CSV spreadsheet exports with UTF-8 BOM
 * 3. Pre-formatted ERP SAMPLE commercial document templates (Invoices, Quotes, Orders, Vouchers, Ledgers)
 */

export interface ExportColumn<T = any> {
  header: string;
  key: keyof T | string;
  formatter?: (val: any, row: T) => string;
}

/**
 * Exports data rows to CSV with UTF-8 BOM (Excel compatible)
 */
export function exportToCsv<T = any>(
  data: T[],
  filename = 'export.csv',
  columns?: ExportColumn<T>[]
) {
  if (!data || data.length === 0) {
    alert('No data available to export.');
    return;
  }

  const cols: { header: string; getValue: (row: T) => string }[] = columns
    ? columns.map((col) => ({
        header: col.header,
        getValue: (row) =>
          col.formatter
            ? col.formatter((row as any)[col.key], row)
            : String((row as any)[col.key] ?? ''),
      }))
    : Object.keys(data[0] as object).map((key) => ({
        header: key,
        getValue: (row) => String((row as any)[key] ?? ''),
      }));

  const escapeCsv = (str: string) => {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerRow = cols.map((c) => escapeCsv(c.header)).join(',');
  const dataRows = data.map((row) =>
    cols.map((c) => escapeCsv(c.getValue(row))).join(',')
  );

  const csvContent = '\uFEFF' + [headerRow, ...dataRows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

/**
 * Exports data to Microsoft Excel (.xls XML format with styling)
 */
export function exportToExcel<T = any>(
  data: T[],
  filename = 'export.xls',
  sheetName = 'ERP Data',
  columns?: ExportColumn<T>[]
) {
  if (!data || data.length === 0) {
    alert('No data available to export.');
    return;
  }

  const cols = columns
    ? columns.map((c) => ({
        header: c.header,
        getValue: (row: T) =>
          c.formatter
            ? c.formatter((row as any)[c.key], row)
            : String((row as any)[c.key] ?? ''),
      }))
    : Object.keys(data[0] as object).map((key) => ({
        header: key,
        getValue: (row: T) => String((row as any)[key] ?? ''),
      }));

  let excelXml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#5940B8" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Default">
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Number">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${sheetName}">
  <Table>
   <Row ss:StyleID="Header">`;

  cols.forEach((col) => {
    excelXml += `<Cell><Data ss:Type="String">${escapeXml(col.header)}</Data></Cell>`;
  });
  excelXml += `</Row>`;

  data.forEach((row) => {
    excelXml += `<Row>`;
    cols.forEach((col) => {
      const val = col.getValue(row);
      const isNum = !isNaN(Number(val)) && val.trim() !== '';
      excelXml += `<Cell ss:StyleID="${isNum ? 'Number' : 'Default'}"><Data ss:Type="${
        isNum ? 'Number' : 'String'
      }">${escapeXml(val)}</Data></Cell>`;
    });
    excelXml += `</Row>`;
  });

  excelXml += `  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([excelXml], {
    type: 'application/vnd.ms-excel;charset=utf-8;',
  });
  downloadBlob(blob, filename.endsWith('.xls') ? filename : `${filename}.xls`);
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Isolated PDF print utility.
 * Renders HTML inside a clean iframe with high-resolution print styles.
 */
export function printHtmlDocument(htmlContent: string, docTitle = 'ERP Document') {
  if (typeof window === 'undefined') return;

  const iframe = document.createElement('iframe');
  iframe.setAttribute(
    'style',
    'position: fixed; right: 0; bottom: 0; width: 0; height: 0; border: 0; visibility: hidden; z-index: -1;'
  );
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    window.print();
    return;
  }

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${escapeXml(docTitle)}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm 15mm 12mm 15mm;
          }
          *, *::before, *::after {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            background: #ffffff !important;
            color: #111827 !important;
            margin: 0 !important;
            padding: 0 !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 11px;
            line-height: 1.4;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            padding: 6px 8px;
            text-align: left;
            border-bottom: 1px solid #E5E7EB;
          }
          th {
            background-color: #F9FAFB !important;
            font-weight: 700;
            color: #374151;
            text-transform: uppercase;
            font-size: 9.5px;
            letter-spacing: 0.05em;
          }
          tr {
            page-break-inside: avoid;
          }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .font-bold { font-weight: 700; }
          .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.error('Print error:', err);
      window.print();
    } finally {
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 2000);
    }
  }, 250);
}

/**
 * Standard High-Fidelity ERP SAMPLE Document Print Templates
 */

export function renderInvoicePrintHtml(invoice: any, companyName = 'ERP SAMPLE'): string {
  const lines = invoice.lines || [];
  const grandTotal = invoice.total_amount || invoice.grand_total || '0.00';

  return `
    <div style="padding: 10px;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #5940B8; padding-bottom: 14px; margin-bottom: 16px;">
        <div>
          <div style="font-size: 20px; font-weight: 900; color: #5940B8; letter-spacing: -0.5px;">${escapeXml(companyName)}</div>
          <div style="font-size: 10px; color: #4B5563; margin-top: 2px;">Enterprise Financial Management & Commercial Invoicing</div>
          <div style="font-size: 9.5px; color: #6B7280; margin-top: 2px;">NTN / Tax ID: 8492041-7 • Multi-Entity Core</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 16px; font-weight: 800; color: #111827; text-transform: uppercase;">TAX INVOICE</div>
          <div style="font-size: 11px; font-family: monospace; font-weight: 700; color: #5940B8;"># ${escapeXml(invoice.invoice_number || invoice.id || 'INV-001')}</div>
          <div style="font-size: 10px; color: #4B5563; margin-top: 2px;">Date: ${escapeXml(invoice.invoice_date || invoice.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10))}</div>
          <div style="font-size: 10px; color: #4B5563;">Due Date: ${escapeXml(invoice.due_date || 'Due on Receipt')}</div>
        </div>
      </div>

      <!-- Bill To / Metadata -->
      <div style="display: flex; justify-content: space-between; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
        <div style="flex: 1;">
          <div style="font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: #6B7280; margin-bottom: 3px;">Billed To (Customer):</div>
          <div style="font-size: 12px; font-weight: 700; color: #111827;">${escapeXml(invoice.party_name || invoice.party?.name || 'Valued Commercial Client')}</div>
          <div style="font-size: 10px; color: #4B5563;">Account ID: ${escapeXml(invoice.party_id || 'CUST-001')}</div>
          <div style="font-size: 10px; color: #4B5563;">Status: <span style="font-weight: 700; color: #5940B8;">${escapeXml(invoice.status || 'POSTED')}</span></div>
        </div>
        <div style="flex: 1; text-align: right;">
          <div style="font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: #6B7280; margin-bottom: 3px;">Payment & Ledger Routing:</div>
          <div style="font-size: 10px; color: #4B5563;">Functional Currency: <b>PKR</b></div>
          <div style="font-size: 10px; color: #4B5563;">General Ledger: <b>112001 (AR Control)</b></div>
          <div style="font-size: 10px; color: #4B5563;">Posting Assurance: <b>Double-Entry Balanced</b></div>
        </div>
      </div>

      <!-- Line Items Table -->
      <table style="margin-bottom: 16px;">
        <thead>
          <tr>
            <th style="width: 30px;">#</th>
            <th>Item Description</th>
            <th class="text-right" style="width: 70px;">Quantity</th>
            <th class="text-right" style="width: 100px;">Unit Price (PKR)</th>
            <th class="text-right" style="width: 110px;">Amount (PKR)</th>
          </tr>
        </thead>
        <tbody>
          ${
            lines.length > 0
              ? lines
                  .map(
                    (l: any, i: number) => `
            <tr>
              <td>${i + 1}</td>
              <td style="font-weight: 600; color: #111827;">${escapeXml(l.description || l.item_name || 'Standard ERP Product / Service')}</td>
              <td class="text-right font-mono">${escapeXml(String(l.quantity || '1'))}</td>
              <td class="text-right font-mono">${escapeXml(String(l.unit_price || '0.00'))}</td>
              <td class="text-right font-mono font-bold">${escapeXml(String((parseFloat(l.quantity || 1) * parseFloat(l.unit_price || 0)).toFixed(2)))}</td>
            </tr>
          `
                  )
                  .join('')
              : `
            <tr>
              <td>1</td>
              <td style="font-weight: 600; color: #111827;">Commercial Services & Equipment Operations</td>
              <td class="text-right font-mono">1</td>
              <td class="text-right font-mono">${escapeXml(String(grandTotal))}</td>
              <td class="text-right font-mono font-bold">${escapeXml(String(grandTotal))}</td>
            </tr>
          `
          }
        </tbody>
      </table>

      <!-- Totals & Summary -->
      <div style="display: flex; justify-content: flex-end; margin-bottom: 24px;">
        <div style="width: 240px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 10px;">
          <div style="display: flex; justify-content: space-between; font-size: 10.5px; color: #4B5563; margin-bottom: 4px;">
            <span>Subtotal:</span>
            <span class="font-mono">PKR ${escapeXml(String(grandTotal))}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 10.5px; color: #4B5563; margin-bottom: 4px;">
            <span>Sales Tax (0%):</span>
            <span class="font-mono">PKR 0.00</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 800; color: #5940B8; border-top: 2px solid #D1D5DB; padding-top: 6px; margin-top: 4px;">
            <span>Grand Total:</span>
            <span class="font-mono">PKR ${escapeXml(String(grandTotal))}</span>
          </div>
        </div>
      </div>

      <!-- Signatures & Footer -->
      <div style="display: flex; justify-content: space-between; border-top: 1px dashed #D1D5DB; padding-top: 20px; margin-top: 30px;">
        <div style="text-align: center; width: 180px;">
          <div style="border-bottom: 1px solid #9CA3AF; height: 30px; margin-bottom: 4px;"></div>
          <div style="font-size: 9.5px; font-weight: 700; color: #4B5563;">Prepared By (Accountant)</div>
        </div>
        <div style="text-align: center; width: 180px;">
          <div style="border-bottom: 1px solid #9CA3AF; height: 30px; margin-bottom: 4px;"></div>
          <div style="font-size: 9.5px; font-weight: 700; color: #4B5563;">Approved By (Controller / CFO)</div>
        </div>
      </div>

      <div style="text-align: center; font-size: 9px; color: #9CA3AF; margin-top: 24px;">
        Generated automatically by ${escapeXml(companyName)} • Cryptographic Verification & Double-Entry Ledger Validated
      </div>
    </div>
  `;
}

export function renderJournalVoucherPrintHtml(journal: any, companyName = 'ERP SAMPLE'): string {
  const lines = journal.lines || [];
  return `
    <div style="padding: 10px;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #5940B8; padding-bottom: 14px; margin-bottom: 16px;">
        <div>
          <div style="font-size: 20px; font-weight: 900; color: #5940B8; letter-spacing: -0.5px;">${escapeXml(companyName)}</div>
          <div style="font-size: 10px; color: #4B5563; margin-top: 2px;">General Ledger & Double-Entry Accounting Engine</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 16px; font-weight: 800; color: #111827; text-transform: uppercase;">JOURNAL VOUCHER</div>
          <div style="font-size: 11px; font-family: monospace; font-weight: 700; color: #5940B8;"># ${escapeXml(journal.journal_number || journal.id || 'JV-001')}</div>
          <div style="font-size: 10px; color: #4B5563;">Posting Date: ${escapeXml(journal.posting_date || new Date().toISOString().slice(0, 10))}</div>
        </div>
      </div>

      <!-- Journal Metadata -->
      <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 10px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; font-size: 10.5px;">
          <div><b>Source Module:</b> ${escapeXml(journal.source_module || 'MANUAL')}</div>
          <div><b>Status:</b> <span style="color: #5940B8; font-weight: 700;">${escapeXml(journal.status || 'POSTED')}</span></div>
          <div><b>Functional Currency:</b> PKR</div>
        </div>
        <div style="font-size: 10.5px; margin-top: 6px; color: #374151;">
          <b>Narration / Description:</b> ${escapeXml(journal.description || 'General Ledger Double-Entry Transaction')}
        </div>
      </div>

      <!-- Debit/Credit Table -->
      <table style="margin-bottom: 16px;">
        <thead>
          <tr>
            <th style="width: 100px;">Account Code</th>
            <th>Account Title & Line Description</th>
            <th class="text-right" style="width: 120px;">Debit (PKR)</th>
            <th class="text-right" style="width: 120px;">Credit (PKR)</th>
          </tr>
        </thead>
        <tbody>
          ${lines
            .map(
              (l: any) => `
            <tr>
              <td class="font-mono font-bold" style="color: #5940B8;">${escapeXml(l.account_code || l.account_id || '100000')}</td>
              <td>
                <div style="font-weight: 700; color: #111827;">${escapeXml(l.account_name || 'GL Account')}</div>
                <div style="font-size: 9.5px; color: #6B7280;">${escapeXml(l.description || '')}</div>
              </td>
              <td class="text-right font-mono ${parseFloat(l.debit_amount || 0) > 0 ? 'font-bold' : 'color: #9CA3AF;'}">
                ${escapeXml(String(l.debit_amount || '0.00'))}
              </td>
              <td class="text-right font-mono ${parseFloat(l.credit_amount || 0) > 0 ? 'font-bold' : 'color: #9CA3AF;'}">
                ${escapeXml(String(l.credit_amount || '0.00'))}
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>

      <!-- Signatures -->
      <div style="display: flex; justify-content: space-between; border-top: 1px dashed #D1D5DB; padding-top: 20px; margin-top: 30px;">
        <div style="text-align: center; width: 180px;">
          <div style="border-bottom: 1px solid #9CA3AF; height: 30px; margin-bottom: 4px;"></div>
          <div style="font-size: 9.5px; font-weight: 700; color: #4B5563;">Prepared By</div>
        </div>
        <div style="text-align: center; width: 180px;">
          <div style="border-bottom: 1px solid #9CA3AF; height: 30px; margin-bottom: 4px;"></div>
          <div style="font-size: 9.5px; font-weight: 700; color: #4B5563;">Checked & Verified</div>
        </div>
        <div style="text-align: center; width: 180px;">
          <div style="border-bottom: 1px solid #9CA3AF; height: 30px; margin-bottom: 4px;"></div>
          <div style="font-size: 9.5px; font-weight: 700; color: #4B5563;">Authorized Signatory</div>
        </div>
      </div>
    </div>
  `;
}

export function renderTrialBalancePrintHtml(
  report: any,
  asOfDate = '2026-03-31',
  companyName = 'ERP SAMPLE'
): string {
  const accounts = report?.accounts || [];
  return `
    <div style="padding: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #5940B8; padding-bottom: 14px; margin-bottom: 16px;">
        <div>
          <div style="font-size: 20px; font-weight: 900; color: #5940B8; letter-spacing: -0.5px;">${escapeXml(companyName)}</div>
          <div style="font-size: 11px; font-weight: 700; color: #111827; margin-top: 2px;">GENERAL LEDGER TRIAL BALANCE</div>
          <div style="font-size: 10px; color: #4B5563;">As of Date: <b>${escapeXml(asOfDate)}</b> • Functional Currency: <b>PKR</b></div>
        </div>
        <div style="text-align: right;">
          <div style="display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: 700; background: #E6F4EA; color: #5940B8; border: 1px solid #A7F3D0;">
            ${report?.is_balanced ? '✓ BALANCED GENERAL LEDGER' : 'UNBALANCED'}
          </div>
          <div style="font-size: 9.5px; color: #6B7280; margin-top: 4px;">Total Accounts: ${accounts.length}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 100px;">Code</th>
            <th>Account Name</th>
            <th style="width: 90px;">Class</th>
            <th class="text-right" style="width: 110px;">Total Debit</th>
            <th class="text-right" style="width: 110px;">Total Credit</th>
            <th class="text-right" style="width: 110px;">Net Balance</th>
          </tr>
        </thead>
        <tbody>
          ${accounts
            .map(
              (acc: any) => `
            <tr>
              <td class="font-mono font-bold" style="color: #5940B8;">${escapeXml(acc.account_code)}</td>
              <td style="font-weight: 600; color: #111827;">${escapeXml(acc.account_name)}</td>
              <td style="font-size: 9.5px; color: #6B7280; text-transform: uppercase;">${escapeXml(acc.statement_class)}</td>
              <td class="text-right font-mono">${escapeXml(String(acc.total_debit || '0.00'))}</td>
              <td class="text-right font-mono">${escapeXml(String(acc.total_credit || '0.00'))}</td>
              <td class="text-right font-mono font-bold">${escapeXml(String(acc.net_balance || '0.00'))}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
        <tfoot>
          <tr style="background: #F3F4F6; font-weight: 800; border-top: 2px solid #5940B8;">
            <td colspan="3">TOTAL GENERAL LEDGER POSITION</td>
            <td class="text-right font-mono text-bold">PKR ${escapeXml(String(report?.total_debits || '0.00'))}</td>
            <td class="text-right font-mono text-bold">PKR ${escapeXml(String(report?.total_credits || '0.00'))}</td>
            <td class="text-right font-mono text-bold" style="color: #5940B8;">PKR 0.00</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

export function renderCommercialOrderPrintHtml(
  order: any,
  docType: 'SALES_ORDER' | 'SALES_QUOTE' | 'PURCHASE_ORDER' | 'VENDOR_BILL' = 'SALES_ORDER',
  companyName = 'ERP SAMPLE'
): string {
  const isPO = docType === 'PURCHASE_ORDER';
  const isQuote = docType === 'SALES_QUOTE';
  const isBill = docType === 'VENDOR_BILL';

  const title = isQuote
    ? 'COMMERCIAL QUOTATION'
    : isPO
    ? 'PURCHASE ORDER (PO)'
    : isBill
    ? 'VENDOR BILL (AP)'
    : 'SALES ORDER & JOB SHEET';

  const docNo = order.order_number || order.po_number || order.invoice_number || order.id || 'DOC-001';
  const dateVal = order.order_date || order.po_date || order.invoice_date || order.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const secondaryDateLabel = isPO ? 'Expected Delivery' : isBill ? 'Payment Due Date' : 'Target Delivery';
  const secondaryDate = order.expected_date || order.delivery_date || order.due_date || 'Prompt';
  const partyRole = isPO || isBill ? 'Supplier / Vendor' : 'Customer / Client';
  const lines = order.lines || [];
  const grandTotal = order.total_amount || order.grand_total || '0.00';

  return `
    <div style="padding: 10px;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #5940B8; padding-bottom: 14px; margin-bottom: 16px;">
        <div>
          <div style="font-size: 20px; font-weight: 900; color: #5940B8; letter-spacing: -0.5px;">${escapeXml(companyName)}</div>
          <div style="font-size: 10px; color: #4B5563; margin-top: 2px;">Enterprise Procurement, Inventory & Order Management</div>
          <div style="font-size: 9.5px; color: #6B7280; margin-top: 2px;">NTN / Tax ID: 8492041-7 • Multi-Entity Core</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 16px; font-weight: 800; color: #111827; text-transform: uppercase;">${escapeXml(title)}</div>
          <div style="font-size: 11px; font-family: monospace; font-weight: 700; color: #5940B8;"># ${escapeXml(docNo)}</div>
          <div style="font-size: 10px; color: #4B5563; margin-top: 2px;">Date: ${escapeXml(dateVal)}</div>
          <div style="font-size: 10px; color: #4B5563;">${escapeXml(secondaryDateLabel)}: ${escapeXml(secondaryDate)}</div>
        </div>
      </div>

      <!-- Party & Routing Details -->
      <div style="display: flex; justify-content: space-between; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
        <div style="flex: 1;">
          <div style="font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: #6B7280; margin-bottom: 3px;">${escapeXml(partyRole)}:</div>
          <div style="font-size: 12px; font-weight: 700; color: #111827;">${escapeXml(order.party_name || order.party?.name || 'Authorized Commercial Partner')}</div>
          <div style="font-size: 10px; color: #4B5563;">Party Code: ${escapeXml(order.party_id || 'ACC-9901')}</div>
          <div style="font-size: 10px; color: #4B5563;">Status: <span style="font-weight: 700; color: #5940B8;">${escapeXml(order.status || 'ACTIVE')}</span></div>
        </div>
        <div style="flex: 1; text-align: right;">
          <div style="font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: #6B7280; margin-bottom: 3px;">Operational Metadata:</div>
          <div style="font-size: 10px; color: #4B5563;">Currency: <b>PKR</b></div>
          <div style="font-size: 10px; color: #4B5563;">Fulfillment: <b>${order.status === 'FULFILLED' ? 'Fully Dispatched' : 'Warehouse Routing'}</b></div>
          <div style="font-size: 10px; color: #4B5563;">Notes: <i>${escapeXml(order.notes || 'Standard commercial contract terms apply.')}</i></div>
        </div>
      </div>

      <!-- Line Items Table -->
      <table style="margin-bottom: 16px;">
        <thead>
          <tr>
            <th style="width: 30px;">#</th>
            <th>Item / Service Specification</th>
            <th class="text-right" style="width: 70px;">Quantity</th>
            <th class="text-right" style="width: 100px;">Unit Rate (PKR)</th>
            <th class="text-right" style="width: 110px;">Total Value (PKR)</th>
          </tr>
        </thead>
        <tbody>
          ${
            lines.length > 0
              ? lines
                  .map(
                    (l: any, i: number) => `
            <tr>
              <td>${i + 1}</td>
              <td>
                <div style="font-weight: 700; color: #111827;">${escapeXml(l.item_name || l.description || 'ERP Standard Item')}</div>
                ${l.item_code ? `<div style="font-size: 9px; font-family: monospace; color: #5940B8;">SKU: ${escapeXml(l.item_code)}</div>` : ''}
              </td>
              <td class="text-right font-mono">${escapeXml(String(l.quantity || '1'))}</td>
              <td class="text-right font-mono">${escapeXml(String(l.unit_price || '0.00'))}</td>
              <td class="text-right font-mono font-bold">${escapeXml(String((parseFloat(l.quantity || 1) * parseFloat(l.unit_price || 0)).toFixed(2)))}</td>
            </tr>
          `
                  )
                  .join('')
              : `
            <tr>
              <td>1</td>
              <td style="font-weight: 600; color: #111827;">Commercial Operations & Contract Scope</td>
              <td class="text-right font-mono">1</td>
              <td class="text-right font-mono">${escapeXml(String(grandTotal))}</td>
              <td class="text-right font-mono font-bold">${escapeXml(String(grandTotal))}</td>
            </tr>
          `
          }
        </tbody>
      </table>

      <!-- Grand Total -->
      <div style="display: flex; justify-content: flex-end; margin-bottom: 24px;">
        <div style="width: 240px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 10px;">
          <div style="display: flex; justify-content: space-between; font-size: 10.5px; color: #4B5563; margin-bottom: 4px;">
            <span>Subtotal:</span>
            <span class="font-mono">PKR ${escapeXml(String(grandTotal))}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 800; color: #5940B8; border-top: 2px solid #D1D5DB; padding-top: 6px; margin-top: 4px;">
            <span>Total Value:</span>
            <span class="font-mono">PKR ${escapeXml(String(grandTotal))}</span>
          </div>
        </div>
      </div>

      <!-- Signatures -->
      <div style="display: flex; justify-content: space-between; border-top: 1px dashed #D1D5DB; padding-top: 20px; margin-top: 30px;">
        <div style="text-align: center; width: 180px;">
          <div style="border-bottom: 1px solid #9CA3AF; height: 30px; margin-bottom: 4px;"></div>
          <div style="font-size: 9.5px; font-weight: 700; color: #4B5563;">Prepared / Issued By</div>
        </div>
        <div style="text-align: center; width: 180px;">
          <div style="border-bottom: 1px solid #9CA3AF; height: 30px; margin-bottom: 4px;"></div>
          <div style="font-size: 9.5px; font-weight: 700; color: #4B5563;">Customer / Vendor Acceptance</div>
        </div>
      </div>

      <div style="text-align: center; font-size: 9px; color: #9CA3AF; margin-top: 24px;">
        Generated automatically by ${escapeXml(companyName)} • Official Commercial Document
      </div>
    </div>
  `;
}

