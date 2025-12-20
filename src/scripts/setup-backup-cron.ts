/**
 * Script pour configurer le cron job de backup automatique
 * Exécute: node dist/scripts/setup-backup-cron.js
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function setupBackupCron() {
  const scriptPath = process.cwd() + '/scripts/backup-automatic.sh';
  const cronTime = process.env.BACKUP_CRON_SCHEDULE || '0 2 * * *'; // Par défaut: 2h du matin quotidiennement
  const cronJob = `${cronTime} ${scriptPath} >> /var/log/zenflow-backup.log 2>&1`;

  try {
    // Vérifier si le cron job existe déjà
    const { stdout } = await execAsync('crontab -l 2>/dev/null || echo ""');
    if (stdout.includes(scriptPath)) {
      console.log('⚠️  Cron job de backup existe déjà');
      console.log('Pour le mettre à jour, supprimez-le d\'abord avec: crontab -e');
      return;
    }

    // Ajouter le cron job
    const newCrontab = stdout + (stdout ? '\n' : '') + `# Backup automatique ZenFlow\n${cronJob}\n`;
    await execAsync(`echo "${newCrontab}" | crontab -`);

    console.log('✅ Cron job de backup configuré avec succès');
    console.log(`   Schedule: ${cronTime}`);
    console.log(`   Script: ${scriptPath}`);
    console.log('');
    console.log('Pour vérifier: crontab -l');
    console.log('Pour modifier: crontab -e');
  } catch (error) {
    console.error('❌ Erreur configuration cron job:', error);
    console.error('');
    console.error('Configuration manuelle:');
    console.error(`1. Exécuter: crontab -e`);
    console.error(`2. Ajouter: ${cronJob}`);
  }
}

setupBackupCron().catch(console.error);

