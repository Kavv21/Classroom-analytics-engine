import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { metadataLines, type ExportMetadata } from "@/lib/exports/metadata";

/**
 * PDF dashboard report. Generated server-side with pdf-lib (pure JS, no
 * native dependency, no headless browser), so the report is real
 * selectable text rather than a screenshot of a canvas.
 *
 * Layout: a cover block carrying the full provenance metadata, then one
 * section per included table. Charts are embedded as PNGs when the client
 * supplies them (ECharts renders them; the server only places them).
 */

const PAGE_WIDTH = 595.28; // A4 portrait
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const INK = rgb(0.043, 0.043, 0.043);
const MUTED = rgb(0.537, 0.529, 0.506);
const RULE = rgb(0.882, 0.878, 0.851);

export interface PdfTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  /** Optional PNG (data URL or raw bytes) rendered above the table. */
  chartPng?: Uint8Array;
}

interface Cursor {
  page: PDFPage;
  y: number;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // A single word longer than the line still has to be broken.
      let remainder = word;
      while (font.widthOfTextAtSize(remainder, size) > maxWidth && remainder.length > 1) {
        let cut = remainder.length;
        while (cut > 1 && font.widthOfTextAtSize(remainder.slice(0, cut), size) > maxWidth) cut--;
        lines.push(remainder.slice(0, cut));
        remainder = remainder.slice(cut);
      }
      current = remainder;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

export async function buildDashboardPdf(options: {
  metadata: ExportMetadata;
  title: string;
  tables: PdfTable[];
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  pdf.setTitle(options.title);
  pdf.setSubject(`${options.metadata.className} — analytics report`);
  pdf.setProducer("Classroom Opinion Analytics Platform");
  pdf.setCreationDate(new Date(options.metadata.generatedAt));

  const cursor: Cursor = { page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: PAGE_HEIGHT - MARGIN };

  const newPage = () => {
    cursor.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursor.y = PAGE_HEIGHT - MARGIN;
  };

  const need = (height: number) => {
    if (cursor.y - height < MARGIN) newPage();
  };

  const write = (
    text: string,
    { size = 9, font = regular, color = INK, gap = 3 }: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}
  ) => {
    for (const line of wrap(text, font, size, contentWidth)) {
      need(size + gap);
      cursor.page.drawText(line, { x: MARGIN, y: cursor.y - size, size, font, color });
      cursor.y -= size + gap;
    }
  };

  const rule = () => {
    need(10);
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y - 4 },
      end: { x: PAGE_WIDTH - MARGIN, y: cursor.y - 4 },
      thickness: 0.5,
      color: RULE,
    });
    cursor.y -= 12;
  };

  // ---- cover / provenance ---------------------------------------------
  write(options.title, { size: 18, font: bold, gap: 8 });
  write(options.metadata.className, { size: 11, color: MUTED, gap: 10 });
  rule();

  for (const [key, value] of metadataLines(options.metadata)) {
    write(key, { size: 8, font: bold, gap: 1 });
    write(value, { size: 8, color: MUTED, gap: 6 });
  }
  rule();

  // ---- tables ----------------------------------------------------------
  for (const table of options.tables) {
    need(40);
    write(table.title, { size: 12, font: bold, gap: 6 });

    if (table.chartPng && table.chartPng.length > 0) {
      try {
        const image = await pdf.embedPng(table.chartPng);
        const scale = Math.min(contentWidth / image.width, 1);
        const width = image.width * scale;
        const height = image.height * scale;
        need(height + 10);
        cursor.page.drawImage(image, { x: MARGIN, y: cursor.y - height, width, height });
        cursor.y -= height + 12;
      } catch (err) {
        // A bad image must not lose the whole report — say so in place.
        write(
          `[chart image could not be embedded: ${err instanceof Error ? err.message : String(err)}]`,
          { size: 8, color: MUTED, gap: 6 }
        );
      }
    }

    const columnWidth = contentWidth / Math.max(table.columns.length, 1);
    const size = 7.5;

    const drawRow = (values: Array<string | number | null>, font: PDFFont) => {
      need(size + 6);
      values.forEach((value, i) => {
        const text = value === null || value === undefined ? "—" : String(value);
        cursor.page.drawText(truncate(text, font, size, columnWidth - 6), {
          x: MARGIN + i * columnWidth,
          y: cursor.y - size,
          size,
          font,
          color: font === bold ? INK : MUTED,
        });
      });
      cursor.y -= size + 6;
    };

    drawRow(table.columns, bold);
    need(6);
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y + 2 },
      end: { x: PAGE_WIDTH - MARGIN, y: cursor.y + 2 },
      thickness: 0.5,
      color: RULE,
    });
    cursor.y -= 4;

    // Cap rows per table so a 5,000-row dataset doesn't produce a
    // 200-page PDF — the full data lives in the CSV/Excel exports, and
    // the report says so rather than silently truncating.
    const MAX_ROWS = 40;
    for (const row of table.rows.slice(0, MAX_ROWS)) {
      drawRow(row, regular);
    }
    if (table.rows.length > MAX_ROWS) {
      write(
        `Showing ${MAX_ROWS} of ${table.rows.length} rows. The CSV and Excel exports contain every row.`,
        { size: 7.5, color: MUTED, gap: 8 }
      );
    }
    cursor.y -= 8;
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
