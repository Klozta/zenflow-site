/**
 * Service de génération PDF pour factures
 * Utilise pdfkit (léger, rapide, pas de dépendances lourdes)
 */
import PDFDocument from 'pdfkit';
import { logger } from '../utils/logger.js';

export interface InvoicePDFParams {
  orderNumber: string;
  orderDate: string;
  customerName?: string;
  customerEmail: string;
  shippingAddress?: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    postalCode: string;
    country: string;
  };
  items: Array<{ title: string; quantity: number; unitPrice: number }>;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  promoCode?: string | null;
}

/**
 * Génère un PDF de facture
 */
export async function generateInvoicePDF(params: InvoicePDFParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).text('FACTURE', { align: 'right' });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`N° Commande: ${params.orderNumber}`, { align: 'right' });
      doc.text(`Date: ${new Date(params.orderDate).toLocaleDateString('fr-FR')}`, { align: 'right' });
      doc.moveDown(1);

      // Informations client
      if (params.shippingAddress) {
        doc.fontSize(12).text('Facturé à:', { underline: true });
        doc.fontSize(10);
        doc.text(`${params.shippingAddress.firstName} ${params.shippingAddress.lastName}`);
        doc.text(params.shippingAddress.address);
        doc.text(`${params.shippingAddress.postalCode} ${params.shippingAddress.city}`);
        doc.text(params.shippingAddress.country);
        doc.moveDown(1);
      }

      // Tableau articles
      doc.fontSize(12).text('Articles', { underline: true });
      doc.moveDown(0.5);

      // En-têtes tableau
      const tableTop = doc.y;
      doc.fontSize(10);
      doc.text('Description', 50, tableTop);
      doc.text('Qté', 350, tableTop);
      doc.text('Prix unit.', 400, tableTop, { align: 'right' });
      doc.text('Total', 500, tableTop, { align: 'right' });

      // Ligne séparatrice
      doc.moveTo(50, doc.y + 5).lineTo(550, doc.y + 5).stroke();
      doc.moveDown(0.5);

      // Articles
      params.items.forEach((item) => {
        const itemTotal = item.unitPrice * item.quantity;
        doc.text(item.title, 50);
        doc.text(String(item.quantity), 350);
        doc.text(`${item.unitPrice.toFixed(2)}€`, 400, undefined, { align: 'right' });
        doc.text(`${itemTotal.toFixed(2)}€`, 500, undefined, { align: 'right' });
        doc.moveDown(0.3);
      });

      // Totaux
      const totalsY = doc.y + 10;
      doc.moveTo(400, totalsY).lineTo(550, totalsY).stroke();
      doc.moveDown(0.5);

      doc.text('Sous-total:', 400, undefined, { align: 'right' });
      doc.text(`${params.subtotal.toFixed(2)}€`, 500, undefined, { align: 'right' });
      doc.moveDown(0.3);

      if (params.shipping > 0) {
        doc.text('Livraison:', 400, undefined, { align: 'right' });
        doc.text(`${params.shipping.toFixed(2)}€`, 500, undefined, { align: 'right' });
        doc.moveDown(0.3);
      }

      if (params.discount > 0) {
        doc.text(`Réduction${params.promoCode ? ` (${params.promoCode})` : ''}:`, 400, undefined, { align: 'right' });
        doc.text(`-${params.discount.toFixed(2)}€`, 500, undefined, { align: 'right' });
        doc.moveDown(0.3);
      }

      doc.moveTo(400, doc.y + 5).lineTo(550, doc.y + 5).stroke();
      doc.moveDown(0.5);

      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('Total TTC:', 400, undefined, { align: 'right' });
      doc.text(`${params.total.toFixed(2)}€`, 500, undefined, { align: 'right' });
      doc.font('Helvetica').fontSize(10);

      // Footer
      doc.moveDown(2);
      doc.fontSize(8).text('Merci pour votre achat !', { align: 'center' });
      doc.text('ZenFlow — Tous droits réservés', { align: 'center' });

      doc.end();
    } catch (error) {
      logger.error('Erreur génération PDF facture', error instanceof Error ? error : new Error(String(error)));
      reject(error);
    }
  });
}
