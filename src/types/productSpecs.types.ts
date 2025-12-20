/**
 * Types pour spécifications techniques produits
 */
export interface ProductSpecification {
  id: string;
  productId: string;
  key: string; // Ex: "dimensions", "weight", "material"
  value: string; // Ex: "220x220x250mm", "5kg", "PLA/ABS"
  category: string; // Ex: "3d-printer", "electronics"
  displayOrder: number;
}

export interface ProductSpecificationInput {
  key: string;
  value: string;
  category?: string;
  displayOrder?: number;
}

/**
 * Spécifications spécifiques pour imprimantes 3D
 */
export interface Printer3DSpecs {
  // Dimensions d'impression
  buildVolume?: string; // Ex: "220x220x250mm"
  buildVolumeX?: number; // mm
  buildVolumeY?: number; // mm
  buildVolumeZ?: number; // mm
  
  // Type de filament
  filamentType?: string[]; // Ex: ["PLA", "ABS", "PETG"]
  filamentDiameter?: string; // "1.75mm" ou "3mm"
  
  // Résolution
  layerHeight?: string; // Ex: "0.1-0.3mm"
  nozzleSize?: string; // Ex: "0.4mm"
  
  // Vitesse
  printSpeed?: string; // Ex: "50-150mm/s"
  travelSpeed?: string;
  
  // Température
  hotendTemp?: string; // Ex: "200-260°C"
  bedTemp?: string; // Ex: "60-100°C"
  
  // Autres
  connectivity?: string[]; // Ex: ["USB", "SD Card", "WiFi"]
  display?: string; // Ex: "LCD 3.5 pouces"
  autoLeveling?: boolean;
  resumePrint?: boolean;
  powerConsumption?: string; // Ex: "220W"
  weight?: string; // Ex: "8kg"
  dimensions?: string; // Ex: "400x400x500mm"
}

/**
 * Spécifications pour autres types de produits
 */
export interface GenericProductSpecs {
  [key: string]: string | number | boolean | string[] | undefined;
}









