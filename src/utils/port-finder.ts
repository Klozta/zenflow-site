/**
 * Utilitaire pour trouver un port disponible
 * Basé sur les recommandations Perplexity
 */

import { createServer } from 'net';

/**
 * Trouve un port disponible
 */
export function findAvailablePort(startPort: number = 3001): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    
    server.listen(startPort, () => {
      const port = (server.address() as any)?.port;
      server.close(() => {
        resolve(port);
      });
    });
    
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        // Port occupé, essayer le suivant
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Trouve un port disponible de manière synchrone (pour utilisation dans index.ts)
 */
export async function getAvailablePort(defaultPort: number = 3001): Promise<number> {
  try {
    return await findAvailablePort(defaultPort);
  } catch (error) {
    console.warn(`⚠️  Erreur lors de la recherche de port, utilisation du port par défaut ${defaultPort + 10}`);
    return defaultPort + 10;
  }
}





