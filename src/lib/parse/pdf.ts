import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfPage, PdfStatement, TextItem } from './pdf-rows.ts';
import { parsePdfStatement } from './pdf-rows.ts';
import { StatementFormatError } from './statement.ts';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * Read a certified statement PDF in the browser.
 *
 * This is the only place that knows about pdf.js. It extracts positioned text
 * and hands it to {@link parsePdfStatement}, which holds every rule about what
 * a statement looks like and is unit-tested with synthetic items.
 *
 * @throws {StatementFormatError} when the file is not a readable PDF, or is a
 * scan with no text layer.
 */
export async function readPdfStatement(data: ArrayBuffer): Promise<PdfStatement> {
	const pages = await extractPages(data);

	const statement = parsePdfStatement(pages);
	if (statement.accounts.every((account) => account.rows.length === 0)) {
		throw new StatementFormatError(
			'No transactions were found in this PDF. If it is a scan rather than a ' +
				'downloaded statement, there is no text for this app to read.'
		);
	}

	return statement;
}

async function extractPages(data: ArrayBuffer): Promise<readonly PdfPage[]> {
	// The buffer is transferred to the worker, so hand over a copy: the caller
	// may still want the original (to store it, or to retry).
	const task = pdfjs.getDocument({ data: data.slice(0) });

	try {
		const document = await task.promise;
		return await Promise.all(
			Array.from({ length: document.numPages }, (_, index) => readPage(document, index + 1))
		);
	} catch (error: unknown) {
		if (error instanceof StatementFormatError) throw error;
		throw new StatementFormatError(
			`This file could not be read as a PDF: ${
				error instanceof Error ? error.message : 'unknown error'
			}`
		);
	} finally {
		// Tears down the worker along with the document.
		await task.destroy();
	}
}

async function readPage(document: pdfjs.PDFDocumentProxy, pageNumber: number): Promise<PdfPage> {
	const page = await document.getPage(pageNumber);

	try {
		const content = await page.getTextContent();
		const height = page.view[3];

		const items = content.items.flatMap<TextItem>((item) => {
			if (!('str' in item)) return [];

			const [, , , , x, y] = item.transform;
			return [
				{
					str: item.str,
					x,
					// pdf.js reports y growing upwards from the page's bottom edge.
					// Flip it so the row assembler can read top to bottom.
					y: height - y,
					width: item.width
				}
			];
		});

		return { items };
	} finally {
		page.cleanup();
	}
}
