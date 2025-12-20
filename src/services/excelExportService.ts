/**
 * Service d'export Excel pour commandes
 * Utilise exceljs (léger, performant)
 */
import ExcelJS from 'exceljs';
import { supabase } from '../config/supabase.js';

export interface ExcelExportOptions {
  includeItems?: boolean;
  includeStats?: boolean;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
}

/**
 * Génère un fichier Excel avec onglets multiples
 */
export async function generateOrdersExcel(options: ExcelExportOptions = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ZenFlow Admin';
  workbook.created = new Date();

  // Onglet 1: Commandes
  const ordersSheet = workbook.addWorksheet('Commandes');
  ordersSheet.columns = [
    { header: 'N° Commande', key: 'order_number', width: 15 },
    { header: 'Date', key: 'created_at', width: 20 },
    { header: 'Statut', key: 'status', width: 12 },
    { header: 'Total (€)', key: 'total', width: 12 },
    { header: 'Prénom', key: 'first_name', width: 15 },
    { header: 'Nom', key: 'last_name', width: 15 },
    { header: 'Email', key: 'email', width: 25 },
    { header: 'Téléphone', key: 'phone', width: 15 },
    { header: 'Adresse', key: 'address', width: 30 },
    { header: 'Ville', key: 'city', width: 15 },
    { header: 'Code Postal', key: 'postal_code', width: 12 },
    { header: 'Pays', key: 'country', width: 12 },
    { header: 'Code Promo', key: 'promo_code', width: 12 },
    { header: 'UTM Source', key: 'utm_source', width: 15 },
    { header: 'UTM Campaign', key: 'utm_campaign', width: 20 },
  ];

  // Récupérer commandes
  let query = supabase.from('orders').select('*').order('created_at', { ascending: false });
  if (options.dateFrom) query = query.gte('created_at', options.dateFrom);
  if (options.dateTo) query = query.lte('created_at', options.dateTo);
  if (options.status) query = query.eq('status', options.status);

  const { data: orders, error: ordersError } = await query;

  if (ordersError) {
    throw new Error(`Erreur récupération commandes: ${ordersError.message}`);
  }

  // Ajouter les lignes
  (orders || []).forEach((order: any) => {
    ordersSheet.addRow({
      order_number: order.order_number,
      created_at: new Date(order.created_at).toLocaleString('fr-FR'),
      status: order.status,
      total: Number(order.total || 0).toFixed(2),
      first_name: order.shipping_first_name,
      last_name: order.shipping_last_name,
      email: order.shipping_email,
      phone: order.shipping_phone,
      address: order.shipping_address,
      city: order.shipping_city,
      postal_code: order.shipping_postal_code,
      country: order.shipping_country,
      promo_code: order.promo_code || '',
      utm_source: order.utm_source || '',
      utm_campaign: order.utm_campaign || '',
    });
  });

  // Style header
  ordersSheet.getRow(1).font = { bold: true };
  ordersSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  // Onglet 2: Items (si demandé)
  if (options.includeItems && orders && orders.length > 0) {
    const itemsSheet = workbook.addWorksheet('Items');
    itemsSheet.columns = [
      { header: 'N° Commande', key: 'order_number', width: 15 },
      { header: 'Product ID', key: 'product_id', width: 40 },
      { header: 'Quantité', key: 'quantity', width: 10 },
      { header: 'Prix unit. (€)', key: 'price', width: 15 },
      { header: 'Total (€)', key: 'total', width: 15 },
    ];

    const orderIds = orders.map((o: any) => o.id);
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('order_id, product_id, quantity, price')
      .in('order_id', orderIds);

    if (!itemsError && items) {
      const orderNumberMap = new Map(orders.map((o: any) => [o.id, o.order_number]));
      items.forEach((item: any) => {
        itemsSheet.addRow({
          order_number: orderNumberMap.get(item.order_id) || '',
          product_id: item.product_id,
          quantity: item.quantity,
          price: Number(item.price || 0).toFixed(2),
          total: (Number(item.quantity || 0) * Number(item.price || 0)).toFixed(2),
        });
      });
    }

    itemsSheet.getRow(1).font = { bold: true };
    itemsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };
  }

  // Onglet 3: Stats (si demandé)
  if (options.includeStats && orders) {
    const statsSheet = workbook.addWorksheet('Statistiques');
    statsSheet.columns = [
      { header: 'Métrique', key: 'metric', width: 30 },
      { header: 'Valeur', key: 'value', width: 20 },
    ];

    const totalRevenue = orders.reduce((sum: number, o: any) => sum + Number(o.total || 0), 0);
    const byStatus: Record<string, number> = {};
    orders.forEach((o: any) => {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    });

    statsSheet.addRow({ metric: 'Total commandes', value: orders.length });
    statsSheet.addRow({ metric: 'Revenus totaux (€)', value: totalRevenue.toFixed(2) });
    statsSheet.addRow({ metric: 'Panier moyen (€)', value: (totalRevenue / orders.length || 0).toFixed(2) });
    statsSheet.addRow({ metric: '', value: '' });
    statsSheet.addRow({ metric: 'Par statut:', value: '' });
    Object.entries(byStatus).forEach(([status, count]) => {
      statsSheet.addRow({ metric: `  ${status}`, value: count });
    });

    statsSheet.getRow(1).font = { bold: true };
    statsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };
  }

  // Générer le buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}


