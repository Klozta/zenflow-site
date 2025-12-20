/**
 * Service de gestion des spécifications techniques produits
 */
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import type { ProductSpecification, ProductSpecificationInput, Printer3DSpecs } from '../types/productSpecs.types.js';

/**
 * Récupérer les spécifications d'un produit
 */
export async function getProductSpecifications(
  productId: string
): Promise<ProductSpecification[]> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return [];
    }

    const { data, error } = await supabase
      .from('product_specifications')
      .select('*')
      .eq('product_id', productId)
      .order('display_order', { ascending: true });

    if (error) throw error;
    return (data || []) as ProductSpecification[];
  } catch (error: any) {
    logger.error('Erreur récupération spécifications', error, { productId });
    return [];
  }
}

/**
 * Créer/Mettre à jour les spécifications d'un produit
 */
export async function upsertProductSpecifications(
  productId: string,
  specs: ProductSpecificationInput[]
): Promise<ProductSpecification[]> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      throw new Error('Supabase non configuré');
    }

    // Supprimer les anciennes spécifications
    await supabase
      .from('product_specifications')
      .delete()
      .eq('product_id', productId);

    // Insérer les nouvelles
    const specsToInsert = specs.map((spec, index) => ({
      product_id: productId,
      key: spec.key,
      value: spec.value,
      category: spec.category || 'general',
      display_order: spec.displayOrder ?? index,
    }));

    const { data, error } = await supabase
      .from('product_specifications')
      .insert(specsToInsert)
      .select();

    if (error) throw error;
    return (data || []) as ProductSpecification[];
  } catch (error: any) {
    logger.error('Erreur upsert spécifications', error, { productId });
    throw error;
  }
}

/**
 * Convertir les specs d'imprimante 3D en format générique
 */
export function convertPrinter3DSpecsToGeneric(
  specs: Printer3DSpecs
): ProductSpecificationInput[] {
  const result: ProductSpecificationInput[] = [];
  let order = 0;

  if (specs.buildVolume) {
    result.push({
      key: 'Volume d\'impression',
      value: specs.buildVolume,
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.filamentType && specs.filamentType.length > 0) {
    result.push({
      key: 'Type de filament',
      value: specs.filamentType.join(', '),
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.filamentDiameter) {
    result.push({
      key: 'Diamètre filament',
      value: specs.filamentDiameter,
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.layerHeight) {
    result.push({
      key: 'Hauteur de couche',
      value: specs.layerHeight,
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.nozzleSize) {
    result.push({
      key: 'Diamètre buse',
      value: specs.nozzleSize,
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.printSpeed) {
    result.push({
      key: 'Vitesse d\'impression',
      value: specs.printSpeed,
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.hotendTemp) {
    result.push({
      key: 'Température buse',
      value: specs.hotendTemp,
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.bedTemp) {
    result.push({
      key: 'Température plateau',
      value: specs.bedTemp,
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.connectivity && specs.connectivity.length > 0) {
    result.push({
      key: 'Connectivité',
      value: specs.connectivity.join(', '),
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.display) {
    result.push({
      key: 'Écran',
      value: specs.display,
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.autoLeveling !== undefined) {
    result.push({
      key: 'Nivellement automatique',
      value: specs.autoLeveling ? 'Oui' : 'Non',
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.resumePrint !== undefined) {
    result.push({
      key: 'Reprise d\'impression',
      value: specs.resumePrint ? 'Oui' : 'Non',
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.powerConsumption) {
    result.push({
      key: 'Consommation',
      value: specs.powerConsumption,
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.weight) {
    result.push({
      key: 'Poids',
      value: specs.weight,
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  if (specs.dimensions) {
    result.push({
      key: 'Dimensions',
      value: specs.dimensions,
      category: '3d-printer',
      displayOrder: order++,
    });
  }

  return result;
}

/**
 * Récupérer les spécifications formatées pour affichage
 */
export async function getFormattedProductSpecs(productId: string): Promise<Record<string, string>> {
  const specs = await getProductSpecifications(productId);
  const formatted: Record<string, string> = {};
  
  specs.forEach((spec) => {
    formatted[spec.key] = spec.value;
  });
  
  return formatted;
}








