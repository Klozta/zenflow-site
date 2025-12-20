/**
 * Middleware de validation d'upload de fichiers
 * Validation stricte: MIME types, extensions, taille
 */
import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { securityLogger } from '../utils/securityLogger.js';

// Limites de taille
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_FILES = 5; // Maximum 5 fichiers

// MIME types autorisés (images uniquement)
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
];

// Extensions autorisées
export const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];

/**
 * Configuration multer sécurisée
 */
export const upload = multer({
  storage: multer.memoryStorage(), // Stockage en mémoire (pas de fichiers temporaires)
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
  fileFilter: (req, file, cb) => {
    // Vérifier MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      securityLogger.securityEvent(
        'upload_validation_failed',
        {
          reason: 'invalid_mime_type',
          mimeType: file.mimetype,
          filename: file.originalname,
          ip: req.ip,
        }
      );
      return cb(new Error(`Type de fichier non autorisé. Types acceptés: ${ALLOWED_MIME_TYPES.join(', ')}`));
    }

    // Vérifier extension
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      securityLogger.securityEvent(
        'upload_validation_failed',
        {
          reason: 'invalid_extension',
          extension: ext,
          filename: file.originalname,
          ip: req.ip,
        }
      );
      return cb(new Error(`Extension non autorisée. Extensions acceptées: ${ALLOWED_EXTENSIONS.join(', ')}`));
    }

    // Vérifier que l'extension correspond au MIME type
    const mimeToExt: Record<string, string[]> = {
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'image/webp': ['webp'],
      'image/gif': ['gif'],
      'image/avif': ['avif'],
    };

    const validExts = mimeToExt[file.mimetype] || [];
    if (!validExts.includes(ext)) {
      securityLogger.securityEvent(
        'upload_validation_failed',
        {
          reason: 'mime_extension_mismatch',
          mimeType: file.mimetype,
          extension: ext,
          filename: file.originalname,
          ip: req.ip,
        }
      );
      return cb(new Error(`L'extension ${ext} ne correspond pas au type MIME ${file.mimetype}`));
    }

    cb(null, true);
  },
});

/**
 * Middleware de validation après upload
 * Vérifie la taille réelle du fichier et son contenu
 */
export function validateUploadedFile(req: Request, res: Response, next: NextFunction) {
  if (!req.file) {
    return res.status(400).json({
      error: 'Aucun fichier fourni',
    });
  }

  const file = req.file;

  // Vérifier taille
  if (file.size > MAX_FILE_SIZE) {
    securityLogger.securityEvent('upload_validation_failed', {
      reason: 'file_too_large',
      size: file.size,
      maxSize: MAX_FILE_SIZE,
      filename: file.originalname,
      ip: req.ip,
    });
    return res.status(400).json({
      error: `Fichier trop volumineux. Taille maximum: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    });
  }

  // Vérifier que le fichier n'est pas vide
  if (file.size === 0) {
    securityLogger.securityEvent('upload_validation_failed', {
      reason: 'empty_file',
      filename: file.originalname,
      ip: req.ip,
    });
    return res.status(400).json({
      error: 'Le fichier est vide',
    });
  }

  // Vérifier signature magique (début du fichier)
  const buffer = file.buffer;
  const isValidImage =
    // JPEG
    (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) ||
    // PNG
    (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) ||
    // GIF
    (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) ||
    // WebP (RIFF...WEBP)
    (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
     buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50);

  if (!isValidImage) {
    securityLogger.securityEvent('upload_validation_failed', {
      reason: 'invalid_file_signature',
      filename: file.originalname,
      mimeType: file.mimetype,
      ip: req.ip,
    });
    return res.status(400).json({
      error: 'Le fichier n\'est pas une image valide (signature magique invalide)',
    });
  }

  return next();
}

/**
 * Middleware pour uploads multiples
 */
export const uploadMultiple = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
  fileFilter: (req, file, cb) => {
    // Réutiliser la même logique de validation que upload
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      securityLogger.securityEvent('upload_validation_failed', {
        reason: 'invalid_mime_type',
        mimeType: file.mimetype,
        filename: file.originalname,
        ip: req.ip,
      });
      return cb(new Error(`Type de fichier non autorisé. Types acceptés: ${ALLOWED_MIME_TYPES.join(', ')}`));
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      securityLogger.securityEvent('upload_validation_failed', {
        reason: 'invalid_extension',
        extension: ext,
        filename: file.originalname,
        ip: req.ip,
      });
      return cb(new Error(`Extension non autorisée. Extensions acceptées: ${ALLOWED_EXTENSIONS.join(', ')}`));
    }

    cb(null, true);
  },
});

/**
 * Validation des uploads multiples
 */
export function validateUploadedFiles(req: Request, res: Response, next: NextFunction) {
  if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
    return res.status(400).json({
      error: 'Aucun fichier fourni',
    });
  }

  const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();

  // Vérifier nombre de fichiers
  if (files.length > MAX_FILES) {
    return res.status(400).json({
      error: `Trop de fichiers. Maximum: ${MAX_FILES}`,
    });
  }

  // Valider chaque fichier
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      securityLogger.securityEvent('upload_validation_failed', {
        reason: 'file_too_large',
        filename: file.originalname,
        size: file.size,
        ip: req.ip,
      });
      return res.status(400).json({
        error: `Fichier ${file.originalname} trop volumineux`,
      });
    }
  }

  return next();
}





