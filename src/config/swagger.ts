/**
 * Configuration Swagger/OpenAPI pour la documentation API
 */
import swaggerJsdoc from 'swagger-jsdoc';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'ZenFlow API',
    version: '1.0.0',
    description: 'Documentation complète de l\'API ZenFlow - E-commerce backend avec gestion produits, commandes, utilisateurs, métriques et plus.',
    contact: {
      name: 'ZenFlow Support',
    },
    license: {
      name: 'ISC',
    },
  },
  servers: [
    {
      url: process.env.API_URL || 'http://localhost:3001',
      description: 'Serveur de développement',
    },
    ...(process.env.API_URL_PROD ? [{
      url: process.env.API_URL_PROD,
      description: 'Serveur de production',
    }] : []),
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtenu via /api/auth/login ou /api/auth/register',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'accessToken',
        description: 'Cookie HTTP-only contenant le JWT access token',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            description: 'Message d\'erreur',
          },
        },
        required: ['error'],
      },
      User: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          email: {
            type: 'string',
            format: 'email',
          },
          name: {
            type: 'string',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      Product: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          title: {
            type: 'string',
          },
          description: {
            type: 'string',
          },
          price: {
            type: 'number',
            format: 'float',
          },
          category: {
            type: 'string',
          },
          stock: {
            type: 'integer',
          },
          images: {
            type: 'array',
            items: {
              type: 'string',
              format: 'uri',
            },
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          orderNumber: {
            type: 'string',
          },
          userId: {
            type: 'string',
            format: 'uuid',
            nullable: true,
          },
          status: {
            type: 'string',
            enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
          },
          total: {
            type: 'number',
            format: 'float',
          },
          items: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/OrderItem',
            },
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      OrderItem: {
        type: 'object',
        properties: {
          productId: {
            type: 'string',
            format: 'uuid',
          },
          quantity: {
            type: 'integer',
            minimum: 1,
          },
          price: {
            type: 'number',
            format: 'float',
          },
        },
        required: ['productId', 'quantity', 'price'],
      },
      MetricsDashboard: {
        type: 'object',
        properties: {
          timestamp: {
            type: 'string',
            format: 'date-time',
          },
          system: {
            type: 'object',
            properties: {
              uptime: {
                type: 'number',
              },
              memory: {
                type: 'object',
              },
            },
          },
          overview: {
            type: 'object',
          },
          recent: {
            type: 'object',
          },
          alerts: {
            type: 'object',
          },
        },
      },
    },
    responses: {
      UnauthorizedError: {
        description: 'Token manquant ou invalide',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'Missing authentication token',
            },
          },
        },
      },
      ForbiddenError: {
        description: 'Accès refusé (nécessite droits admin)',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'Forbidden: Admin access required',
            },
          },
        },
      },
      NotFoundError: {
        description: 'Ressource non trouvée',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'Not found',
            },
          },
        },
      },
      ValidationError: {
        description: 'Erreur de validation',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'Validation failed',
              details: [],
            },
          },
        },
      },
      RateLimitError: {
        description: 'Rate limit dépassé',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'Too many requests, please try again later',
            },
          },
        },
      },
    },
  },
  security: [
    {
      bearerAuth: [],
    },
    {
      cookieAuth: [],
    },
  ],
  tags: [
    {
      name: 'Auth',
      description: 'Authentification et gestion utilisateurs',
    },
    {
      name: 'Products',
      description: 'Gestion des produits',
    },
    {
      name: 'Orders',
      description: 'Gestion des commandes',
    },
    {
      name: 'Metrics',
      description: 'Métriques et monitoring',
    },
    {
      name: 'Health',
      description: 'Health checks et status',
    },
    {
      name: 'Payments',
      description: 'Gestion des paiements (Stripe)',
    },
    {
      name: 'Reviews',
      description: 'Gestion des avis clients',
    },
    {
      name: 'Loyalty',
      description: 'Programme de fidélité',
    },
    {
      name: 'Admin',
      description: 'Endpoints administrateur',
    },
    {
      name: 'Monitoring',
      description: 'Monitoring et alertes système',
    },
  ],
};

const options: swaggerJsdoc.Options = {
  definition: swaggerDefinition,
  apis: [
    './src/routes/*.ts', // Fichiers de routes directs
    './src/routes/**/*.ts', // Routes dans sous-dossiers (ex: metrics/*.ts)
  ],
};

export const swaggerSpec = swaggerJsdoc(options);

