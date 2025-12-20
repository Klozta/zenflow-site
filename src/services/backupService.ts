/**
 * Service de backup automatique de la base de données Supabase
 * Supporte plusieurs méthodes de stockage : local, S3, Cloudflare R2
 */

import { exec } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { handleServiceError } from '../utils/errorHandlers.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export interface BackupConfig {
  storageType: 'local' | 's3' | 'r2' | 'supabase-storage';
  localPath?: string;
  s3Bucket?: string;
  s3Region?: string;
  r2Bucket?: string;
  r2AccountId?: string;
  retentionDays?: number;
  compress?: boolean;
}

export interface BackupResult {
  success: boolean;
  backupPath?: string;
  backupSize?: number;
  error?: string;
  timestamp: string;
  duration: number;
}

/**
 * Service de backup de base de données
 */
export class BackupService {
  private config: BackupConfig;

  constructor(config?: Partial<BackupConfig>) {
    this.config = {
      storageType: (process.env.BACKUP_STORAGE_TYPE as any) || 'local',
      localPath: process.env.BACKUP_LOCAL_PATH || './backups',
      retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '30'),
      compress: process.env.BACKUP_COMPRESS !== 'false',
      ...config,
    };

    // Créer le dossier de backup local si nécessaire
    if (this.config.storageType === 'local' && this.config.localPath) {
      if (!existsSync(this.config.localPath)) {
        mkdirSync(this.config.localPath, { recursive: true });
      }
    }
  }

  /**
   * Effectue un backup de la base de données Supabase
   */
  async createBackup(): Promise<BackupResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `backup-${timestamp}.sql`;
    const backupPath = this.config.localPath
      ? join(this.config.localPath, backupFileName)
      : backupFileName;

    try {
      // Vérifier les variables d'environnement nécessaires
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseDbPassword = process.env.SUPABASE_DB_PASSWORD;
      const supabaseDbHost = process.env.SUPABASE_DB_HOST;
      const supabaseDbName = process.env.SUPABASE_DB_NAME || 'postgres';
      const supabaseDbUser = process.env.SUPABASE_DB_USER || 'postgres';

      if (!supabaseUrl) {
        throw new Error('SUPABASE_URL is not configured');
      }

      // Extraire l'host de l'URL Supabase si DB_HOST n'est pas fourni
      let dbHost = supabaseDbHost;
      if (!dbHost) {
        // Supabase utilise un format: db.{project-ref}.supabase.co
        const urlMatch = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
        if (urlMatch) {
          dbHost = `db.${urlMatch[1]}.supabase.co`;
        } else {
          throw new Error('Cannot determine database host from SUPABASE_URL. Set SUPABASE_DB_HOST manually.');
        }
      }

      // Vérifier que pg_dump est disponible
      try {
        await execAsync('which pg_dump');
      } catch {
        throw new Error('pg_dump is not installed. Install PostgreSQL client tools.');
      }

      // Construire la commande pg_dump
      const pgDumpCmd = [
        'pg_dump',
        `-h ${dbHost}`,
        `-U ${supabaseDbUser}`,
        `-d ${supabaseDbName}`,
        '--no-owner',
        '--no-acl',
        '--clean',
        '--if-exists',
        '-F', 'c', // Format custom (compressé)
      ].join(' ');

      // Exécuter le backup avec mot de passe via PGPASSWORD
      const env = {
        ...process.env,
        PGPASSWORD: supabaseDbPassword || '',
      };

      logger.info('Starting database backup', {
        host: dbHost,
        database: supabaseDbName,
        backupPath,
      });

      const { stdout, stderr } = await execAsync(pgDumpCmd, {
        env,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (stderr && !stderr.includes('WARNING')) {
        logger.warn('pg_dump warnings', { stderr });
      }

      // Écrire le backup dans un fichier
      const fs = await import('fs/promises');
      await fs.writeFile(backupPath, stdout);

      // Obtenir la taille du fichier
      const stats = statSync(backupPath);
      const backupSize = stats.size;

      logger.info('Database backup completed', {
        backupPath,
        backupSize: `${(backupSize / 1024 / 1024).toFixed(2)} MB`,
      });

      // Upload vers stockage distant si configuré
      if (this.config.storageType !== 'local') {
        await this.uploadToStorage(backupPath, backupFileName);
      }

      // Nettoyer les anciens backups
      await this.cleanupOldBackups();

      const duration = Date.now() - startTime;

      return {
        success: true,
        backupPath,
        backupSize,
        timestamp: new Date().toISOString(),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Database backup failed', error instanceof Error ? error : new Error(String(error)));

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        duration,
      };
    }
  }

  /**
   * Upload le backup vers un stockage distant (S3, R2, Supabase Storage)
   */
  private async uploadToStorage(localPath: string, fileName: string): Promise<void> {
    try {
      switch (this.config.storageType) {
        case 's3':
          await this.uploadToS3(localPath, fileName);
          break;
        case 'r2':
          await this.uploadToR2(localPath, fileName);
          break;
        case 'supabase-storage':
          await this.uploadToSupabaseStorage(localPath, fileName);
          break;
        default:
          logger.warn('Unknown storage type, skipping upload', { storageType: this.config.storageType });
      }
    } catch (error) {
      logger.error('Failed to upload backup to storage', error instanceof Error ? error : new Error(String(error)));
      // Ne pas faire échouer le backup si l'upload échoue
    }
  }

  /**
   * Upload vers AWS S3
   */
  private async uploadToS3(localPath: string, fileName: string): Promise<void> {
    if (!this.config.s3Bucket) {
      throw new Error('S3 bucket not configured');
    }

    // Utiliser AWS CLI si disponible
    const awsCmd = `aws s3 cp "${localPath}" "s3://${this.config.s3Bucket}/${fileName}"`;
    try {
      await execAsync(awsCmd);
      logger.info('Backup uploaded to S3', { bucket: this.config.s3Bucket, fileName });
    } catch (error) {
      // Fallback: utiliser le SDK AWS si CLI n'est pas disponible
      logger.warn('AWS CLI not available, trying SDK...', { error: error instanceof Error ? error.message : String(error) });
      // TODO: Implémenter avec @aws-sdk/client-s3 si nécessaire
      throw error;
    }
  }

  /**
   * Upload vers Cloudflare R2
   */
  private async uploadToR2(localPath: string, fileName: string): Promise<void> {
    if (!this.config.r2Bucket || !this.config.r2AccountId) {
      throw new Error('R2 bucket or account ID not configured');
    }

    // Cloudflare R2 est compatible S3, utiliser AWS CLI avec endpoint R2
    const r2Endpoint = `https://${this.config.r2AccountId}.r2.cloudflarestorage.com`;
    const awsCmd = `aws s3 cp "${localPath}" "s3://${this.config.r2Bucket}/${fileName}" --endpoint-url "${r2Endpoint}"`;
    try {
      await execAsync(awsCmd);
      logger.info('Backup uploaded to R2', { bucket: this.config.r2Bucket, fileName });
    } catch (error) {
      logger.error('Failed to upload to R2', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Upload vers Supabase Storage
   */
  private async uploadToSupabaseStorage(localPath: string, fileName: string): Promise<void> {
    const { supabase } = await import('../config/supabase.js');
    const fs = await import('fs/promises');

    const fileContent = await fs.readFile(localPath);
    const { error } = await supabase.storage
      .from('backups')
      .upload(fileName, fileContent, {
        contentType: 'application/octet-stream',
        upsert: false,
      });

    if (error) {
      throw new Error(`Supabase Storage upload failed: ${error.message}`);
    }

    logger.info('Backup uploaded to Supabase Storage', { fileName });
  }

  /**
   * Nettoie les anciens backups selon la rétention configurée
   */
  private async cleanupOldBackups(): Promise<void> {
    if (this.config.storageType !== 'local' || !this.config.localPath) {
      return;
    }

    const retentionDays = this.config.retentionDays || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
      const files = readdirSync(this.config.localPath);
      let deletedCount = 0;

      for (const file of files) {
        if (!file.startsWith('backup-') || !file.endsWith('.sql')) {
          continue;
        }

        const filePath = join(this.config.localPath!, file);
        const stats = statSync(filePath);
        const fileDate = new Date(stats.mtime);

        if (fileDate < cutoffDate) {
          unlinkSync(filePath);
          deletedCount++;
          logger.info('Deleted old backup', { file, age: `${Math.floor((Date.now() - fileDate.getTime()) / (1000 * 60 * 60 * 24))} days` });
        }
      }

      if (deletedCount > 0) {
        logger.info('Cleanup completed', { deletedCount });
      }
    } catch (error) {
      logger.error('Failed to cleanup old backups', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Liste les backups disponibles
   */
  async listBackups(): Promise<Array<{ name: string; size: number; date: Date }>> {
    if (this.config.storageType !== 'local' || !this.config.localPath) {
      return [];
    }

    try {
      const files = readdirSync(this.config.localPath);
      const backups: Array<{ name: string; size: number; date: Date }> = [];

      for (const file of files) {
        if (!file.startsWith('backup-') || !file.endsWith('.sql')) {
          continue;
        }

        const filePath = join(this.config.localPath!, file);
        const stats = statSync(filePath);
        backups.push({
          name: file,
          size: stats.size,
          date: stats.mtime,
        });
      }

      return backups.sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch (error) {
      logger.error('Failed to list backups', error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }
}

// Instance singleton
export const backupService = new BackupService();

/**
 * Fonction helper pour créer un backup
 */
export async function createDatabaseBackup(): Promise<BackupResult> {
  try {
    return await backupService.createBackup();
  } catch (error) {
    throw handleServiceError(error, 'createDatabaseBackup', 'Erreur création backup DB');
  }
}

